import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Menu, type MenuEntry, nextIndex, RailButton, SubviewHeader, type TabItem, TabPanel, Tabs, Toolbar } from "../index"

const ITEMS: TabItem[] = [
	{ id: "a", label: "Alpha", icon: "gear" },
	{ id: "b", label: "Beta", icon: "info" },
	{ id: "c", label: "Gamma", icon: "bug", disabled: true },
	{ id: "d", label: "Delta", icon: "bell" },
]

function TabsHarness({ orientation, iconOnly }: { orientation?: "horizontal" | "vertical"; iconOnly?: boolean }) {
	const [value, setValue] = useState("a")
	return (
		<>
			<Tabs
				idBase="t"
				items={ITEMS.map((i) => ({ ...i, iconOnly }))}
				label="Sections"
				onValueChange={setValue}
				orientation={orientation}
				value={value}
			/>
			{ITEMS.map((i) => (
				<TabPanel idBase="t" key={i.id} selected={value === i.id} tab={i.id}>
					panel {i.label}
				</TabPanel>
			))}
		</>
	)
}

describe("nextIndex", () => {
	it("wraps, jumps and ignores keys of the other axis", () => {
		expect(nextIndex("ArrowRight", 2, 3, "horizontal")).toBe(0)
		expect(nextIndex("ArrowLeft", 0, 3, "horizontal")).toBe(2)
		expect(nextIndex("ArrowDown", 0, 3, "horizontal")).toBeNull()
		expect(nextIndex("ArrowDown", 0, 3, "vertical")).toBe(1)
		expect(nextIndex("Home", 2, 3, "vertical")).toBe(0)
		expect(nextIndex("End", 0, 3, "vertical")).toBe(2)
		expect(nextIndex("ArrowRight", 0, 0, "horizontal")).toBeNull()
	})
})

describe("Tabs", () => {
	it("is a labelled tablist with one tab stop on the selected tab and a panel wired to it", () => {
		render(<TabsHarness />)
		const list = screen.getByRole("tablist", { name: "Sections" })
		expect(list).toHaveAttribute("aria-orientation", "horizontal")
		const tabs = screen.getAllByRole("tab")
		expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"])
		expect(tabs[0]).toHaveAttribute("aria-selected", "true")
		const panel = screen.getByRole("tabpanel")
		expect(panel).toHaveAttribute("aria-labelledby", tabs[0].id)
		expect(tabs[0]).toHaveAttribute("aria-controls", panel.id)
		expect(panel).toHaveTextContent("panel Alpha")
	})

	it("arrow keys move focus and selection, skip disabled tabs and wrap; Home and End jump", () => {
		render(<TabsHarness />)
		const tabs = () => screen.getAllByRole("tab")
		tabs()[0].focus()
		fireEvent.keyDown(tabs()[0], { key: "ArrowRight" })
		expect(tabs()[1]).toHaveAttribute("aria-selected", "true")
		expect(document.activeElement).toBe(tabs()[1])
		fireEvent.keyDown(tabs()[1], { key: "ArrowRight" })
		expect(tabs()[3]).toHaveAttribute("aria-selected", "true")
		expect(document.activeElement).toBe(tabs()[3])
		fireEvent.keyDown(tabs()[3], { key: "ArrowRight" })
		expect(tabs()[0]).toHaveAttribute("aria-selected", "true")
		fireEvent.keyDown(tabs()[0], { key: "End" })
		expect(tabs()[3]).toHaveAttribute("aria-selected", "true")
		fireEvent.keyDown(tabs()[3], { key: "Home" })
		expect(tabs()[0]).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tabpanel")).toHaveTextContent("panel Alpha")
	})

	it("a vertical list answers Up and Down, not Left and Right", () => {
		render(<TabsHarness orientation="vertical" />)
		const tabs = () => screen.getAllByRole("tab")
		tabs()[0].focus()
		fireEvent.keyDown(tabs()[0], { key: "ArrowRight" })
		expect(tabs()[0]).toHaveAttribute("aria-selected", "true")
		fireEvent.keyDown(tabs()[0], { key: "ArrowDown" })
		expect(tabs()[1]).toHaveAttribute("aria-selected", "true")
	})

	it("an icon-only tab keeps its name as aria-label and tooltip, and draws no text", () => {
		render(<TabsHarness iconOnly />)
		const tab = screen.getByRole("tab", { name: "Alpha" })
		expect(tab).toHaveAttribute("title", "Alpha")
		expect(tab).toHaveTextContent("")
		expect(tab.querySelector(".codicon-gear")).toHaveAttribute("aria-hidden", "true")
	})

	it("a disabled tab is aria-disabled and does not select on click", () => {
		render(<TabsHarness />)
		fireEvent.click(screen.getByRole("tab", { name: "Gamma" }))
		expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
		expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-disabled", "true")
	})

	it("requires an accessible name for the list and each tab at the type level", () => {
		// @ts-expect-error `label` is required on the list
		const noListLabel = <Tabs items={ITEMS} onValueChange={() => {}} value="a" />
		// @ts-expect-error `label` is required on every tab
		const noTabLabel = <Tabs items={[{ id: "x" }]} label="L" onValueChange={() => {}} value="x" />
		expect(noListLabel && noTabLabel).toBeTruthy()
	})
})

