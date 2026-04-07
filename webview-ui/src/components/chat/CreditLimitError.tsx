import { AskResponseRequest } from "@shared/proto/cline/task"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import VSCodeButtonLink from "@/components/common/VSCodeButtonLink"
import { TaskServiceClient } from "@/services/grpc-client"

interface CreditLimitErrorProps {
	currentBalance: number
	totalSpent?: number
	totalPromotions?: number
	message: string
	buyCreditsUrl?: string
}

const DEFAULT_BUY_CREDITS_URL = {
	USER: "https://github.com/galib9690/AI-Hydro#readme",
	ORG: "https://github.com/galib9690/AI-Hydro#readme",
}

const CreditLimitError: React.FC<CreditLimitErrorProps> = ({
	message = "You have run out of credits.",
	buyCreditsUrl,
	currentBalance,
	totalPromotions,
	totalSpent,
}) => {
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
						await TaskServiceClient.askResponse(
							AskResponseRequest.create({
								responseType: "yesButtonClicked",
							}),
						)
					} catch (error) {
						console.error("Error invoking action:", error)
					}
				}}>
				<span className="codicon codicon-refresh mr-1.5" />
				Retry Request
			</VSCodeButton>
		</div>
	)
}

export default CreditLimitError
