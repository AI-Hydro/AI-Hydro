/** Design-system primitives gallery for the UI harness (dev-only). */
import { useState } from "react"
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
	PanelHeader,
	ProvenanceStrip,
	Text,
} from "../design"

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
	<section aria-label={title} style={{ padding: "var(--aih-space-3)", borderBottom: "1px solid var(--aih-border)" }}>
		<Text as="h2" variant="label" muted>
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

export function PrimitivesScreen() {
	const [clicks, setClicks] = useState(0)
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