describe("Toolbar", () => {
	const renderBar = (orientation?: "horizontal" | "vertical") =>
		render(
			<Toolbar label="Tools" orientation={orientation}>
				<RailButton icon="layers" label="Layers" onClick={() => {}} />
				<RailButton icon="graph" label="Charts" reason="Add a layer first" />
				<RailButton icon="gear" label="Settings" />
			</Toolbar>,
		)
	const buttons = () => screen.getAllByRole("button")

	it("is a labelled toolbar with a single tab stop", () => {
		renderBar()
		expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveAttribute("aria-orientation", "horizontal")
		expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1])
	})

	it("arrow keys, Home and End move focus (aria-disabled buttons included) and the tab stop follows", () => {
		renderBar()
		buttons()[0].focus()
		fireEvent.keyDown(buttons()[0], { key: "ArrowRight" })
		expect(document.activeElement).toBe(buttons()[1])
		expect(buttons().map((b) => b.tabIndex)).toEqual([-1, 0, -1])
		fireEvent.keyDown(buttons()[1], { key: "End" })
		expect(document.activeElement).toBe(buttons()[2])
		fireEvent.keyDown(buttons()[2], { key: "ArrowRight" })
		expect(document.activeElement).toBe(buttons()[0])
		fireEvent.keyDown(buttons()[0], { key: "ArrowLeft" })
		expect(document.activeElement).toBe(buttons()[2])
		fireEvent.keyDown(buttons()[2], { key: "Home" })
		expect(document.activeElement).toBe(buttons()[0])
	})

	it("a vertical toolbar answers Up and Down only", () => {
		renderBar("vertical")
		buttons()[0].focus()
		fireEvent.keyDown(buttons()[0], { key: "ArrowRight" })
		expect(document.activeElement).toBe(buttons()[0])
		fireEvent.keyDown(buttons()[0], { key: "ArrowDown" })
		expect(document.activeElement).toBe(buttons()[1])
	})

	it("a button mounted later does not become a second tab stop", async () => {
		function Late() {
			const [more, setMore] = useState(false)
			return (
				<Toolbar label="Late">
					<RailButton icon="gear" label="One" onClick={() => setMore(true)} />
					{more && <RailButton icon="bell" label="Two" />}
				</Toolbar>
			)
		}
		render(<Late />)
		fireEvent.click(screen.getByRole("button", { name: "One" }))
		await act(async () => {
			await Promise.resolve()
		})
		expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1])
	})

	it("requires a label at the type level", () => {
		// @ts-expect-error `label` is required
		const element = <Toolbar>x</Toolbar>
		expect(element).toBeTruthy()
	})
})

describe("RailButton", () => {
	it("names the button, hides the glyph, and states a toggle with aria-pressed", () => {
		const onClick = vi.fn()
		render(<RailButton active icon="layers" label="Layers" onClick={onClick} />)
		const btn = screen.getByRole("button", { name: "Layers" })
		expect(btn).toHaveAttribute("aria-pressed", "true")
		expect(btn).toHaveAttribute("title", "Layers")
		expect(btn.querySelector(".codicon-layers")).toHaveAttribute("aria-hidden", "true")
		fireEvent.click(btn)
		expect(onClick).toHaveBeenCalledOnce()
	})

	it("a plain action has no aria-pressed; a disclosure has aria-expanded and aria-haspopup", () => {
		render(
			<>
				<RailButton icon="gear" label="Plain" />
				<RailButton expanded={false} icon="ellipsis" label="More" />
			</>,
		)
		expect(screen.getByRole("button", { name: "Plain" })).not.toHaveAttribute("aria-pressed")
		const more = screen.getByRole("button", { name: "More" })
		expect(more).toHaveAttribute("aria-expanded", "false")
		expect(more).toHaveAttribute("aria-haspopup", "menu")
	})

	it("a button with a reason stays focusable, does not act, and states why", () => {
		const onClick = vi.fn()
		render(<RailButton icon="graph" label="Charts" onClick={onClick} reason="Add a layer first" />)
		const btn = screen.getByRole("button", { name: "Charts" })
		expect(btn).toHaveAttribute("aria-disabled", "true")
		expect(btn).not.toBeDisabled()
		expect(btn).toHaveAccessibleDescription("Add a layer first")
		expect(btn).toHaveAttribute("title", "Charts: Add a layer first")
		fireEvent.click(btn)
		expect(onClick).not.toHaveBeenCalled()
	})

	it("caps the badge and requires a label at the type level", () => {
		render(<RailButton badge={120} icon="bell" label="Alerts" />)
		expect(screen.getByText("99+")).toBeInTheDocument()
		// @ts-expect-error `label` is required
		const element = <RailButton icon="bell" />
		expect(element).toBeTruthy()
	})
})

