import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CELL_BRIDGE_SCRIPT, STATIC_SCENE3D_NOTICE_SCRIPT } from "../aihydroCellBridge"

/** Run an injected `<script>...</script>` string in the jsdom window, as the srcdoc iframe would. */
function runInjected(script: string) {
	const body = script.replace(/^<script>/, "").replace(/<\/script>$/, "")
	// biome-ignore lint/security/noGlobalEval: evaluating the real injected bridge is the point of these tests
	;(0, eval)(body)
}

type Scene3dApi = {
	scene3d: (opts: Record<string, unknown>) => Promise<null | Record<string, any>>
}

/** A minimal three.js double that records pixel ratio, renders and disposals. */
function installFakeThree(opts: { throwOnRenderer?: boolean; throwOnControls?: boolean } = {}) {
	// One WebGL context per canvas, as in a browser: once lost it stays lost for that canvas.
	const contexts = new WeakMap<HTMLCanvasElement, { lost: boolean; isContextLost: () => boolean }>()
	const log = {
		pixelRatios: [] as number[],
		renders: 0,
		rendererDisposed: 0,
		geometryDisposed: 0,
		materialDisposed: 0,
		controlsDisposed: 0,
		controlChange: null as null | (() => void),
		controlUpdateResult: false,
		renderers: 0,
		forcedLoss: 0,
		lose: (c: HTMLCanvasElement) => {
			const ctxOfCanvas = contexts.get(c)
			if (ctxOfCanvas) ctxOfCanvas.lost = true
		},
	}
	class Scene {
		background: unknown = null
		children: any[] = []
		add(o: any) {
			this.children.push(o)
		}
		traverse(fn: (o: any) => void) {
			fn(this)
			for (const c of this.children) fn(c)
		}
	}
	const T: Record<string, unknown> = {
		Scene,
		Color: class {},
		PerspectiveCamera: class {
			position = { set() {} }
			aspect = 1
			updateProjectionMatrix() {}
		},
		AmbientLight: class {},
		DirectionalLight: class {
			position = { set() {} }
		},
		WebGLRenderer: class {
			domElement: HTMLCanvasElement
			constructor(o: { canvas: HTMLCanvasElement }) {
				if (opts.throwOnRenderer) throw new Error("Error creating WebGL context.")
				this.domElement = o.canvas
				if (!contexts.has(o.canvas)) {
					const c = { lost: false, isContextLost: () => c.lost }
					contexts.set(o.canvas, c)
				}
				log.renderers++
			}
			getContext() {
				return contexts.get(this.domElement)
			}
			setPixelRatio(r: number) {
				log.pixelRatios.push(r)
			}
			setSize() {}
			render() {
				log.renders++
			}
			dispose() {
				log.rendererDisposed++
			}
			forceContextLoss() {
				log.forcedLoss++
				contexts.get(this.domElement)!.lost = true
			}
		},
	}
	// Always present: without it the helper would try the CDN, which never answers in jsdom.
	{
		T.OrbitControls = class {
			constructor() {
				if (opts.throwOnControls) throw new Error("controls failed")
			}
			enableDamping = false
			dampingFactor = 0
			addEventListener(_: string, fn: () => void) {
				log.controlChange = fn
			}
			removeEventListener() {}
			update() {
				return log.controlUpdateResult
			}
			dispose() {
				log.controlsDisposed++
			}
		}
	}
	;(window as any).THREE = T
	return { T, log }
}

/** requestAnimationFrame as an explicit queue so tests control exactly when frames run. Cancel removes only its own id. */
function installManualRaf() {
	const pending = new Map<number, FrameRequestCallback>()
	let nextId = 1
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		pending.set(nextId, cb)
		return nextId++
	})
	vi.stubGlobal("cancelAnimationFrame", (id: number) => {
		pending.delete(id)
	})
	return {
		queue: {
			get length() {
				return pending.size
			},
		},
		flush() {
			const run = [...pending.values()]
			pending.clear()
			for (const cb of run) cb(0)
		},
	}
}

function canvasInDom(attrs = "") {
	document.body.innerHTML = `<canvas id="c" data-aihydro-scene3d ${attrs}></canvas>`
	return document.getElementById("c") as HTMLCanvasElement
}

function loadBridge(): Scene3dApi {
	delete (window as any).aihydro
	runInjected(CELL_BRIDGE_SCRIPT)
	return (window as any).aihydro
}

/** Recording MutationObserver: real ones would outlive the test and fire into a torn-down document. */
const mutationCallbacks: MutationCallback[] = []
const observerState = { roDisconnects: 0, ioDisconnects: 0, ioCallbacks: [] as IntersectionObserverCallback[] }

