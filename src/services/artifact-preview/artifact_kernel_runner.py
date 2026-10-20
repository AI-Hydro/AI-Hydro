#!/usr/bin/env python3
"""
Long-lived Python kernel for AI-Hydro HTML artifact preview.

Reads newline-delimited JSON requests from the process's original stdin and
writes one JSON response per line to the process's original stdout. Maintains
a single global namespace across exec calls.

Protocol channel isolation
--------------------------
At startup the protocol pipes are duplicated onto private file objects and the
standard descriptors are repointed: fd 0 reads from the null device and fd 1
writes to stderr.  User code can therefore never read the host's requests
(``input()``, ``sys.stdin.read()``, a subprocess inheriting stdin) or corrupt
the response stream (``os.write(1, ...)``, a subprocess inheriting stdout).

Interrupts
----------
A reader thread owns the protocol input.  Requests are queued for the main
thread (FIFO).  An ``{"op": "interrupt", "target": <exec id>}`` request is
handled in the reader thread and raises ``KeyboardInterrupt`` in the main
thread, but only while that exact exec is running.  This is in-band, so it
behaves identically on Windows (where a host cannot deliver SIGINT without
killing the process).
"""

from __future__ import annotations

import ast
import base64
import builtins
import io
import json
import os
import queue
import re
import signal
import sys
import threading
import traceback
import types
import warnings
from typing import Any

# ── Matplotlib Agg bootstrap ─────────────────────────────────────────────────
# Must happen before any user code imports pyplot so the backend is fixed once.
# Suppressing warnings here because matplotlib sometimes warns on the first
# use() call before pyplot is imported.
try:
    import matplotlib
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        matplotlib.use("Agg")
except Exception:
    pass  # matplotlib not installed — handled gracefully in _collect_matplotlib_images

# ── Benign warnings that should not surface as errors in cell output ──────────
# Pattern is matched against each stderr line; matching lines are silently dropped.
_BENIGN_STDERR_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"FigureCanvasAgg is non-interactive"),
    re.compile(r"matplotlib\.pyplot as plt.*non-interactive"),
    re.compile(r"switching to.*Agg"),
    re.compile(r"Cannot load backend.*Agg.*already loaded"),
    re.compile(r"UserWarning:.*Agg"),
]


def _filter_stderr(raw: str) -> str:
    """Remove known benign matplotlib/rendering warnings from stderr."""
    if not raw:
        return raw
    lines = raw.splitlines(keepends=True)
    filtered: list[str] = []
    skip_next = 0
    for line in lines:
        if skip_next > 0:
            skip_next -= 1
            continue
        if any(p.search(line) for p in _BENIGN_STDERR_PATTERNS):
            # Also skip the preceding context line (UserWarning: header line)
            if filtered and filtered[-1].strip().startswith("UserWarning:") or \
               filtered and filtered[-1].strip().startswith("/"):
                filtered.pop()
            skip_next = 1  # skip one following context line
            continue
        filtered.append(line)
    return "".join(filtered)


# Private protocol handles.  Rebound by _isolate_protocol_channel(); until then
# they fall back to the standard streams so importing this module stays safe.
_PROTO_IN: Any = sys.stdin
_PROTO_OUT: Any = sys.stdout
_WRITE_LOCK = threading.Lock()
_REAL_STDOUT = sys.stdout
_REAL_STDERR = sys.stderr


def _isolate_protocol_channel() -> None:
    """Move the protocol onto private handles; neutralise fd 0 and fd 1."""
    global _PROTO_IN, _PROTO_OUT
    _PROTO_IN = os.fdopen(os.dup(0), "r", encoding="utf-8", newline=None)
    _PROTO_OUT = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.close(devnull)
    os.dup2(2, 1)
    sys.stdin = io.StringIO("")
    builtins.input = _unsupported_input  # type: ignore[assignment]


def _unsupported_input(prompt: object = "") -> str:
    raise EOFError(
        "input() is not supported in Studio cells (there is no keyboard attached). "
        "Assign the value in code instead, e.g. `answer = 'text'`."
    )


def _write_response(obj: dict[str, Any]) -> None:
    line = json.dumps(obj, ensure_ascii=False) + "\n"
    with _WRITE_LOCK:
        _PROTO_OUT.write(line)
        _PROTO_OUT.flush()


