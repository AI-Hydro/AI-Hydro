import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo, useState } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { STALE_ASK_NOTICE, sendBoundAskResponse } from "./chat-view/askBinding"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	buyCreditsUrl?: string
	/** ts of the api_req_failed ask the Retry button answers; dropped by the host if that ask is no longer pending. */
	askTs: number
}

const DEFAULT_BUY_CREDITS_URL = {
	USER: "https://github.com/AI-Hydro/AI-Hydro#readme",
	ORG: "https://github.com/AI-Hydro/AI-Hydro#readme",
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	message = "You have run out of credits.",
	buyCreditsUrl,
	currentBalance,
	totalPromotions,
	totalSpent,
	askTs,
}) => {
	const [stale, setStale] = useState(false)
	const dashboardUrl = useMemo(() => {
		return buyCreditsUrl ?? DEFAULT_BUY_CREDITS_URL.USER
	}, [buyCreditsUrl])

	// We have to divide because the balance is stored in microcredits
	return (
		<div className="p-2 border-none rounded-md mb-2 bg-[var(--vscode-textBlockQuote-background)]">
			<div className="mb-3 font-azeret-mono">
				<div className="text-error mb-2">{message}</div>
				<div className="mb-3">
					{currentBalance ? (
						<div className="text-foreground">
							Current Balance: <span className="font-bold">{currentBalance.toFixed(2)}</span>
						</div>
					) : null}
					{totalSpent ? <div className="text-foreground">Total Spent: {totalSpent.toFixed(2)}</div> : null}
					{totalPromotions ? (
						<div className="text-foreground">Total Promotions: {totalPromotions.toFixed(2)}</div>
					) : null}
				</div>
			</div>

			<VSCodeButtonLink className="w-full mb-2" href={dashboardUrl}>
				<span className="codicon codicon-credit-card mr-[6px] text-[14px]" />
				Buy Credits
			</VSCodeButtonLink>

			<VSCodeButton
				appearance="secondary"
				className="w-full"
				onClick={async () => {
					try {
						setStale(await sendBoundAskResponse({ responseType: "yesButtonClicked" }, askTs))
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
			<div aria-live="polite" className="text-[12px] mt-1" data-testid="credit-stale-notice" role="status">
				{stale ? STALE_ASK_NOTICE : ""}
			</div>
		</div>
	)
}

export default CreditLimitError