beforeEach(() => {
	mutationCallbacks.length = 0
	observerState.roDisconnects = 0
	observerState.ioDisconnects = 0
	observerState.ioCallbacks = []
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {
				observerState.roDisconnects++
			}
		},
	)
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(cb: IntersectionObserverCallback) {
				observerState.ioCallbacks.push(cb)
			}
			observe() {}
			disconnect() {
				observerState.ioDisconnects++
			}
		},
	)
	vi.stubGlobal(
		"MutationObserver",
		class {
			constructor(cb: MutationCallback) {
				mutationCallbacks.push(cb)
			}
			observe() {}
			disconnect() {}
		},
	)
	document.body.innerHTML = ""
	delete (window as any).THREE
	// jsdom has no layout: the helper's defaults (480x320) apply.
	vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
	vi.unstubAllGlobals()
	delete (window as any).THREE
	delete (window as any).aihydro
})

describe("scene3d fallback", () => {
	it("shows the declared poster and a message, and resolves null, when WebGL context creation fails", async () => {
		installFakeThree({ throwOnRenderer: true })
		canvasInDom()
		document.body.insertAdjacentHTML(
			"beforeend",
			'<img id="poster" data-aihydro-scene3d-fallback hidden alt="Terrain of the basin" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
		)
		const result = await loadBridge().scene3d({ canvas: "#c" })
		const poster = document.getElementById("poster") as HTMLImageElement
		expect(result).toBeNull()
		expect(poster.hasAttribute("hidden")).toBe(false)
		expect(document.getElementById("c")!.style.display).toBe("none")
		expect(document.querySelector("[data-aihydro-scene3d-message]")!.textContent).toContain("3D view unavailable")
	})

	it("builds an <img> from data-poster, using the canvas aria-label as its alt text", async () => {
		installFakeThree({ throwOnRenderer: true })
		canvasInDom('data-poster="data:image/gif;base64,R0lGODlhAQABAAAAACw=" aria-label="Elevation of the catchment"')
		await loadBridge().scene3d({ canvas: "#c" })
		const img = document.querySelector("img[data-aihydro-scene3d-fallback]") as HTMLImageElement
		expect(img.alt).toBe("Elevation of the catchment")
	})

	it("shows a visible text message when the page declares no fallback at all", async () => {
		installFakeThree({ throwOnRenderer: true })
		canvasInDom()
		await loadBridge().scene3d({ canvas: "#c" })
		const msg = document.querySelector("[data-aihydro-scene3d-message]") as HTMLElement
		expect(msg.textContent).toMatch(/WebGL could not be started/)
		expect(document.querySelector("img")).toBeNull()
	})

	it("hides the declared fallback only after the first drawn frame", async () => {
		const raf = installManualRaf()
		installFakeThree({})
		canvasInDom()
		document.body.insertAdjacentHTML("beforeend", '<img id="poster" data-aihydro-scene3d-fallback alt="x" src="data:,">')
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		const poster = document.getElementById("poster")!
		expect(ctx).not.toBeNull()
		expect(poster.hasAttribute("hidden")).toBe(false)
		raf.flush()
		expect(poster.hasAttribute("hidden")).toBe(true)
		ctx!.dispose()
	})

	it("the untrusted-document notice replaces the canvas with its poster and an explicit message, without defining the helper", () => {
		canvasInDom()
		document.body.insertAdjacentHTML(
			"beforeend",
			'<img id="poster" data-aihydro-scene3d-fallback hidden alt="x" src="data:,">',
		)
		delete (window as any).aihydro
		runInjected(STATIC_SCENE3D_NOTICE_SCRIPT)
		expect((window as any).aihydro).toBeUndefined()
		expect(document.getElementById("poster")!.hasAttribute("hidden")).toBe(false)
		expect(document.querySelector("[data-aihydro-scene3d-message]")!.textContent).toMatch(/untrusted/)
		expect(document.getElementById("c")!.style.display).toBe("none")
	})
})

describe("scene3d pixel ratio", () => {
	it.each([
		[3, 2],
		[2, 2],
		[1.5, 1.5],
		[1, 1],
	])("caps devicePixelRatio %s at %s", async (dpr, expected) => {
		installManualRaf()
		const { log } = installFakeThree({})
		vi.stubGlobal("devicePixelRatio", dpr)
		canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		expect(log.pixelRatios).toEqual([expected])
		expect(ctx!.pixelRatio).toBe(expected)
		ctx!.dispose()
	})
})

