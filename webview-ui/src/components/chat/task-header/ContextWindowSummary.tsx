import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import React, { memo, useCallback, useMemo, useState } from "react"
import { formatUsageHeadline } from "@shared/getApiMetrics"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	totalCost?: number
}

interface TokenDetail {
	title: string
	value?: number
	icon: string
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: number
	contextWindow: number
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
}

// New accordion item component
const AccordionItem = memo<{
	title: string
	value: React.ReactNode
	isExpanded: boolean
	onToggle: (event?: React.MouseEvent) => void
	children?: React.ReactNode
}>(({ title, value, isExpanded, onToggle, children }) => {
	const handleClick = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
			onToggle(event)
		},
		[onToggle],
	)

	return (
		<div className="flex flex-col">
			<div
				className="flex justify-between items-center gap-3 cursor-pointer hover:bg-foreground/5 rounded px-1 py-0.5 transition-colors"
				onClick={handleClick}>
				<div className="flex items-center gap-1">
					{isExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
					<div className="font-semibold text-sm">{title}</div>
				</div>
				<div className="text-muted-foreground text-sm">{value}</div>
			</div>
			{isExpanded && children && <div className="ml-4 mt-2 mb-1 text-xs text-muted-foreground">{children}</div>}
		</div>
	)
})
AccordionItem.displayName = "AccordionItem"

// Labels follow the meter convention in shared/getApiMetrics.ts: "Uncached input" excludes cache hits and writes,
// so the four rows are disjoint and add up to the task total.
const TokenUsageDetails = memo<TokenUsageInfoProps>(({ tokensIn, tokensOut, cacheWrites, cacheReads }) => {
	const rows = useMemo(
		() =>
			[
				{ title: "Uncached input", icon: "codicon-arrow-up", value: tokensIn || 0 },
				{ title: "Cache reads (hits)", icon: "codicon-arrow-right", value: cacheReads || 0 },
				// Only providers that bill a cache write (Anthropic, Bedrock, Vertex) report any.
				{ title: "Cache writes", icon: "codicon-arrow-left", value: cacheWrites || 0 },
				{ title: "Output", icon: "codicon-arrow-down", value: tokensOut || 0 },
			] satisfies TokenDetail[],
		[tokensIn, tokensOut, cacheWrites, cacheReads],
	).filter((row) => row.value)

	if (rows.length === 0) {
		return <div>No token usage data available</div>
	}

	return (
		<div className="space-y-2">
			{rows.map((item) => (
				<div className="flex items-center justify-between" key={item.icon}>
					<div className="flex items-center gap-1">
						<i className={`codicon ${item.icon} text-xs`} />
						<span>{item.title}</span>
					</div>
					<span className="font-mono">{formatTokenNumber(item.value || 0)}</span>
				</div>
			))}
		</div>
	)
})
TokenUsageDetails.displayName = "TokenUsageDetails"

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	percentage,
	autoCompactThreshold = 0,
}) => {
	// Accordion state
	const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

	const toggleSection = useCallback((section: string, event?: React.MouseEvent) => {
		if (event) {
			event.preventDefault()
			event.stopPropagation()
		}
		setExpandedSections((prev) => {
			const newSet = new Set(prev)
			if (newSet.has(section)) {
				newSet.delete(section)
			} else {
				newSet.add(section)
			}
			return newSet
		})
	}, [])

	const totalInput = (tokensIn || 0) + (cacheWrites || 0) + (cacheReads || 0)
	const totalTokens = totalInput + (tokensOut || 0)
	const headline = formatUsageHeadline({
		contextNow: tokenUsed,
		contextWindow,
		totalTokens,
		cachedPercent: totalInput > 0 ? Math.round(((cacheReads || 0) / totalInput) * 100) : undefined,
		totalCost,
	})

	return (
		<div className="context-window-tooltip-content flex flex-col gap-2 bg-menu rounded shadow-sm border border-menu-border z-100 w-60 p-4">
			<div className="text-xs leading-relaxed" data-testid="usage-headline">
				{headline}
			</div>
			{autoCompactThreshold > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("threshold")}
					onToggle={(event) => toggleSection("threshold", event)}
					title="Auto Condense Threshold"
					value={<span className="text-muted-foreground">{`${(autoCompactThreshold * 100).toFixed(0)}%`}</span>}>
					<div className="space-y-1">
						<p className="text-xs leading-relaxed text-white">
							Click on the context window bar to set a new threshold.
						</p>
						<p className="text-xs leading-relaxed mt-0 mb-0">
							When the context window usage exceeds this threshold, the task will be automatically condensed.
						</p>
					</div>
				</AccordionItem>
			)}

			<AccordionItem
				isExpanded={expandedSections.has("context")}
				onToggle={(event) => toggleSection("context", event)}
				title="Context now"
				value={percentage ? `${percentage.toFixed(1)}% used` : formatTokenNumber(contextWindow)}>
				<div className="space-y-1">
					<div className="flex justify-between">
						<span>Used:</span>
						<span className="font-mono">{formatTokenNumber(tokenUsed)}</span>
					</div>
					<div className="flex justify-between">
						<span>Total:</span>
						<span className="font-mono">{formatTokenNumber(contextWindow)}</span>
					</div>
					<div className="flex justify-between">
						<span>Remaining:</span>
						<span className="font-mono">{formatTokenNumber(contextWindow - tokenUsed)}</span>
					</div>
				</div>
			</AccordionItem>

			{totalTokens > 0 && (
				<AccordionItem
					isExpanded={expandedSections.has("tokens")}
					onToggle={(event) => toggleSection("tokens", event)}
					title="This task"
					value={`${formatTokenNumber(totalTokens)} total`}>
					<TokenUsageDetails
						cacheReads={cacheReads}
						cacheWrites={cacheWrites}
						tokensIn={tokensIn}
						tokensOut={tokensOut}
					/>
				</AccordionItem>
			)}
		</div>
	)
}
