# Authoring and signing a Learning Pack

`aihydro-pack` turns a course into a signed `.aihydropack` that the installed extension accepts, and after you click Allow its Python cells run. Catalogue courses downloaded from the marketplace are unsigned and can never run Python; a signed pack is how a course gets to run.

This page is for course authors. The archive format and the verifier are specified in [Learning Pack v1](learning-pack-v1.md); how the trust bar behaves is in [Studio trust model](studio-trust-model.md).

## The short version

```bash
npm run build:pack-cli                       # once: builds dist/aihydro-pack.cjs
alias aihydro-pack='node /path/to/AI-Hydro/dist/aihydro-pack.cjs'

aihydro-pack init-key                        # once, by you, in your own terminal
aihydro-pack build courses/my-course \
  --root . --config pack.config.json \
  --kind release --publisher-pub ~/.ssh/aihydro-learning-pack/ed25519.pub.pem \
  --out dist/my-course.unsigned.aihydropack
aihydro-pack sign dist/my-course.unsigned.aihydropack --out dist/my-course.aihydropack
aihydro-pack verify dist/my-course.aihydropack --expect-fingerprint sha256:<your published fingerprint>
```

`npm run aihydro-pack -- <command>` does the same and rebuilds the CLI first.

## What signed means, and what it does not

A valid pack is **signed by the key with this fingerprint**. The fingerprint is `sha256:` plus the SHA-256 of the key's public bytes (SPKI DER). That is all the signature establishes: the bytes in the pack are the bytes that key signed.

It does **not** say who owns the key. Anyone can make a key and put any name in `publisher.name`; the name is only a label. A reader knows a pack is yours only by comparing its fingerprint with the one you published through a channel they already trust (your README, your docs site, your profile). It also does not say the pack's code is harmless, and there is no revocation in v1: if a key leaks, publish a new key and a new fingerprint and ask readers to remove the old one under **AI-Hydro: Manage Trusted Learning Pack Publishers**.

## Who may do what (owner and agent)

| Command | Needs you at a terminal? | Notes |
|---|---|---|
| `init-key` | Yes. Refused in an agent session. | Creates your key. Never overwrites. |
| `sign --key` | Yes. Refused in an agent session. | Uses your key and passphrase. |
| `sign --ephemeral` | No | Development builds only. Throwaway key. |
| `build`, `verify`, `inspect` | No | Agents can build and verify. |
| `fingerprint` of a public key or a pack | No | |
| `fingerprint` of a private key | Yes | Reads the private key. |

"Refused" means exit code 3 and nothing is written. The tool refuses when `AIHYDRO_AGENT_CONTEXT`, `AIHYDRO_ACTIVE` or `CLAUDECODE` is set in the environment, or when standard input or output is not a terminal. AI-Hydro's own agent also cannot run `aihydro-pack sign` or `aihydro-pack init-key`: the command policy denies them, like `aihydro-approve`, whatever the auto-approve settings say.

**This is a guard, not a boundary.** The command policy is a **denylist of text patterns**: it recognises the obvious ways to run `aihydro-pack sign` or `init-key`, to name the signer's source files, or to read the default key directory (`~/.ssh/aihydro-learning-pack`, `ed25519.key.pem`), and it refuses them for the agent. Anything that does not spell those names in the command text is invisible to it. Known bypass shapes, generically: building the command from variables or string pieces, decoding it from an encoded payload, running a script file written earlier, a program that launches another program, a key kept under a custom directory name, and a subagent or other process that is not governed by the policy at all. The check that actually matters is the **owner terminal check** inside `init-key` and `sign --key`: no agent marker in the environment and a real TTY on stdin and stdout. A process running as your user can still read your environment and your key file, so the real protection for the signing key is its passphrase, which is typed on the terminal and never accepted from an environment variable, a flag, a file, standard input or any tool call. Use a passphrase you do not reuse, and do not leave the key unlocked or in a shared directory. `init-key --no-passphrase` writes an unencrypted key and prints a warning saying so; it removes the one protection that matters, so use it only on a machine you fully control. Agents never create or use a real key; their tests use throwaway in-memory keys only.

## One-time setup: your key

Run this yourself, in a terminal that is not inside an agent:

```bash
aihydro-pack init-key                 # default directory ~/.ssh/aihydro-learning-pack
aihydro-pack init-key --out /path     # elsewhere (never inside a git repository)
```