describe("scene3d render scheduling", () => {
	it("draws one frame for a static scene and then nothing until invalidated", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		raf.flush()
		expect(log.renders).toBe(1)
		expect(raf.queue.length).toBe(0)
		raf.flush()
		expect(log.renders).toBe(1)
		ctx!.invalidate()
		ctx!.invalidate() // coalesced into one frame
		expect(raf.queue.length).toBe(1)
		raf.flush()
		expect(log.renders).toBe(2)
		expect(raf.queue.length).toBe(0)
		ctx!.dispose()
	})

	it("redraws on a control change and keeps drawing while damping settles", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		raf.flush()
		log.controlChange!()
		log.controlUpdateResult = true
		raf.flush()
		expect(log.renders).toBe(2)
		expect(raf.queue.length).toBe(1) // update() still moving: another frame
		log.controlUpdateResult = false
		raf.flush()
		expect(log.renders).toBe(3)
		expect(raf.queue.length).toBe(0)
		ctx!.dispose()
	})

	it("runs continuously only when onFrame is given", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const onFrame = vi.fn()
		const ctx = await loadBridge().scene3d({ canvas: "#c", onFrame })
		raf.flush()
		raf.flush()
		raf.flush()
		expect(log.renders).toBe(3)
		expect(onFrame).toHaveBeenCalledTimes(3)
		ctx!.stop()
		expect(raf.queue.length).toBe(0)
		ctx!.dispose()
	})

	it("under reduced motion stops animation but still redraws on a drag", async () => {
		const raf = installManualRaf()
		vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q }))
		const { log } = installFakeThree({})
		canvasInDom()
		const onFrame = vi.fn()
		const ctx = await loadBridge().scene3d({ canvas: "#c", onFrame, autoRotate: true })
		raf.flush()
		expect(log.renders).toBe(1)
		expect(raf.queue.length).toBe(0)
		expect(onFrame).not.toHaveBeenCalled()
		log.controlChange!() // the user drags
		raf.flush()
		expect(log.renders).toBe(2)
		ctx!.dispose()
	})
})

describe("scene3d teardown and recovery", () => {
	it("disposes renderer, controls, geometries and materials, and stops drawing", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const ctx = await loadBridge().scene3d({
			canvas: "#c",
			setup(c: any) {
				c.scene.add({
					geometry: { dispose: () => log.geometryDisposed++ },
					material: { dispose: () => log.materialDisposed++ },
				})
			},
		})
		ctx!.dispose()
		expect(log.rendererDisposed).toBe(1)
		expect(log.controlsDisposed).toBe(1)
		expect(log.geometryDisposed).toBe(1)
		expect(log.materialDisposed).toBe(1)
		ctx!.invalidate()
		expect(raf.queue.length).toBe(0)
		ctx!.dispose() // idempotent
		expect(log.rendererDisposed).toBe(1)
	})

	it("releases GPU resources when the canvas is removed from the page", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		const canvas = canvasInDom()
		await loadBridge().scene3d({ canvas: "#c" })
		canvas.remove()
		for (const cb of mutationCallbacks) cb([], {} as MutationObserver)
		expect(log.rendererDisposed).toBe(1)
	})

	it("rebuilds on a fresh canvas and re-runs setup when the panel is shown again after a lost context", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		const old = canvasInDom()
		const setup = vi.fn()
		const ctx = await loadBridge().scene3d({ canvas: "#c", setup })
		raf.flush()
		expect(setup).toHaveBeenCalledTimes(1)
		const lostEvent = new Event("webglcontextlost", { cancelable: true })
		old.dispatchEvent(lostEvent)
		expect(lostEvent.defaultPrevented).toBe(true)
		// No webglcontextrestored arrives (hidden panel). Becoming visible must recover.
		document.dispatchEvent(new Event("visibilitychange"))
		const fresh = document.getElementById("c") as HTMLCanvasElement
		expect(fresh).not.toBe(old)
		expect(ctx!.canvas).toBe(fresh)
		expect(setup).toHaveBeenCalledTimes(2)
		expect(log.renderers).toBe(2)
		expect(log.rendererDisposed).toBe(1)
		raf.flush()
		expect(log.renders).toBe(2)
		ctx!.dispose()
	})
})