describe("Menu", () => {
	const entries = (onSelect = vi.fn()): MenuEntry[] => [
		{ key: "one", icon: "gear", text: "One", label: "Do one", onSelect },
		{ key: "div", divider: true },
		{ key: "two", text: "Two", label: "Do two", reason: "Not now", onSelect },
		{ key: "three", text: "Three", label: "Do three", shortcut: "Ctrl+3", onSelect },
	]
	const mount = (onClose = vi.fn(), onSelect = vi.fn()) => {
		const triggerRef = createRef<HTMLButtonElement>()
		render(
			<>
				<button ref={triggerRef} type="button">
					Open
				</button>
				<Menu entries={entries(onSelect)} label="Actions" onClose={onClose} triggerRef={triggerRef} />
			</>,
		)
		return { onClose, onSelect }
	}

	it("is a labelled menu that focuses its first item", () => {
		mount()
		expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument()
		expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Do one" }))
		expect(screen.getAllByRole("menuitem")).toHaveLength(3)
	})

	it("arrows, Home and End move between items and wrap", () => {
		mount()
		const items = screen.getAllByRole("menuitem")
		fireEvent.keyDown(items[0], { key: "ArrowDown" })
		expect(document.activeElement).toBe(items[1])
		fireEvent.keyDown(items[1], { key: "ArrowDown" })
		expect(document.activeElement).toBe(items[2])
		fireEvent.keyDown(items[2], { key: "ArrowDown" })
		expect(document.activeElement).toBe(items[0])
		fireEvent.keyDown(items[0], { key: "ArrowUp" })
		expect(document.activeElement).toBe(items[2])
		fireEvent.keyDown(items[2], { key: "Home" })
		expect(document.activeElement).toBe(items[0])
		fireEvent.keyDown(items[0], { key: "End" })
		expect(document.activeElement).toBe(items[2])
	})

	it("Escape closes and asks to return focus; Tab closes without it", () => {
		const { onClose } = mount()
		fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Escape" })
		expect(onClose).toHaveBeenLastCalledWith(true)
		fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Tab" })
		expect(onClose).toHaveBeenLastCalledWith(false)
	})

	it("a click elsewhere closes; a click on the trigger does not", () => {
		const { onClose } = mount()
		fireEvent.pointerDown(screen.getByRole("button", { name: "Open" }))
		expect(onClose).not.toHaveBeenCalled()
		fireEvent.pointerDown(document.body)
		expect(onClose).toHaveBeenCalledWith(false)
	})

	it("an item with a reason is focusable, described by it, and does not select", () => {
		const { onSelect } = mount()
		const two = screen.getByRole("menuitem", { name: "Do two" })
		expect(two).toHaveAttribute("aria-disabled", "true")
		expect(two).toHaveAccessibleDescription("Not now")
		fireEvent.click(two)
		expect(onSelect).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("menuitem", { name: "Do three" }))
		expect(onSelect).toHaveBeenCalledOnce()
	})
})

describe("SubviewHeader", () => {
	it("is a heading plus one Done button that closes the view", () => {
		const onClose = vi.fn()
		render(<SubviewHeader onClose={onClose} title="Settings" />)
		expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Done" }))
		expect(onClose).toHaveBeenCalledOnce()
	})

	it("Escape closes the view", () => {
		const onClose = vi.fn()
		render(<SubviewHeader onClose={onClose} title="Skills" />)
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(onClose).toHaveBeenCalledOnce()
	})

	it("Escape does not close while a text field is focused, a menu is open, or the event was handled", () => {
		const onClose = vi.fn()
		render(
			<>
				<SubviewHeader onClose={onClose} title="Settings" />
				<input aria-label="Search" />
			</>,
		)
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), { key: "Escape" })
		expect(onClose).not.toHaveBeenCalled()

		const stop = (e: KeyboardEvent) => e.preventDefault()
		window.addEventListener("keydown", stop, true)
		fireEvent.keyDown(document.body, { key: "Escape" })
		window.removeEventListener("keydown", stop, true)
		expect(onClose).not.toHaveBeenCalled()

		const menu = document.createElement("div")
		menu.setAttribute("role", "menu")
		document.body.appendChild(menu)
		fireEvent.keyDown(document.body, { key: "Escape" })
		menu.remove()
		expect(onClose).not.toHaveBeenCalled()
	})

	it("can opt out of Escape, and takes extra actions before Done", () => {
		const onClose = vi.fn()
		render(
			<SubviewHeader
				actions={<button type="button">Refresh</button>}
				closeOnEscape={false}
				onClose={onClose}
				title="History"
			/>,
		)
		fireEvent.keyDown(document.body, { key: "Escape" })
		expect(onClose).not.toHaveBeenCalled()
		const names = screen.getAllByRole("button").map((b) => b.textContent)
		expect(names).toEqual(["Refresh", "Done"])
	})
})
