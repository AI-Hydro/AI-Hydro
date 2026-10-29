import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import React, { useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MapToolRibbon } from "../MapToolRibbon"
import { useMapChrome } from "../mapChrome"

const props: any = {
	layerCount: 2,
	layers: [],
	visibleLayerIds: new Set<string>(),
	layerOrder: [],
	mapStyle: "dark",
	currentBasemap: "usgs-topo",
	onBasemapChange: vi.fn(),
	onVisibilityChange: vi.fn(),
	onZoomToLayer: vi.fn(),
	onReorder: vi.fn(),
	viewState: { longitude: 0, latitude: 0, zoom: 3 },
	layerOpacities: {},
	getMapCanvas: () => null,
	renderIssues: [],
	rasterRevision: 0,
}

/** MapView owns the chrome controller; here a tiny host does, measuring the window (jsdom has no layout). */
const Host: React.FC<any> = (hostProps) => {
	const ref = useRef<HTMLDivElement>(null)
	const chrome = useMapChrome(ref, hostProps.activeTool != null)
	return (
		<div ref={ref}>
			<MapToolRibbon {...props} {...hostProps} chrome={chrome} />
		</div>
	)
}

const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: w })
beforeEach(() => localStorage.clear())
afterEach(() => {
	cleanup()
	setWidth(1024)
})

const rail = () => within(screen.getByRole("navigation", { name: "Map tools" }))
const lit = () =>
	rail()
		.getAllByRole("button")
		.filter((b) => b.getAttribute("aria-pressed") === "true")
		.map((b) => b.getAttribute("aria-label"))
const openMore = () => fireEvent.click(rail().getByRole("button", { name: "More tools" }))
const moreItem = (name: string | RegExp) => screen.getByRole("menuitem", { name })

describe("MapToolRibbon rail", () => {
	it("is a 40 px rail of five tools and More, with codicons, accessible names and no emoji", () => {
		setWidth(1280)
		const { container } = render(<Host />)
		const names = rail()
			.getAllByRole("button")
			.map((b) => b.getAttribute("aria-label"))
		expect(names).toEqual([
			"Layer manager (2 visible · 0 hidden)",
			"Search",
			"Pins",
			"Measure",
			"Draw ROI",
			"More tools",
			"Collapse map tools",
		])
		for (const b of rail().getAllByRole("button")) {
			expect(b.querySelector(".codicon")).not.toBeNull()
		}
		expect(container.textContent ?? "").not.toMatch(/\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u)
		// No visible text beside the icons: labels are tooltips and live in the More menu.
		for (const b of rail().getAllByRole("button"))
			expect(b.textContent).toBe(b.querySelector(".map-ribbon-badge")?.textContent ?? "")
	})

	it("opens the existing Annotations panel from Pins", () => {
		setWidth(1280)
		render(<Host annotationsPanel={<div>annotations-content</div>} />)
		fireEvent.click(rail().getByRole("button", { name: "Pins" }))
		expect(screen.getByRole("region", { name: "Pins" })).toHaveTextContent("annotations-content")
	})

	it("keeps Swipe, Time and Flood and the rest in the More menu, not on the rail", () => {
		setWidth(1280)
		render(<Host />)
		expect(rail().queryByRole("button", { name: /Swipe|Time slider|Flood|Export|Transect/ })).toBeNull()
		openMore()
		for (const name of [/^Transect/, /^Swipe/, /^Time slider/, /^Flood/, /^Export/, /^Research Gallery/, /^Hide map tools/]) {
			expect(moreItem(name)).toBeInTheDocument()
		}
	})
})