# ── Interrupt state ───────────────────────────────────────────────────────────
class _ExecState:
    """Which exec (if any) the main thread is running.

    No lock on purpose: the main thread must never block on one while a signal
    handler can raise into it.  Plain attribute stores are atomic under the GIL,
    and the handler re-checks ``current_id`` against ``interrupt_target`` so a
    stale interrupt can never hit a later exec.
    """

    def __init__(self) -> None:
        self.executing = False
        self.current_id = ""
        self.interrupt_target = ""


_STATE = _ExecState()

# Exec ids the reader has queued and the main thread has not finished, and the
# subset an interrupt reached before the cell started.  Closes the race where
# Stop is pressed in the moments between "request sent" and "cell begins".
_QUEUED_IDS: set[str] = set()
_CANCELLED_IDS: set[str] = set()


def _on_sigint(_signum: int, _frame: Any) -> None:
    # Only interrupt user code.  An interrupt that lands while the kernel is
    # idle (or between cells) is dropped rather than killing the request loop.
    if _STATE.executing and _STATE.current_id == _STATE.interrupt_target:
        raise KeyboardInterrupt


def _deliver_interrupt() -> None:
    """Raise KeyboardInterrupt in the main thread, waking blocking calls."""
    main_ident = threading.main_thread().ident
    if hasattr(signal, "pthread_kill") and main_ident is not None:
        # A real signal makes time.sleep / socket / lock waits return EINTR,
        # then the handler raises (PEP 475 only retries if it does not).
        signal.pthread_kill(main_ident, signal.SIGINT)
    else:
        # Windows: raise() runs CPython's C-level SIGINT handler, which sets the
        # SIGINT event that time.sleep and other waits block on.  (_thread.interrupt_main
        # only sets the pending flag and does not wake a sleeping main thread there.)
        signal.raise_signal(signal.SIGINT)


def _collect_matplotlib_images() -> list[str]:
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        return []

    images: list[str] = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", facecolor=fig.get_facecolor())
        images.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    if images:
        plt.close("all")
    return images


def _discard_matplotlib_figures() -> None:
    """Close open figures without rendering (a failed cell must leave none behind)."""
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return
    try:
        plt.close("all")
    except Exception:
        pass


# ── Tracebacks ────────────────────────────────────────────────────────────────
_RUNNER_FILE = os.path.abspath(__file__)


def _is_runner_frame(tb: types.TracebackType) -> bool:
    filename = tb.tb_frame.f_code.co_filename
    try:
        return os.path.abspath(filename) == _RUNNER_FILE
    except Exception:
        return False


def _user_traceback(exc: BaseException) -> str:
    """Format *exc* without the runner's own frames (exec/compile plumbing)."""
    tb = exc.__traceback__
    while tb is not None and _is_runner_frame(tb):
        tb = tb.tb_next
    text = "".join(traceback.format_exception(type(exc), exc, tb))
    # Frames entered from user code back into the runner are not expected, but
    # chained exceptions are formatted with their own tracebacks, which can
    # start in the runner when the cause was raised by plumbing.  Drop those
    # frames line-pair-wise as a last resort.
    if _RUNNER_FILE in text:
        kept: list[str] = []
        lines = text.splitlines(keepends=True)
        i = 0
        while i < len(lines):
            if lines[i].lstrip().startswith("File ") and _RUNNER_FILE in lines[i]:
                i += 1
                while i < len(lines) and lines[i].startswith("    ") and not lines[i].lstrip().startswith("File "):
                    i += 1
                continue
            kept.append(lines[i])
            i += 1
        text = "".join(kept)
    return text


# ── display() ─────────────────────────────────────────────────────────────────
# Images handed to display() during the current cell; drained by _exec_code.
_CELL_IMAGES: list[str] = []
_TAG_RE = re.compile(r"<[^>]+>")
_DEFAULT_REPR_RE = re.compile(r"^<[\w.]+ object( at 0x[0-9a-fA-F]+)?>$")


