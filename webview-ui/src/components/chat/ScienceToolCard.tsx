/**
 * Semantic card for a first-party science tool call (UI-W slice S3).
 *
 * All parsing is in the pure presenter (src/shared/aihydro/toolCallPresenter.ts); this component only lays the
 * model out. Rules it keeps:
 *  - a field the server did not send reads "not reported": never blank, never inferred;
 *  - the information class comes from the explicit field only;
 *  - a refusal is "Stopped: <code>" with the recovery options as text: no retry button, no fallback offer;
 *  - the run link is a link to Replay, not a verification; nothing here is green or says "verified".
 */
import {
	describeAreaRatio,
	assertedGauge,
	describeProvisional,
	describeQualityExtras,
	describeSiteResolution,
	type InformationClassInfo,
	presentToolCall,
	type ToolAnnotationsInput,
	type ToolMetaInput,
} from "@shared/aihydro/toolCallPresenter"
import React, { useMemo } from "react"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { Badge, Button, Disclosure, EvidenceBadge, KeyValue, stateForInformationClass, Text } from "@/design"
import "./ScienceToolCard.css"

export interface ScienceToolCardProps {
	serverName: string
	toolName: string
	argsJson?: string
	/** Response text of the call; undefined while it has not returned. */
	resultText?: string
	toolMeta?: ToolMetaInput
	annotations?: ToolAnnotationsInput
	/** True while the host is waiting for the server (shows "Running"). */
	running?: boolean
	/** True when a response arrived but could not be attributed to this call (concurrent calls). */
	unpaired?: boolean
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function ClassBadge({ info }: { info: InformationClassInfo | undefined }) {
	if (!info) {
		return <EvidenceBadge label="Class not reported" state="unverified" />
	}
	const state = info.recognised ? stateForInformationClass(info.value) : undefined
	if (!state) {
		return <EvidenceBadge label={`Unrecognised class: ${info.value}`} state="unverified" />
	}
	return <EvidenceBadge label={cap(info.value)} state={state} />
}

function sessionIdFromArgs(argsJson: string | undefined): string | undefined {
	try {
		const parsed = JSON.parse(argsJson || "{}")
		const id = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).session_id : undefined
		return typeof id === "string" && id.trim() ? id.trim() : undefined
	} catch {
		return undefined
	}
}