describe("scene3d re-init and races", () => {
	it("a second call on the same canvas replaces the first without killing the canvas's context", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const first = await loadBridge().scene3d({ canvas: "#c" })
		const second = await (window as any).aihydro.scene3d({ canvas: "#c" })
		expect(first).not.toBeNull()
		expect(second).not.toBeNull() // not the "unavailable" fallback
		expect(log.forcedLoss).toBe(0)
		expect(log.rendererDisposed).toBe(1)
		expect(document.querySelector("[data-aihydro-scene3d-message]")).toBeNull()
		expect(document.getElementById("c")!.style.display).not.toBe("none")
		second!.dispose()
		expect(log.forcedLoss).toBe(1) // explicit dispose does free the context
	})

	it("of two near-simultaneous calls the later one wins and the earlier one is abandoned", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const api = loadBridge()
		const setupA = vi.fn()
		const setupB = vi.fn()
		const [a, b] = await Promise.all([
			api.scene3d({ canvas: "#c", setup: setupA }),
			api.scene3d({ canvas: "#c", setup: setupB }),
		])
		expect(a).toBeNull()
		expect(b).not.toBeNull()
		expect(setupA).not.toHaveBeenCalled()
		expect(setupB).toHaveBeenCalledTimes(1)
		expect(log.renderers).toBe(1)
		expect(document.querySelector("[data-aihydro-scene3d-message]")).toBeNull()
		b!.dispose()
	})
})

describe("scene3d lifecycle events", () => {
	it("pagehide disposes and frees the context", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		await loadBridge().scene3d({ canvas: "#c" })
		window.dispatchEvent(new Event("pagehide"))
		expect(log.rendererDisposed).toBe(1)
		expect(log.forcedLoss).toBe(1)
	})

	it("disconnects the resize and intersection observers on dispose", async () => {
		installManualRaf()
		installFakeThree({})
		canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		const ro = observerState.roDisconnects
		const io = observerState.ioDisconnects
		ctx!.dispose()
		expect(observerState.roDisconnects).toBeGreaterThan(ro)
		expect(observerState.ioDisconnects).toBeGreaterThan(io)
	})

	it("a visibilitychange storm on a healthy context neither rebuilds nor queues more than one frame", async () => {
		const raf = installManualRaf()
		const { log } = installFakeThree({})
		canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		raf.flush()
		for (let i = 0; i < 50; i++) document.dispatchEvent(new Event("visibilitychange"))
		expect(log.renderers).toBe(1)
		expect(raf.queue.length).toBe(1)
		ctx!.dispose()
	})

	it("a visibilitychange storm after a loss rebuilds exactly once", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		const canvas = canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
		for (let i = 0; i < 50; i++) document.dispatchEvent(new Event("visibilitychange"))
		expect(ctx!.rebuilds).toBe(1)
		expect(log.renderers).toBe(2)
		ctx!.dispose()
	})

	it("rebuilds from webglcontextrestored when the panel is visible, but waits while hidden", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		const canvas = canvasInDom()
		const ctx = await loadBridge().scene3d({ canvas: "#c" })
		canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }))
		const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
		canvas.dispatchEvent(new Event("webglcontextrestored"))
		expect(ctx!.rebuilds).toBe(0)
		hidden.mockReturnValue(false)
		canvas.dispatchEvent(new Event("webglcontextrestored"))
		expect(ctx!.rebuilds).toBe(1)
		expect(log.renderers).toBe(2)
		ctx!.dispose()
	})
})

describe("scene3d edge cases", () => {
	it("re-running on a canvas whose lost context was never rebuilt continues on a fresh canvas", async () => {
		installManualRaf()
		const { log } = installFakeThree({})
		const old = canvasInDom()
		const api = loadBridge()
		await api.scene3d({ canvas: "#c" })
		old.dispatchEvent(new Event("webglcontextlost", { cancelable: true })) // hidden panel: no rebuild
		log.lose(old) // the browser really did lose it: reusing this canvas would fail
		const second = await api.scene3d({ canvas: "#c" })
		expect(second).not.toBeNull()
		expect(document.getElementById("c")).not.toBe(old)
		expect(second!.canvas).toBe(document.getElementById("c"))
		expect(document.querySelector("[data-aihydro-scene3d-message]")).toBeNull()
		expect(log.renderers).toBe(2)
		second!.dispose()
	})

	it("disposes the renderer when OrbitControls construction throws, and falls back", async () => {
		const { log } = installFakeThree({ throwOnControls: true })
		canvasInDom()
		const result = await loadBridge().scene3d({ canvas: "#c" })
		expect(result).toBeNull()
		expect(log.rendererDisposed).toBe(1)
		expect(document.querySelector("[data-aihydro-scene3d-message]")).not.toBeNull()
	})
})