def _display_one(obj: Any) -> None:
    png = None
    repr_png = getattr(obj, "_repr_png_", None)
    if callable(repr_png):
        try:
            png = repr_png()
        except Exception:
            png = None
    if isinstance(png, tuple):
        png = png[0]
    if isinstance(png, bytes) and png:
        _CELL_IMAGES.append(base64.b64encode(png).decode("ascii"))
        return
    if isinstance(png, str) and png:
        _CELL_IMAGES.append(png)  # already base64 (matches IPython's contract)
        return
    savefig = getattr(obj, "savefig", None)
    if callable(savefig) and hasattr(obj, "get_facecolor"):
        buf = io.BytesIO()
        savefig(buf, format="png", bbox_inches="tight", facecolor=obj.get_facecolor())
        _CELL_IMAGES.append(base64.b64encode(buf.getvalue()).decode("ascii"))
        plt = sys.modules.get("matplotlib.pyplot")
        if plt is not None:
            try:
                plt.close(obj)  # shown now; do not collect it again at cell end
            except Exception:
                pass
        return
    markdown = getattr(obj, "_repr_markdown_", None)
    if callable(markdown):
        try:
            text = markdown()
        except Exception:
            text = None
        if isinstance(text, str) and text:
            print(text)
            return
    text = repr(obj) if not isinstance(obj, str) else obj
    html = getattr(obj, "_repr_html_", None)
    if callable(html) and _DEFAULT_REPR_RE.match(text):
        # HTML-only objects (IPython.display.HTML, folium, plotly, ...).  Plain
        # markup shows as its text; anything that needs a browser does not.
        try:
            markup = html()
        except Exception:
            markup = None
        stripped = _TAG_RE.sub("", markup).strip() if isinstance(markup, str) else ""
        if stripped and "<script" not in markup and "<iframe" not in markup:
            print(stripped)
        else:
            print(f"{text}\n[rich HTML output is not rendered in Studio; showing the text repr]")
        return
    print(text)


def _display(*objs: Any, **_kwargs: Any) -> None:
    """Minimal IPython.display.display(): images and text only."""
    for obj in objs:
        _display_one(obj)


class _TextDisplay:
    """HTML / Markdown stand-ins: show the source as text."""

    def __init__(self, data: str = "", **_kwargs: Any) -> None:
        self.data = data

    def _repr_markdown_(self) -> str:
        return self.data


class _HTML(_TextDisplay):
    def _repr_markdown_(self) -> str:
        return _TAG_RE.sub("", self.data)


class _Markdown(_TextDisplay):
    pass


class _Image:
    def __init__(self, data: bytes | None = None, filename: str | None = None, **_kwargs: Any) -> None:
        if data is None and filename:
            with open(filename, "rb") as handle:
                data = handle.read()
        self.data = data or b""

    def _repr_png_(self) -> bytes:
        return self.data