describe("MapToolRibbon single active panel", () => {
	it("never lights two items: opening another tool replaces the first", () => {
		setWidth(1280)
		render(<Host />)
		fireEvent.click(rail().getByRole("button", { name: "Search" }))
		expect(lit()).toEqual(["Search"])
		fireEvent.click(rail().getByRole("button", { name: "Measure" }))
		expect(lit()).toEqual(["Measure"])
		fireEvent.click(rail().getByRole("button", { name: "Measure" }))
		expect(lit()).toEqual([])
	})

	it("lights More, and only More, while a tool from its menu is open", () => {
		setWidth(1280)
		render(<Host />)
		openMore()
		fireEvent.click(moreItem(/^Transect/))
		expect(lit()).toEqual(["More tools"])
		expect(screen.queryByRole("menu")).toBeNull()
	})

	it("treats Basemap and Reference as tabs of Layers, with Layers lit", () => {
		setWidth(1280)
		render(<Host activeTool="basemap" />)
		expect(lit()).toEqual(["Layer manager (2 visible · 0 hidden)"])
		const tabs = screen.getAllByRole("tab").map((t) => [t.textContent, t.getAttribute("aria-selected")])
		expect(tabs).toEqual([
			["Layers", "false"],
			["Basemap", "true"],
			["Reference", "false"],
		])
	})

	it("leaving Measure or Draw ends that mode, so nothing keeps running behind another panel", () => {
		setWidth(1280)
		const onMeasureModeChange = vi.fn()
		const onDrawModeChange = vi.fn()
		render(<Host onDrawModeChange={onDrawModeChange} onMeasureModeChange={onMeasureModeChange} />)
		fireEvent.click(rail().getByRole("button", { name: "Measure" }))
		fireEvent.click(rail().getByRole("button", { name: "Search" }))
		expect(onMeasureModeChange).toHaveBeenCalledWith(null)
		fireEvent.click(rail().getByRole("button", { name: "Draw ROI" }))
		fireEvent.click(screen.getByRole("button", { name: "Close panel" }))
		expect(onDrawModeChange).toHaveBeenCalledWith(null)
	})

	it("is controlled by MapView: the open panel comes from activeTool and changes are reported", () => {
		setWidth(1280)
		const onActiveToolChange = vi.fn()
		const { rerender } = render(<Host activeTool="search" onActiveToolChange={onActiveToolChange} />)
		expect(lit()).toEqual(["Search"])
		openMore()
		fireEvent.click(moreItem(/^Export/))
		expect(onActiveToolChange).toHaveBeenCalledWith("export")
		expect(lit()).toEqual(["Search"]) // still the parent's value until it changes it
		rerender(<Host activeTool="export" onActiveToolChange={onActiveToolChange} />)
		expect(lit()).toEqual(["More tools"])
		expect(screen.getByRole("dialog", { name: "Export" })).toBeInTheDocument()
	})
})

describe("MapToolRibbon conditional tools", () => {
	const time = { id: "t", name: "t", layerType: "polygon", metadata: { time_start: "2020-01-01" } }
	const flood = { id: "f", name: "f", layerType: "raster", metadata: { tool: "map_flood_inundation" } }

	it("lists Swipe, Time and Flood disabled, each with its reason as text, when there is nothing to act on", () => {
		setWidth(1280)
		render(<Host layers={[]} />)
		openMore()
		for (const [name, reason] of [
			[/^Swipe/, /Needs a layer/],
			[/^Time slider/, "No time-tagged layers"],
			[/^Flood/, "No flood layers"],
		] as const) {
			const item = moreItem(name)
			expect(item).toHaveAttribute("aria-disabled", "true")
			expect(item).toHaveAccessibleDescription(reason)
		}
		expect(moreItem(/^Transect/)).not.toHaveAttribute("aria-disabled")
		expect(moreItem(/^Export/)).not.toHaveAttribute("aria-disabled")
	})

	it("a disabled item does nothing when activated and the menu stays open", () => {
		setWidth(1280)
		const onActiveToolChange = vi.fn()
		render(<Host layers={[]} onActiveToolChange={onActiveToolChange} />)
		openMore()
		fireEvent.click(moreItem(/^Flood/))
		expect(onActiveToolChange).not.toHaveBeenCalled()
		expect(screen.getByRole("menu")).toBeInTheDocument()
	})

	it("enables each tool as soon as it applies", () => {
		setWidth(1280)
		render(<Host layers={[time, flood]} />)
		openMore()
		expect(moreItem(/^Swipe/)).not.toHaveAttribute("aria-disabled")
		expect(moreItem(/^Time slider/)).not.toHaveAttribute("aria-disabled")
		expect(moreItem(/^Flood/)).not.toHaveAttribute("aria-disabled")
	})
})

describe("MapToolRibbon menu keyboard", () => {
	it("moves focus into the menu, wraps with the arrows, and Escape returns focus to More", async () => {
		setWidth(1280)
		render(<Host />)
		const more = rail().getByRole("button", { name: "More tools" })
		fireEvent.click(more)
		expect(more).toHaveAttribute("aria-pressed", "false")
		const items = screen.getAllByRole("menuitem")
		expect(document.activeElement).toBe(items[0])
		fireEvent.keyDown(items[0], { key: "ArrowUp" })
		expect(document.activeElement).toBe(items[items.length - 1])
		fireEvent.keyDown(items[items.length - 1], { key: "ArrowDown" })
		expect(document.activeElement).toBe(items[0])
		fireEvent.keyDown(items[0], { key: "Escape" })
		expect(screen.queryByRole("menu")).toBeNull()
		await vi.waitFor(() => expect(document.activeElement).toBe(more))
	})
})

