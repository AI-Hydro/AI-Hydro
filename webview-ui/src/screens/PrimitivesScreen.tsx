/** Design-system primitives gallery for the UI harness (dev-only). */
import { useRef, useState } from "react"
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
	LINE_DASH,
	Menu,
	PanelHeader,
	ProvenanceStrip,
	RailButton,
	SubviewHeader,
	TabPanel,
	Tabs,
	Text,
	Toolbar,
} from "../design"

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<section aria-label={title} style={{ padding: "var(--aih-space-3)", borderBottom: "1px solid var(--aih-border)" }}>
		<Text as="h2" muted variant="label">
			{title}
		</Text>
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "var(--aih-space-2)",
				marginTop: "var(--aih-space-2)",
				alignItems: "center",
			}}>
			{children}
		</div>
	</section>
)

const Series = ({ id }: { id: "observed" | "modelled" }) => {
	const def = EVIDENCE_STATES[id]
	return (
		<svg aria-label={`${def.label} series sample`} height="24" role="img" width="120">
			<line
				stroke={def.token}
				strokeDasharray={LINE_DASH[def.lineStyle]}
				strokeWidth="2.5"
				x1="4"
				x2="116"
				y1="12"
				y2="12"
			/>
		</svg>
	)
}

const NAV_TABS = [
	{ id: "installed", label: "Installed", icon: "check" },
	{ id: "browse", label: "Browse", icon: "search" },
	{ id: "remote", label: "Remote", icon: "cloud", disabled: true },
]
const RAIL_TABS = [
	{ id: "api", label: "API configuration", icon: "settings", iconOnly: true },
	{ id: "features", label: "Features", icon: "checklist", iconOnly: true },
	{ id: "about", label: "About", icon: "info", iconOnly: true },
]

export function PrimitivesScreen() {
	const [clicks, setClicks] = useState(0)
	const [tab, setTab] = useState("installed")
	const [railTab, setRailTab] = useState("api")
	const [layersOn, setLayersOn] = useState(true)
	const menuTrigger = useRef<HTMLButtonElement>(null)
	return (
		<div style={{ background: "var(--aih-surface)", color: "var(--aih-fg)", minHeight: "100%", overflow: "auto" }}>
			<PanelHeader
				actions={<IconButton icon="refresh" label="Reload" onClick={() => setClicks(clicks + 1)} />}
				description="Design system primitives on theme tokens"
				title="Primitives"
			/>
			<Section title="Text scale">
				<Text variant="caption">Caption</Text>
				<Text variant="label">Label</Text>
				<Text variant="body">Body</Text>
				<Text variant="title">Title</Text>
				<Text variant="heading">Heading</Text>
				<Text muted variant="body">
					Muted
				</Text>
			</Section>
			<Section title="Buttons">
				<Button variant="primary">Primary</Button>
				<Button>Secondary</Button>
				<Button variant="ghost">Ghost</Button>
				<Button disabled>Disabled</Button>
				<Button icon="folder-opened">With icon</Button>
				<IconButton icon="close" label="Close panel" />
				<IconButton active icon="eye" label="Toggle visibility" />
			</Section>
			<SubviewHeader closeOnEscape={false} onClose={() => setClicks(clicks + 1)} title="Sub-view header" />
			<Section title="Tabs: horizontal with a panel, a disabled tab and visible labels">
				<div style={{ width: "100%" }}>
					<Tabs idBase="demo-h" items={NAV_TABS} label="Demo sections" onValueChange={setTab} value={tab} />
					<TabPanel idBase="demo-h" selected={tab === "installed"} tab="installed">
						<Text variant="body">Installed panel</Text>
					</TabPanel>
					<TabPanel idBase="demo-h" selected={tab === "browse"} tab="browse">
						<Text variant="body">Browse panel</Text>
					</TabPanel>
				</div>
			</Section>
			<Section title="Tabs: vertical, icon only (the name stays on the tab)">
				<Tabs
					idBase="demo-v"
					items={RAIL_TABS}
					label="Demo icon sections"
					onValueChange={setRailTab}
					orientation="vertical"
					value={railTab}
				/>
				<TabPanel idBase="demo-v" selected tab={railTab}>
					<Text variant="body">{RAIL_TABS.find((t) => t.id === railTab)?.label}</Text>
				</TabPanel>
			</Section>
			<Section title="Toolbar of rail buttons: a toggle, a counted action, a disabled one with its reason">
				<Toolbar label="Demo tools">
					<RailButton active={layersOn} icon="layers" label="Layers" onClick={() => setLayersOn(!layersOn)} />
					<RailButton badge={3} icon="bell" label="Alerts" onClick={() => setClicks(clicks + 1)} />
					<RailButton icon="graph" label="Charts" reason="Add a layer first" />
					<RailButton expanded={false} icon="ellipsis" label="More tools" popup="menu" ref={menuTrigger} />
				</Toolbar>
			</Section>
			<Section title="Menu (shown open)">
				<Menu
					entries={[
						{
							key: "fit",
							icon: "screen-full",
							text: "Fit to layers",
							label: "Fit to layers",
							shortcut: "F",
							onSelect: () => {},
						},
						{ key: "div", divider: true },
						{
							key: "export",
							icon: "export",
							text: "Export",
							label: "Export map",
							reason: "Add a layer first",
							onSelect: () => {},
						},
					]}
					label="Demo menu"
					onClose={() => {}}
					triggerRef={menuTrigger}
				/>
			</Section>
			<Section title="Evidence states">
				{EVIDENCE_STATE_IDS.map((id) => (
					<EvidenceBadge key={id} state={id} />
				))}
				<Badge icon="database">3 claims</Badge>
			</Section>
			<Section title="Observed vs modelled line style">
				<Text variant="label">Observed</Text>
				<Series id="observed" />
				<Text variant="label">Modelled</Text>
				<Series id="modelled" />
			</Section>
			<Section title="Disclosure">
				<Disclosure label="Usage">
					<KeyValue
						items={[
							{ label: "Tokens in", value: "not tracked here" },
							{ label: "Cost", value: null },
						]}
					/>
				</Disclosure>
			</Section>
			<Section title="Key / value with missing fields">
				<KeyValue
					items={[
						{ label: "Gauge", value: "SYN-00000001" },
						{ label: "Area check", value: undefined },
						{ label: "Method", value: "" },
					]}
				/>
			</Section>
			<Section title="Provenance strip">
				<ProvenanceStrip
					informationClass="observed"
					onOpenRun={() => setClicks(clicks + 1)}
					retrievedAt="2026-10-01"
					runId="fx-run-0001"
					source="synthetic fixture"
				/>
				<ProvenanceStrip />
			</Section>
			<Section title="Empty state">
				<EmptyState
					actions={[
						{ label: "Open a file", icon: "folder-opened", onClick: () => setClicks(clicks + 1) },
						{ label: "Find a gauge", icon: "search", onClick: () => setClicks(clicks + 1) },
					]}
					description="Layers appear here after a tool run or when you open a file."
					icon="map"
					title="No layers yet"
				/>
			</Section>
		</div>
	)
}
