import { describeInvestigation, type InvestigationRecord } from "@shared/aihydro/investigationSummary"
import { StringRequest } from "@shared/proto/cline/common"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Badge, Button, Disclosure, KeyValue, Text } from "@/design"
import { TaskServiceClient } from "@/services/grpc-client"
import { formatLargeNumber } from "@/utils/format"
import { stripMarkdown } from "@/utils/stripMarkdown"
import "./history.css"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

/**
 * Task to investigation mapping. The host does not yet tell the webview which investigation (session) a past task
 * belonged to, so every card honestly reads "Investigation record not linked yet" until it does. The presenter and card are
 * ready for it: pass a record and the science line shows the basin/gauge and claim counts by state.
 */
const investigationFor = (_taskId: string): InvestigationRecord | undefined => undefined

const formatDate = (timestamp: number) =>
	new Date(timestamp)
		.toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
		.replace(", ", " ")
		.replace(" at", ",")

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory } = useExtensionState()
	const items = taskHistory.filter((item) => item.ts && item.task).slice(0, 3)

	const open = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	return (
		<section aria-labelledby="recent-tasks-title" className="history-preview">
			<Text as="h2" id="recent-tasks-title" muted variant="label">
				Recent tasks
			</Text>
			{items.length === 0 ? (
				<Text as="p" muted variant="label">
					No recent tasks
				</Text>
			) : (
				<>
					{items.map((item) => (
						<article className="history-card" key={item.id}>
							<div className="history-card__meta">
								<Text muted variant="caption">
									{formatDate(item.ts)}
								</Text>
								{item.isFavorited && <Badge icon="star-full">Favorited</Badge>}
							</div>
							<button className="history-card__title ph-no-capture" onClick={() => open(item.id)} type="button">
								{stripMarkdown(item.task)}
							</button>
							<Text as="p" muted variant="caption">
								{describeInvestigation(investigationFor(item.id))}
							</Text>
							<Disclosure label="Usage">
								<KeyValue
									items={[
										{ label: "Tokens in", value: formatLargeNumber(item.tokensIn || 0) },
										{ label: "Tokens out", value: formatLargeNumber(item.tokensOut || 0) },
										{
											label: "Cache writes",
											value: item.cacheWrites ? formatLargeNumber(item.cacheWrites) : undefined,
										},
										{ label: "Cost", value: item.totalCost ? `$${item.totalCost.toFixed(4)}` : undefined },
									]}
								/>
							</Disclosure>
						</article>
					))}
					<div>
						<Button onClick={() => showHistoryView()} variant="ghost">
							View all history
						</Button>
					</div>
				</>
			)}
		</section>
	)
}

export default memo(HistoryPreview)