- The directory is created `0700` and the key file `0600` (`ed25519.key.pem`); a public key `ed25519.pub.pem` sits next to it. File modes are not enforced on Windows; keep the key in your user profile.
- The key is Ed25519, written as encrypted PKCS#8 (scrypt plus AES-256-CBC). You choose the passphrase (12 characters or more, asked twice, not echoed). `--no-passphrase` writes an unencrypted key; use it only on a machine you fully control.
- It prints only the public key path and the `sha256:` fingerprint, never any key material.
- It refuses to overwrite an existing key and refuses any location inside a git work tree.
- `~/.ssh` is already a protected location for AI-Hydro's agent file tools and commands.

Then:

1. **Back up the private key offline.** Losing it means you cannot publish an upgrade under the same fingerprint.
2. **Publish the fingerprint** out of band (README, docs site, profile).

## `pack.config.json`

Everything about the pack that is not in the course sources. Unknown keys are an error.

```json
{
  "schemaVersion": 1,
  "packId": "aihydro.intro-hydro",
  "version": "0.2.0",
  "edition": "student",
  "publisher": { "name": "Your Name" },
  "aiHydroRange": ">=0.4.0 <0.5.0",
  "localPython": "terminal-equivalent",
  "idPrefix": "aihydro.intro-hydro.",
  "idMap": { "intro-hydro-2026": "aihydro.intro-hydro.course" },
  "environment": { "python": ">=3.11", "requiredImports": ["numpy", "matplotlib"] },
  "files": [{ "source": "data/streamflow.csv", "dest": "datasets/streamflow.csv" }]
}
```

| Key | Required | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1`. |
| `packId`, `version`, `edition` | yes | Pack ID (contract ID pattern), SemVer, `student` or `instructor`. |
| `publisher.name` | yes | Informational only. The publisher's key ID is not written here; it comes from `--publisher-pub`. |
| `title`, `license` | no | Default to the source `course.json`. |
| `aiHydroRange` | no | Compatible AI-Hydro versions. Default `>=0.4.0 <0.5.0`. |
| `localPython` | no | `terminal-equivalent` (default) or `none`. A pack that says `none` cannot ship a module whose manifest requires execution. |
| `entryModule` | no | Source module ID that opens first. Default: the first module in `course.json`. |
| `idPrefix`, `idMap` | no | Namespaced IDs, see below. |
| `environment` | no | Written to `environments/environment.json`. |
| `files` | no | Extra files. `dest` must be under `assets/`, `datasets/`, `citations/` or `environments/`. |

### Why IDs get a namespace

An installed pack owns its course ID and module IDs, and the installer rejects a pack whose IDs collide with content already installed from the marketplace. The catalogue's `intro-hydro-2026` course and its modules are installed that way, so a signed pack for the same course must use different IDs. `idMap` maps a source ID (the course ID or a module ID) to a pack ID; `idPrefix` is added to every source ID that has no `idMap` entry. Every result must match the contract ID pattern (`^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$`), be unique, and an `idMap` key that matches nothing is an error.

When an ID changes, the builder rewrites **only** the `"id"` value inside the module's `application/vnd.aihydro.module+json` block (every other byte of the HTML is kept, and the result is re-parsed to prove it), rebuilds `course.json` with the new IDs and prerequisites, and records each change in `provenance/provenance.json` under `transforms`. Progress and control state for a pack is scoped by pack, course, edition and module, so a renamed module starts with no saved state.

`course.json` in the pack is rebuilt from an allowlist of fields. `downloadUrl` is dropped (a pack is a local archive) and so is `trustLevel` (a course cannot grant itself trust). The dropped field names are recorded in `transforms`.

## Building

```bash
aihydro-pack build <course-dir> --out FILE [--config FILE] [--publisher-pub FILE]
                   [--kind development|release] [--root DIR] [--source-commit SHA] [--force]