describe("MapToolRibbon chrome states", () => {
	it("defaults to the rail at 800 px and wider, and to one collapsed button below", () => {
		setWidth(800)
		const wide = render(<Host />)
		expect(screen.getByRole("navigation", { name: "Map tools" })).toBeInTheDocument()
		wide.unmount()
		setWidth(799)
		render(<Host />)
		expect(screen.queryByRole("navigation", { name: "Map tools" })).toBeNull()
		expect(screen.getByRole("button", { name: "Map tools" })).toHaveAttribute("aria-expanded", "false")
	})

	it("reaches Collapsed from the rail in one click, restores the rail from it, and survives a reload", () => {
		setWidth(1280)
		const first = render(<Host />)
		fireEvent.click(rail().getByRole("button", { name: "Collapse map tools" }))
		expect(screen.getByRole("button", { name: "Map tools" })).toBeInTheDocument()
		expect(screen.queryByRole("navigation", { name: "Map tools" })).toBeNull()
		first.unmount()
		// A reload mounts a fresh tree: the choice comes from storage, not from state.
		render(<Host />)
		expect(screen.getByRole("button", { name: "Map tools" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Map tools" }))
		expect(screen.getByRole("navigation", { name: "Map tools" })).toBeInTheDocument()
	})

	it("reaches Collapsed from Hidden in one click", () => {
		setWidth(1280)
		render(<Host />)
		fireEvent.keyDown(window, { key: ".", ctrlKey: true })
		const tab = screen.getByRole("button", { name: /^Show map tools/ })
		fireEvent.click(tab)
		expect(screen.getByRole("button", { name: "Map tools" })).toBeInTheDocument()
	})

	it("Ctrl+. hides the chrome and the open panel, and brings both back unchanged; Cmd+. does the same", () => {
		setWidth(1280)
		render(<Host annotationsPanel={<div>pins-body</div>} />)
		fireEvent.click(rail().getByRole("button", { name: "Pins" }))
		expect(screen.getByText("pins-body")).toBeInTheDocument()
		fireEvent.keyDown(window, { key: ".", ctrlKey: true })
		expect(screen.queryByRole("navigation", { name: "Map tools" })).toBeNull()
		expect(screen.queryByText("pins-body")).toBeNull()
		expect(screen.getByRole("button", { name: /^Show map tools/ })).toBeInTheDocument()
		fireEvent.keyDown(window, { key: ".", ctrlKey: true })
		expect(screen.getByText("pins-body")).toBeInTheDocument()
		expect(lit()).toEqual(["Pins"])
		fireEvent.keyDown(window, { key: ".", metaKey: true })
		expect(screen.queryByText("pins-body")).toBeNull()
	})

	it("collapsed shows which tool is open and a bottom sheet lists every tool in a menu", () => {
		setWidth(400)
		render(<Host activeTool="measure" />)
		const button = screen.getByRole("button", { name: "Map tools, Measure open" })
		expect(button.querySelector(".map-chrome-activebadge")).not.toBeNull()
		fireEvent.click(button)
		expect(button).toHaveAttribute("aria-expanded", "true")
		const names = screen.getAllByRole("menuitem").map((i) => i.textContent)
		expect(names.join(" ")).toMatch(/Layers.*Search.*Pins.*Measure.*Draw ROI.*Transect.*Swipe.*Time.*Flood.*Export.*Gallery/)
	})

	it("the bottom sheet has a keyboard-operable resize handle", () => {
		setWidth(400)
		render(<Host activeTool="search" searchPanel={<div>s</div>} />)
		const handle = screen.getByRole("separator", { name: "Resize sheet" })
		expect(handle).toHaveAttribute("aria-valuenow", "55")
		fireEvent.keyDown(handle, { key: "ArrowUp" })
		expect(handle).toHaveAttribute("aria-valuenow", "60")
		fireEvent.keyDown(handle, { key: "End" })
		expect(handle).toHaveAttribute("aria-valuenow", "30")
	})
})

describe("MapToolRibbon panel placement", () => {
	const mode = () => document.querySelector("[data-map-chrome-root]")?.getAttribute("data-map-chrome-mode")
	it("docks at 960 px, floats at 600 to 959 px and becomes a sheet below 600 px", () => {
		for (const [width, expected] of [
			[1280, "docked"],
			[960, "docked"],
			[959, "overlay"],
			[600, "overlay"],
			[599, "sheet"],
		] as const) {
			setWidth(width)
			const r = render(<Host activeTool="search" />)
			expect(mode(), `${width}px`).toBe(expected)
			r.unmount()
		}
	})

	it("Escape in the panel closes it and puts focus back on the rail item that opened it", async () => {
		setWidth(1280)
		const onActiveToolChange = vi.fn()
		render(<Host activeTool="annotations" annotationsPanel={<div>body</div>} onActiveToolChange={onActiveToolChange} />)
		fireEvent.keyDown(screen.getByText("body"), { key: "Escape" })
		expect(onActiveToolChange).toHaveBeenCalledWith(null)
		await vi.waitFor(() => expect(document.activeElement).toBe(rail().getByRole("button", { name: "Pins" })))
	})
})

describe("MapToolRibbon dialogs", () => {
	it("Export is a modal dialog: focus moves in, Tab stays inside, Escape closes it", () => {
		setWidth(1280)
		const onActiveToolChange = vi.fn()
		render(
			<Host
				activeTool="gallery"
				galleryPanel={<button type="button">gallery-action</button>}
				onActiveToolChange={onActiveToolChange}
			/>,
		)
		const dialog = screen.getByRole("dialog", { name: "Research Gallery" })
		expect(dialog).toHaveAttribute("aria-modal", "true")
		expect(dialog.contains(document.activeElement)).toBe(true)
		const buttons = within(dialog).getAllByRole("button")
		buttons[buttons.length - 1].focus()
		fireEvent.keyDown(buttons[buttons.length - 1], { key: "Tab" })
		expect(dialog.contains(document.activeElement)).toBe(true)
		fireEvent.keyDown(dialog, { key: "Escape" })
		expect(onActiveToolChange).toHaveBeenCalledWith(null)
	})
})

describe("MapToolRibbon layer badge", () => {
	it("counts visible layers only and the tooltip says N visible · M hidden", () => {
		setWidth(1280)
		render(<Host layerCount={99} visibleLayerCount={3} />)
		const button = screen.getByRole("button", { name: /^Layer manager/ })
		expect(button).toHaveAttribute("title", "Layer manager (3 visible · 96 hidden)")
		expect(button.querySelector(".map-ribbon-badge")?.textContent).toBe("3")
	})

	it("shows 0 visible rather than the host total when everything is hidden", () => {
		setWidth(1280)
		render(<Host layerCount={120} visibleLayerCount={0} />)
		expect(screen.getByRole("button", { name: /^Layer manager/ }).querySelector(".map-ribbon-badge")?.textContent).toBe("0")
	})

	it("has no badge when the host holds no layers", () => {
		setWidth(1280)
		render(<Host layerCount={0} visibleLayerCount={0} />)
		expect(screen.getByRole("button", { name: "Layer manager" }).querySelector(".map-ribbon-badge")).toBeNull()
	})
})

describe("MapToolRibbon basemap panel", () => {
	it("offers Reset to hydrology default once the user has chosen a basemap", () => {
		setWidth(1280)
		const reset = vi.fn()
		render(<Host activeTool="basemap" basemapExplicit currentBasemap="esri-topo" onBasemapReset={reset} />)
		fireEvent.click(screen.getByRole("button", { name: "Reset to hydrology default" }))
		expect(reset).toHaveBeenCalledOnce()
	})

	it("disables the reset while the hydrology default is in use", () => {
		setWidth(1280)
		render(<Host activeTool="basemap" currentBasemap="muted-hydro" onBasemapReset={() => {}} />)
		expect(screen.getByRole("button", { name: "Reset to hydrology default" })).toBeDisabled()
	})

	it("lists no Mapbox or Stadia entry", () => {
		setWidth(1280)
		render(<Host activeTool="basemap" onBasemapReset={() => {}} />)
		const panel = document.querySelector(".map-ribbon-panel") as HTMLElement
		expect(panel.textContent).not.toMatch(/Mapbox|Stadia/)
		expect(panel.textContent).toContain("Hydrology default (muted)")
	})
})
