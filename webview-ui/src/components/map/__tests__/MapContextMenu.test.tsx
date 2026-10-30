import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import MapContextMenu, { type MapContextMenuProps } from "../MapContextMenu"

afterEach(cleanup)

const base = (over: Partial<MapContextMenuProps> = {}): MapContextMenuProps => ({
	x: 20,
	y: 20,
	lon: -69.5931,
	lat: 45.4612,
	features: [],
	mapStyle: "dark",
	onAskAiHydro: vi.fn(),
	onAgentDelineate: vi.fn(),
	onQuickDelineate: vi.fn(),
	onAddPin: vi.fn(),
	onMeasureFrom: vi.fn(),
	onCopyCoords: vi.fn(),
	onInspect: vi.fn(),
	onSaveFeature: vi.fn(),
	onClose: vi.fn(),
	...over,
})

const itemNames = () => screen.getAllByRole("menuitem").map((el) => el.textContent ?? "")

describe("map context menu", () => {
	it("is a menu with grouped codicon items and the coordinates as its header", () => {
		render(<MapContextMenu {...base()} />)
		const menu = screen.getByRole("menu", { name: "Map actions" })
		expect(within(menu).getByText("45.46120°N, 69.59310°W")).toBeTruthy()
		expect(
			within(menu)
				.getAllByRole("group")
				.map((g) => g.getAttribute("aria-label")),
		).toEqual(["AI-Hydro", "Map"])
		expect(menu.querySelectorAll(".codicon").length).toBeGreaterThan(4)
	})

	it("offers each action once: one pin action, no Drop pin, no Add annotation", () => {
		render(<MapContextMenu {...base()} />)
		const names = itemNames()
		expect(names.filter((n) => /pin/i.test(n))).toEqual(["Add pin"])
		expect(names.join("|")).not.toMatch(/annotation|drop pin/i)
		expect(new Set(names).size).toBe(names.length)
		expect(names.some((n) => n.startsWith("Ask AI-Hydro about this location"))).toBe(true)
		expect(names.some((n) => n.startsWith("Measure from here"))).toBe(true)
		expect(names.some((n) => n.startsWith("Copy coordinates"))).toBe(true)
	})

	it("says what the two delineate actions do", () => {
		const onAgentDelineate = vi.fn()
		const onQuickDelineate = vi.fn()
		render(<MapContextMenu {...base({ onAgentDelineate, onQuickDelineate })} />)
		fireEvent.click(screen.getByRole("menuitem", { name: /Quick delineate \(no chat\)/ }))
		expect(onQuickDelineate).toHaveBeenCalledTimes(1)
		expect(onAgentDelineate).not.toHaveBeenCalled()
		cleanup()
		render(<MapContextMenu {...base({ onAgentDelineate, onQuickDelineate })} />)
		fireEvent.click(screen.getByRole("menuitem", { name: /Delineate with AI-Hydro/ }))
		expect(onAgentDelineate).toHaveBeenCalledTimes(1)
	})

	it("has no emoji, and no double-click tip", () => {
		const { container } = render(<MapContextMenu {...base()} />)
		expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u)
		expect(container.textContent ?? "").not.toMatch(/double-click/i)
		const src = readFileSync(resolve(__dirname, "../MapContextMenu.tsx"), "utf8")
		expect(src).not.toMatch(/\p{Extended_Pictographic}/u)
	})

	it("adds a pin section on a pin, with rename, ask and remove", () => {
		const onRenamePin = vi.fn()
		const onRemovePin = vi.fn()
		const onAskAboutPin = vi.fn()
		render(<MapContextMenu {...base({ pin: { id: "p1", name: "Outlet" }, onRenamePin, onRemovePin, onAskAboutPin })} />)
		const group = screen.getByRole("group", { name: "Pin: Outlet" })
		fireEvent.click(within(group).getByRole("menuitem", { name: "Rename pin" }))
		fireEvent.click(within(group).getByRole("menuitem", { name: "Ask about this pin" }))
		fireEvent.click(within(group).getByRole("menuitem", { name: "Remove pin" }))
		expect(onRenamePin).toHaveBeenCalled()
		expect(onAskAboutPin).toHaveBeenCalled()
		expect(onRemovePin).toHaveBeenCalled()
		expect(itemNames().join("|")).not.toMatch(/annotation/i)
	})

	it("adds a layer section for a feature, with Remove layer", () => {
		const onRemoveLayer = vi.fn()
		render(
			<MapContextMenu
				{...base({
					features: [{ layerId: "l1", layerName: "Gauges", properties: { name: "x" }, geometry: undefined as any }],
					onRemoveLayer,
				})}
			/>,
		)
		expect(screen.getByRole("group", { name: "Gauges" })).toBeTruthy()
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove layer" }))
		expect(onRemoveLayer).toHaveBeenCalled()
	})

	it("moves focus with the arrow keys and closes on Escape", () => {
		const onClose = vi.fn()
		render(<MapContextMenu {...base({ onClose })} />)
		const items = screen.getAllByRole("menuitem")
		expect(document.activeElement).toBe(items[0])
		fireEvent.keyDown(items[0], { key: "ArrowDown" })
		expect(document.activeElement).toBe(items[1])
		fireEvent.keyDown(items[1], { key: "End" })
		expect(document.activeElement).toBe(items[items.length - 1])
		fireEvent.keyDown(window, { key: "Escape" })
		expect(onClose).toHaveBeenCalled()
	})
})

describe("MapView double-click", () => {
	const src = readFileSync(resolve(__dirname, "../MapView.tsx"), "utf8")
	it("no longer listens for dblclick or drops a pin on it, and leaves deck's double-click zoom on", () => {
		expect(src).not.toMatch(/addEventListener\(\s*"dblclick"/)
		expect(src).not.toContain("doubleClickZoom: false")
		expect(src).toMatch(/doubleClickZoom: !\(measureMode \|\| drawMode\)/)
		expect(src).not.toMatch(/Pin dropped at/)
	})

	it("tells the user when a reload dropped their last change", () => {
		expect(src).toContain("Map reloaded for the open folder; your last change was not saved")
		expect(src).toMatch(/"aihydro-map-pins-reload"/)
	})
})