```

- `<course-dir>` holds `course.json`. `--config` defaults to `<course-dir>/pack.config.json`. For a release build keep the config in the source repository (inside `--root`) and commit it: it decides the IDs, range and license that get signed, so it must be the committed bytes too.
- **Every source file must live under the root.** The root defaults to the course directory. A course whose `course.json` points at `../../modules/...` needs `--root` set to the repository (or other directory) that contains them. Symbolic links and files outside the root are refused.
- **`--kind release`** needs `--publisher-pub` (the key ID is a signed field), a **clean git work tree**, **every included file, and `pack.config.json` itself, tracked by git and byte-identical to the blob committed at HEAD** (an untracked, gitignored or edited source file is refused even if `git status` is blind to it, for example after `--assume-unchanged` or `--skip-worktree`; file names are matched literally, never as globs), so the recorded commit really contains what was signed, and `--source-commit`, if given, equal to HEAD. `--kind development` (the default) accepts a dirty tree; without `--publisher-pub` it writes a placeholder key ID that `sign --ephemeral` replaces.
- `provenance.sourceDirty` is `true` or `false` only when the tree was actually checked against HEAD; it is `null` (unknown) outside a git work tree or when a commit other than HEAD is recorded.
- The output is an **unsigned** archive: everything except the signature. Nothing is written unless the real verifier accepts the pack: the builder signs a trial copy with a throwaway key and runs the extension's own verifier on it, so schema, ownership, paths, limits, module manifests and the compatibility range are all checked before any file is created. The output is written to a temp file in the same directory and then moved into place; an existing output is never replaced without `--force`, and a symbolic link at the output path is always refused.

### Deterministic output

The same sources, config, commit and key give byte-identical archives on every machine: stored (uncompressed) ZIP entries in contract order, a fixed 1980-01-01 timestamp, fixed file modes, canonical JSON, and `generatedAt` taken from `SOURCE_DATE_EPOCH` or else the commit time. Check two builds with `sha256sum`.

Line endings matter because file bytes are hashed: a checkout that converts LF to CRLF changes the hash. Keep course sources LF, for example with a `.gitattributes` containing `* text=auto eol=lf` and binary assets marked `binary`.

## Signing

```bash
aihydro-pack sign <unsigned> --out FILE [--key FILE] [--force]      # your release key
aihydro-pack sign <unsigned> --out FILE --ephemeral                 # development builds only
```

`sign --key` (default key `~/.ssh/aihydro-learning-pack/ed25519.key.pem`) must be run by you at a terminal. It requires a regular, non-symlink key file that only you can read, outside any git work tree, whose fingerprint equals the pack's key ID, and only signs `release` builds. It asks for the passphrase, signs the exact `checksums.json` bytes already in the archive, runs the full verifier on the result, and writes the file only if the verdict is `valid`.

`sign --ephemeral` is for trying a course end to end. It makes a throwaway key in memory, writes its fingerprint into `pack.json`, signs, and forgets the key. The result is a development build that AI-Hydro installs as **signed-untrusted**; it cannot be reproduced and cannot be trusted across upgrades.

## Verifying and inspecting

```bash
aihydro-pack verify <pack> [--expect-fingerprint sha256:HEX] [--ai-hydro-version V] [--json]
aihydro-pack inspect <pack> [--ai-hydro-version V] [--json]
aihydro-pack fingerprint <public-key | pack>
```

`verify` runs the installed extension's own verifier, so a `valid` here is a `valid` in the product. It checks compatibility against the version of AI-Hydro this tool ships with unless you pass `--ai-hydro-version`. `--expect-fingerprint` also fails if the signer is not the key you expect. `inspect` prints the manifest summary and the provenance (including the ID `transforms`).

Exit codes: `0` success, `1` the work failed (invalid input, unverifiable pack, fingerprint mismatch), `2` usage error, `3` refused (agent context, no terminal, unsafe key location).

## What a reader sees

A reader installs your pack with **AI-Hydro: Install Learning Pack** (or the Explorer menu on the file, or the **Install Learning Pack…** button on the trust bar of a read-only catalogue copy). The approval dialog shows the signer fingerprint; they choose **Install Once** or **Trust Publisher and Install**. Trusting a publisher stores that fingerprint, so give readers yours to compare. After that, a module's trust bar offers **Allow execution** per document, and VS Code workspace trust and the Python execution policy still apply.

## Limits worth knowing

- Packs are local files in v1. The catalogue cannot yet install a signed pack; that needs its own decision (ADR-005 forbids remote pack fetches in v1).
- The installed-pack content security policy blocks external fonts, scripts and network requests, so a course that loads Google Fonts or calls a web API from a module will not do so inside a pack. Use packaged fonts and datasets.
- No revocation, no verified publisher identity, no sandbox around the Python the pack runs.
- Windows does not enforce file mode bits; the key-file checks that depend on them are skipped there.
