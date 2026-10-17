import { stateForInformationClass } from "../evidenceStates"
import { Button } from "./Button"
import { EvidenceBadge } from "./Badge"
import { NOT_REPORTED } from "./KeyValue"
import "./primitives.css"

export interface ProvenanceStripProps {
	source?: string | null
	retrievedAt?: string | null
	runId?: string | null
	/** Server-reported information class; unknown or absent classes are shown as not reported, never inferred. */
	informationClass?: string | null
	onOpenRun?: (runId: string) => void
}

const Item = ({ k, v }: { k: string; v?: string | null }) => (
	<span className="aih-provenance__item">
		<span className="aih-provenance__key">{k}</span>
		{v && v.trim() ? <span>{v}</span> : <em className="aih-kv__missing">{NOT_REPORTED}</em>}
	</span>
)

/** One-line provenance summary: source, retrieval time, run link, information class. */
export function ProvenanceStrip({ source, retrievedAt, runId, informationClass, onOpenRun }: ProvenanceStripProps) {
	const classState = stateForInformationClass(informationClass)
	return (
		<div aria-label="Provenance" className="aih-provenance" role="group">
			<Item k="Source" v={source} />
			<Item k="Retrieved" v={retrievedAt} />
			{runId && onOpenRun ? (
				<Button onClick={() => onOpenRun(runId)} variant="ghost">
					Run {runId}
				</Button>
			) : (
				<Item k="Run" v={runId} />
			)}
			{classState ? <EvidenceBadge state={classState} /> : <EvidenceBadge label="Class not reported" state="unverified" />}
		</div>
	)
}