class _DisplayPatchLoader:
    """Wraps IPython.display's loader so ``display`` is the Studio one after import."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner

    def create_module(self, spec: Any) -> Any:
        return self._inner.create_module(spec)

    def exec_module(self, module: Any) -> None:
        self._inner.exec_module(module)
        module.display = _display


class _DisplayPatchFinder:
    def find_spec(self, name: str, path: Any, target: Any = None) -> Any:
        if name != "IPython.display":
            return None
        import importlib.machinery

        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is not None and spec.loader is not None:
            spec.loader = _DisplayPatchLoader(spec.loader)  # type: ignore[assignment]
        return spec


def _install_ipython_shim() -> None:
    """Make ``from IPython.display import display, HTML, ...`` work with Studio semantics.

    Without IPython installed a minimal stand-in module is provided.  With
    IPython installed the real package is used, but its ``display`` is swapped
    for ours on import: outside an IPython shell the real one only prints a
    ``<IPython.core.display.Image object>`` style repr and drops images.
    """
    import importlib.util

    try:
        have_ipython = importlib.util.find_spec("IPython") is not None
    except (ImportError, ValueError):
        have_ipython = False
    # AIHYDRO_KERNEL_IPYTHON_SHIM=1 forces the stand-in (used by the tests so
    # both paths are covered on machines that do have IPython installed).
    forced = os.environ.get("AIHYDRO_KERNEL_IPYTHON_SHIM") == "1"
    if have_ipython and not forced:
        sys.meta_path.insert(0, _DisplayPatchFinder())  # type: ignore[arg-type]
        return
    sys.meta_path.insert(0, _ShimFinder())  # type: ignore[arg-type]


class _ShimLoader:
    """Builds the stand-in IPython modules the first time user code imports them."""

    def create_module(self, spec: Any) -> Any:
        if spec.name == "IPython":
            pkg = types.ModuleType("IPython")
            pkg.__path__ = []  # type: ignore[attr-defined]
            pkg.get_ipython = lambda: None  # type: ignore[attr-defined]
            # Libraries (matplotlib) sniff IPython's version when it is in sys.modules.
            pkg.version_info = (0, 0, 0)  # type: ignore[attr-defined]
            pkg.__version__ = "0.0.0+aihydro-shim"  # type: ignore[attr-defined]
            return pkg
        mod = types.ModuleType("IPython.display")
        mod.display = _display  # type: ignore[attr-defined]
        mod.HTML = _HTML  # type: ignore[attr-defined]
        mod.Markdown = _Markdown  # type: ignore[attr-defined]
        mod.Image = _Image  # type: ignore[attr-defined]
        mod.clear_output = lambda *a, **k: None  # type: ignore[attr-defined]
        return mod

    def exec_module(self, module: Any) -> None:
        return None


class _ShimFinder:
    def find_spec(self, name: str, path: Any, target: Any = None) -> Any:
        if name not in ("IPython", "IPython.display"):
            return None
        import importlib.machinery

        spec = importlib.machinery.ModuleSpec(name, _ShimLoader(), is_package=(name == "IPython"))  # type: ignore[arg-type]
        return spec


# ── Magics ────────────────────────────────────────────────────────────────────
def _unsupported_magic_message(code: str, exc: SyntaxError) -> str | None:
    """If *exc* came from a %magic / !shell line, return a clear message."""
    lineno = exc.lineno or 0
    lines = code.splitlines()
    if not (1 <= lineno <= len(lines)):
        return None
    text = lines[lineno - 1].strip()
    if not text or text[0] not in "%!":
        return None
    kind = "Shell escapes (`!cmd`)" if text[0] == "!" else "Magic commands (`%magic`)"
    return (
        f"{kind} are not supported in Studio cells: `{text}`\n"
        "Studio runs plain Python, not IPython. Matplotlib figures are shown "
        "automatically (no `%matplotlib inline` needed). Install packages from "
        "a terminal in the selected environment, or use the `subprocess` module."
    )


# Sentinel comment the bridge prepends to a video-render cell so the kernel
# knows to capture a rendered MP4 instead of (or in addition to) figures.
_VIDEO_SENTINEL = "# __aihydro_render_video__"


def _render_manim_videos(namespace: dict[str, Any]) -> list[str]:
    """Render the manim Scene subclasses *defined in this cell* to MP4.

    Only classes authored in the executed code are rendered.  Framework base
    classes pulled in by ``from manim import *`` (MovingCameraScene, ThreeDScene,
    VectorScene, ZoomedScene, …) live in the ``manim`` package and have no
    user ``construct()``, so rendering them produces no video — they are skipped.

    Returns a list of base64-encoded MP4 strings.  Raises if manim is missing or
    a render yields no video, so the caller can surface a graceful note.
    """
    import tempfile
    from pathlib import Path

    from manim import Scene, tempconfig  # type: ignore

    # exec() stamps user-defined classes with the namespace's __name__; library
    # classes keep their own dotted module path (manim.scene.*).  Match on that
    # to render exactly what the author wrote — nothing more.
    cell_module = namespace.get("__name__", "__aihydro_kernel__")
    scenes = [
        obj
        for obj in namespace.values()
        if isinstance(obj, type)
        and issubclass(obj, Scene)
        and obj is not Scene
        and getattr(obj, "__module__", "") == cell_module
    ]
    if not scenes:
        raise RuntimeError(
            "No user-defined manim Scene subclass was found in this cell. "
            "Define `class MyScene(Scene): def construct(self): ...`."
        )

    videos: list[str] = []
    for scene_cls in scenes:
        # Fresh media dir per scene so globbing can't pick up a sibling scene's
        # output and partial-movie files never collide across renders.
        with tempfile.TemporaryDirectory() as media_dir:
            overrides = {
                "media_dir": media_dir,
                "quality": "low_quality",
                "disable_caching": True,
                "verbosity": "ERROR",
                "progress_bar": "none",
            }
            with tempconfig(overrides):
                scene_cls().render()
            # Prefer the final concatenated movie over the per-animation chunks
            # that manim leaves under partial_movie_files/.
            candidates = [
                p for p in Path(media_dir).rglob("*.mp4") if "partial_movie_files" not in p.parts
            ]
            if not candidates:
                candidates = list(Path(media_dir).rglob("*.mp4"))
            if not candidates:
                raise RuntimeError(
                    f"Manim rendered {scene_cls.__name__} but produced no MP4. "
                    "Ensure construct() calls self.play()/self.wait() so there "
                    "are frames to encode."
                )
            with open(candidates[0], "rb") as handle:
                videos.append(base64.b64encode(handle.read()).decode("ascii"))
    return videos


def _exec_video_code(namespace: dict[str, Any], code: str) -> dict[str, Any]:
    result = _exec_code(namespace, code)
    if result["error"]:
        return result
    try:
        result["videos_mp4_base64"] = _render_manim_videos(namespace)
    except ImportError:
        result["stderr"] = (
            (result["stderr"] or "")
            + "\nManim is not installed in this kernel environment. "
            "Add `manim` (and `ffmpeg`) to .aihydro/venv to render video cells."
        )
    except Exception as exc:
        result["error"] = _user_traceback(exc)
        result["status"] = "error"
    return result


def _exec_code(namespace: dict[str, Any], code: str) -> dict[str, Any]:
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    error = ""
    interrupted = False
    result_repr = ""
    del _CELL_IMAGES[:]
    # Suppress the FigureCanvasAgg warning during execution
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="FigureCanvasAgg is non-interactive")
        warnings.filterwarnings("ignore", message=".*non-interactive.*")
        try:
            try:
                parsed = ast.parse(code, "<aihydro-cell>", "exec")
            except SyntaxError as exc:
                magic = _unsupported_magic_message(code, exc)
                if magic is not None:
                    raise _UnsupportedSyntax(magic) from None
                raise
            if parsed.body and isinstance(parsed.body[-1], ast.Expr):
                statements = ast.Module(body=parsed.body[:-1], type_ignores=parsed.type_ignores)
                if statements.body:
                    exec(compile(statements, "<aihydro-cell>", "exec"), namespace, namespace)  # noqa: S102
                expression = ast.Expression(parsed.body[-1].value)
                value = eval(compile(expression, "<aihydro-cell>", "eval"), namespace, namespace)  # noqa: S307
                if value is not None:
                    result_repr = repr(value)
            else:
                exec(compile(parsed, "<aihydro-cell>", "exec"), namespace, namespace)  # noqa: S102
        except _UnsupportedSyntax as exc:
            error = str(exc)
        except KeyboardInterrupt as exc:
            interrupted = True
            error = _user_traceback(exc)
        except BaseException as exc:  # noqa: BLE001 - SystemExit/GeneratorExit in user code must not kill the kernel
            error = _user_traceback(exc)
        finally:
            sys.stdout, sys.stderr = _REAL_STDOUT, _REAL_STDERR

    stdout = stdout_buf.getvalue()
    stderr = _filter_stderr(stderr_buf.getvalue())

    if error:
        # A failed or interrupted cell must not leak its figures into the next one.
        _discard_matplotlib_figures()
        images: list[str] = []
    else:
        images = list(_CELL_IMAGES) + _collect_matplotlib_images()
    del _CELL_IMAGES[:]

    return {
        "stdout": stdout,
        "stderr": stderr,
        "error": error,
        "result_repr": result_repr,
        "images_png_base64": images,
        "status": "interrupted" if interrupted else ("error" if error else "ok"),
    }


class _UnsupportedSyntax(Exception):
    """A cell used IPython-only syntax; the message is shown to the learner verbatim."""


def _interrupted_result(exc: BaseException | None = None) -> dict[str, Any]:
    return {
        "stdout": "",
        "stderr": "",
        "error": _user_traceback(exc) if exc is not None else "KeyboardInterrupt\n",
        "result_repr": "",
        "images_png_base64": [],
        "status": "interrupted",
    }


def _run_exec(namespace: dict[str, Any], exec_id: str, code: str) -> dict[str, Any]:
    """Run one exec with interrupts armed for exactly this request."""
    _STATE.current_id = exec_id
    _STATE.executing = True
    try:
        try:
            if exec_id in _CANCELLED_IDS:
                raise KeyboardInterrupt
            if code.lstrip().startswith(_VIDEO_SENTINEL):
                return _exec_video_code(namespace, code)
            return _exec_code(namespace, code)
        finally:
            # Disarm first: nothing below may be interrupted by a late signal.
            _STATE.executing = False
            _STATE.current_id = ""
            _STATE.interrupt_target = ""
    except KeyboardInterrupt as exc:
        # An interrupt raced the cell's own cleanup; report it as interrupted.
        _STATE.executing = False
        sys.stdout, sys.stderr = _REAL_STDOUT, _REAL_STDERR
        _discard_matplotlib_figures()
        return _interrupted_result(exc)
    finally:
        _STATE.executing = False
        _QUEUED_IDS.discard(exec_id)
        _CANCELLED_IDS.discard(exec_id)


def _new_namespace() -> dict[str, Any]:
    return {"__name__": "__aihydro_kernel__", "__builtins__": __builtins__, "display": _display}


_EOF = object()


def _reader_loop(requests: "queue.Queue[Any]") -> None:
    """Read protocol lines; queue them for the main thread, handle interrupts inline."""
    try:
        for raw in _PROTO_IN:
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError as exc:
                requests.put({"op": "__invalid__", "id": "", "detail": str(exc)})
                continue
            if isinstance(msg, dict) and msg.get("op") == "interrupt":
                target = str(msg.get("target", ""))
                # Order matters: mark a not-yet-started exec first, then signal a running one.
                if target in _QUEUED_IDS:
                    _CANCELLED_IDS.add(target)
                if _STATE.executing and _STATE.current_id == target:
                    _STATE.interrupt_target = target
                    _deliver_interrupt()
                continue
            if isinstance(msg, dict) and msg.get("op", "exec") == "exec":
                _QUEUED_IDS.add(str(msg.get("id", "")))
            requests.put(msg)
    finally:
        requests.put(_EOF)


def main() -> None:
    _isolate_protocol_channel()
    _install_ipython_shim()
    namespace = _new_namespace()
    signal.signal(signal.SIGINT, _on_sigint)

    requests: "queue.Queue[Any]" = queue.Queue()
    threading.Thread(target=_reader_loop, args=(requests,), name="aihydro-protocol-reader", daemon=True).start()

    while True:
        try:
            msg = requests.get()
        except KeyboardInterrupt:
            continue  # a late interrupt delivered while idle
        if msg is _EOF:
            break
        try:
            namespace = _dispatch(namespace, msg)
        except KeyboardInterrupt:
            # A signal escaped every guard. The host must still get an answer for an
            # exec, or it would wait for its timeout.
            _STATE.executing = False
            sys.stdout, sys.stderr = _REAL_STDOUT, _REAL_STDERR
            if isinstance(msg, dict) and msg.get("op", "exec") == "exec":
                _write_response({"id": str(msg.get("id", "")), **_interrupted_result()})
            continue


def _ok(req_id: str, **extra: Any) -> dict[str, Any]:
    return {"id": req_id, "status": "ok", "stdout": "", "stderr": "", "error": "", "result_repr": "", **extra}


def _err(req_id: str, message: str) -> dict[str, Any]:
    return {"id": req_id, "status": "error", "stdout": "", "stderr": "", "error": message, "result_repr": ""}


def _dispatch(namespace: dict[str, Any], msg: Any) -> dict[str, Any]:
    """Handle one request; returns the (possibly replaced) namespace."""
    if not isinstance(msg, dict):
        _write_response(_err("", "Request must be a JSON object"))
        return namespace
    req_id = str(msg.get("id", ""))
    op = msg.get("op", "exec")

    if op == "__invalid__":
        _write_response(_err("", f"Invalid JSON: {msg.get('detail', '')}"))
    elif op == "ping":
        _write_response(_ok(req_id, stdout="pong"))
    elif op == "warm":
        # Pre-import the heavy libs most cells touch so the first real
        # exec doesn't pay the numpy/matplotlib import cost on screen.
        try:
            import numpy  # noqa: F401
            import matplotlib  # noqa: F401
            import matplotlib.pyplot  # noqa: F401
        except Exception:
            pass
        _write_response(_ok(req_id))
    elif op == "env":
        # Installed distributions, for the run record's environment digest.
        try:
            from importlib import metadata

            pins = sorted(
                {f"{(d.metadata['Name'] or '').lower()}=={d.version}" for d in metadata.distributions() if d.metadata['Name']}
            )
        except Exception:
            pins = []
        _write_response(_ok(req_id, stdout="\n".join(pins)))
    elif op == "restart":
        namespace = _new_namespace()
        _write_response(_ok(req_id))
    elif op == "exec":
        code = msg.get("code", "")
        if not isinstance(code, str):
            _write_response(_err(req_id, "code must be a string"))
        else:
            result = _run_exec(namespace, req_id, code)
            _write_response({"id": req_id, **result})
    else:
        _write_response(_err(req_id, f"Unknown op: {op}"))
    return namespace


if __name__ == "__main__":
    main()