export const ScienceToolCard: React.FC<ScienceToolCardProps> = ({
	serverName,
	toolName,
	argsJson,
	resultText,
	toolMeta,
	annotations,
	running,
	unpaired,
}) => {
	const model = useMemo(
		() => presentToolCall(serverName, toolName, argsJson, resultText, annotations, toolMeta),
		[serverName, toolName, argsJson, resultText, annotations, toolMeta],
	)
	// Only a session the call or its own result names. No ambient fallback: the loaded session may not be the one that ran this.
	const sessionId = sessionIdFromArgs(argsJson) ?? model.sessionId
	const { refusal, siteResolution: sr, quality } = model
	const qualityLines = quality
		? [...(quality.provisional ? [describeProvisional(quality.provisional)] : []), ...describeQualityExtras(quality)]
		: []

	const openReplay = () => {
		if (model.runId && sessionId) {
			PLATFORM_CONFIG.postMessage({ type: "open_replay", session_id: sessionId, run_id: model.runId })
		}
	}

	const argItems = model.typedArgs.map((a) => ({
		label: a.name,
		value: (
			<>
				{a.value}
				{(a.type || a.units) && (
					<span className="aih-text--muted"> ({[a.type, a.units].filter(Boolean).join(", ")})</span>
				)}
			</>
		),
	}))

	return (
		<section
			aria-label={`Tool call ${toolName}`}
			className={`aih-toolcard${refusal ? " aih-toolcard--stopped" : ""}`}
			data-result-state={model.resultState}>
			<div className="aih-toolcard__head">
				<Text as="span" className="aih-toolcard__tool">
					{toolName}
				</Text>
				{model.effectHint && (
					<Text muted variant="caption">
						{model.effectHint}
					</Text>
				)}
			</div>
			{model.purpose ? (
				<Text muted>{model.purpose}</Text>
			) : (
				<Text muted variant="caption">
					Purpose: not reported
				</Text>
			)}

			{argItems.length > 0 && (
				<div className="aih-toolcard__section">
					<span className="aih-toolcard__label">Arguments</span>
					<KeyValue items={argItems} />
				</div>
			)}

			{model.resultState === "pending" && (
				<Text muted role="status" variant="caption">
					{unpaired
						? "Result not paired (concurrent calls): the response is shown below as raw text."
						: running
							? "Running…"
							: "No result recorded yet."}
				</Text>
			)}

			{refusal && (
				<div className="aih-toolcard__section" role="group" aria-label="Refusal">
					<div className="aih-toolcard__chips">
						<EvidenceBadge label={`Stopped: ${refusal.code ?? "code not reported"}`} state="refused" />
					</div>
					<Text>{refusal.message ?? "Message not reported."}</Text>
					{refusal.candidates.length > 0 && (
						<div className="aih-toolcard__section">
							<span className="aih-toolcard__label">Candidates the server listed</span>
							<ul className="aih-toolcard__list">
								{refusal.candidates.map((c) => (
									<li key={c}>{c}</li>
								))}
							</ul>
						</div>
					)}
					<div className="aih-toolcard__section">
						<span className="aih-toolcard__label">Recovery options (text only; nothing is retried for you)</span>
						{refusal.recovery.length > 0 ? (
							<ul className="aih-toolcard__list">
								{refusal.recovery.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
						) : (
							<Text muted>not reported</Text>
						)}
					</div>
					{refusal.nextTools.length > 0 && (
						<Text muted variant="caption">
							Tools the server suggests: {refusal.nextTools.join(", ")}
						</Text>
					)}
					{refusal.exampleCall && (
						<div className="aih-toolcard__section">
							<span className="aih-toolcard__label">Example call (text; not run)</span>
							<pre className="aih-toolcard__code">{refusal.exampleCall}</pre>
						</div>
					)}
				</div>
			)}

			{(model.resultState === "ok" || model.resultState === "unparsed") && (
				<div className="aih-toolcard__section">
					{model.resultState === "unparsed" && (
						<Text muted variant="caption">
							The result is not a structured object, so no fields could be read from it.
						</Text>
					)}
					{sr && (
						<>
							<div className="aih-toolcard__chips">
								<span
									aria-label={`Gauge resolution: ${describeSiteResolution(sr)}. ${describeAreaRatio(sr)}`}
									className="aih-badge aih-badge--outline"
									role="group"
									title={describeAreaRatio(sr)}>
									<span aria-hidden="true" className="codicon codicon-location" />
									<span>{describeSiteResolution(sr)}</span>
								</span>
							</div>
							{sr.areaCheck === "fail" && (
								<div className="aih-toolcard__warning">
									<span aria-hidden="true" className="codicon codicon-warning" />
									<div>
										<Text strong>Area check failed.</Text>{" "}
										<Text>
											The gauge's drainage area and the basin polygon disagree ({describeAreaRatio(sr)}).
										</Text>
										{assertedGauge(sr) && (
											<Text as="div">
												The server honoured the gauge you asserted: the returned data is for{" "}
												{sr.site ?? "that gauge"}, not for the basin polygon.
											</Text>
										)}
										{sr.warnings.map((w) => (
											<Text as="div" key={w} muted variant="caption">
												{w}
											</Text>
										))}
									</div>
								</div>
							)}
						</>
					)}
					<KeyValue
						items={[
							{
								label: "Place",
								value: model.place ? (
									<>
										{model.place.label}
										{model.place.detail && <span className="aih-text--muted"> · {model.place.detail}</span>}
									</>
								) : undefined,
							},
							{
								label: "Data source",
								value: model.dataSource
									? [
											model.dataSource.backend,
											model.dataSource.product,
											model.dataSource.source,
											model.dataSource.retrievedAt && `retrieved ${model.dataSource.retrievedAt}`,
										]
											.filter(Boolean)
											.join(" · ")
									: undefined,
							},
							{
								label: "Quality",
								value: qualityLines.length ? (
									<>
										{qualityLines.map((line) => (
											<div key={line}>{line}</div>
										))}
									</>
								) : undefined,
							},
							{ label: "Information class", value: <ClassBadge info={model.informationClass} /> },
							{
								label: "Run",
								value: model.runId ? (
									<span className="aih-toolcard__runlink">
										<Text breakAll mono>
											{model.runId}
										</Text>
										{sessionId ? (
											<Button icon="history" onClick={openReplay} variant="ghost">
												Open in Replay
											</Button>
										) : (
											<Badge title="Replay opens a run within a session, and no session id was reported.">
												Replay needs a session id
											</Badge>
										)}
									</span>
								) : undefined,
							},
						]}
					/>
				</div>
			)}

			{model.images.map((src, i) => (
				<img alt="Image returned by the tool" className="aih-toolcard__image" key={i} src={src} />
			))}

			<Disclosure label="Raw arguments and result (JSON)">
				<div className="aih-toolcard__section">
					<span className="aih-toolcard__label">Arguments</span>
					<pre className="aih-toolcard__code aih-toolcard__raw">{model.rawArgs || "(none)"}</pre>
					<span className="aih-toolcard__label">Result</span>
					<pre className="aih-toolcard__code aih-toolcard__raw">{model.rawResult ?? "(no result yet)"}</pre>
				</div>
			</Disclosure>
		</section>
	)
}

export default ScienceToolCard
