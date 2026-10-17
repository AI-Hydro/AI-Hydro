import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
	Badge,
	Button,
	Disclosure,
	EmptyState,
	EVIDENCE_STATE_IDS,
	EVIDENCE_STATES,
	EvidenceBadge,
	IconButton,
	KeyValue,
	PanelHeader,
	ProvenanceStrip,
	Text,
} from "../index"

describe("Text", () => {
	it("renders the requested element and variant class", () => {
		render(
			<Text as="p" variant="caption">
				hello
			</Text>,
		)
		const el = screen.getByText("hello")
		expect(el.tagName).toBe("P")
		expect(el).toHaveClass("aih-text--caption")
	})
})

describe("Button / IconButton", () => {
	it("Button is a real button that defaults to type=button", () => {
		const onClick = vi.fn()
		render(<Button onClick={onClick}>Open a file</Button>)
		const btn = screen.getByRole("button", { name: "Open a file" })
		expect(btn).toHaveAttribute("type", "button")
		fireEvent.click(btn)
		expect(onClick).toHaveBeenCalledOnce()
	})

	it("IconButton exposes its label as the accessible name and tooltip, with a decorative icon", () => {
		render(<IconButton icon="close" label="Close panel" />)
		const btn = screen.getByRole("button", { name: "Close panel" })
		expect(btn).toHaveAttribute("title", "Close panel")
		expect(btn.querySelector(".codicon-close")).toHaveAttribute("aria-hidden", "true")
	})

	it("IconButton requires a label at the type level", () => {
		// @ts-expect-error `label` is required
		const element = <IconButton icon="close" />
		expect(element).toBeTruthy()
	})

	it("IconButton reports toggle state via aria-pressed only when controlled", () => {
		const { rerender } = render(<IconButton icon="eye" label="Show" />)
		expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed")
		rerender(<IconButton active icon="eye" label="Show" />)
		expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
	})
})

describe("EvidenceBadge", () => {
	it.each(EVIDENCE_STATE_IDS)("renders a text label and an icon for %s", (id) => {
		const { container } = render(<EvidenceBadge state={id} />)
		expect(screen.getByText(EVIDENCE_STATES[id].label)).toBeInTheDocument()
		expect(container.querySelector(`.${EVIDENCE_STATES[id].icon}`)).not.toBeNull()
		expect(container.firstElementChild).toHaveAttribute("data-evidence-state", id)
	})

	it("only the approved badge references the passed token", () => {
		for (const id of EVIDENCE_STATE_IDS) {
			const { container, unmount } = render(<EvidenceBadge state={id} />)
			const style = (container.firstElementChild as HTMLElement).getAttribute("style") ?? ""
			expect(style.includes("iconPassed")).toBe(id === "approved")
			unmount()
		}
	})

	it("allows a label override without losing the icon", () => {
		const { container } = render(<EvidenceBadge label="Class not reported" state="unverified" />)
		expect(screen.getByText("Class not reported")).toBeInTheDocument()
		expect(container.querySelector(".codicon-question")).not.toBeNull()
	})

	it("neutral Badge carries no evidence state", () => {
		const { container } = render(<Badge>3 claims</Badge>)
		expect(container.firstElementChild).not.toHaveAttribute("data-evidence-state")
	})
})

describe("Disclosure", () => {
	it("toggles aria-expanded and hides content when closed", () => {
		render(<Disclosure label="Usage">tokens: n/a</Disclosure>)
		const trigger = screen.getByRole("button", { name: "Usage" })
		expect(trigger).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByText("tokens: n/a")).toBeNull()
		fireEvent.click(trigger)
		expect(trigger).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText("tokens: n/a")).toBeInTheDocument()
	})
})

describe("PanelHeader", () => {
	it("renders a heading at the requested level and its actions", () => {
		render(<PanelHeader actions={<Button>Reload</Button>} level={2} title="Evidence Board" />)
		expect(screen.getByRole("heading", { level: 2, name: "Evidence Board" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument()
	})
})

describe("EmptyState", () => {
	it("renders actions as real buttons that fire handlers", () => {
		const open = vi.fn()
		render(
			<EmptyState
				actions={[{ label: "Open a file", onClick: open }]}
				description="Nothing yet"
				icon="map"
				title="No layers"
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Open a file" }))
		expect(open).toHaveBeenCalledOnce()
		expect(screen.getByRole("heading", { name: "No layers" })).toBeInTheDocument()
	})
})

describe("KeyValue", () => {
	it("renders 'not reported' for null, undefined and blank values, never blank", () => {
		render(
			<KeyValue
				items={[
					{ label: "Gauge", value: "SYN-1" },
					{ label: "Datum", value: null },
					{ label: "Area", value: undefined },
					{ label: "Note", value: "  " },
				]}
			/>,
		)
		expect(screen.getByText("SYN-1")).toBeInTheDocument()
		expect(screen.getAllByText("not reported")).toHaveLength(3)
	})
})

describe("ProvenanceStrip", () => {
	it("shows missing fields as not reported and an unknown class as 'Class not reported'", () => {
		render(<ProvenanceStrip informationClass="gauge_point" />)
		expect(screen.getAllByText("not reported").length).toBeGreaterThanOrEqual(3)
		expect(screen.getByText("Class not reported")).toBeInTheDocument()
	})

	it("shows a reported class and opens the run on click", () => {
		const open = vi.fn()
		render(
			<ProvenanceStrip
				informationClass="modelled"
				onOpenRun={open}
				retrievedAt="2026-10-01"
				runId="fx-run-1"
				source="synthetic"
			/>,
		)
		expect(screen.getByText("Modelled")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Run fx-run-1" }))
		expect(open).toHaveBeenCalledWith("fx-run-1")
	})
})
