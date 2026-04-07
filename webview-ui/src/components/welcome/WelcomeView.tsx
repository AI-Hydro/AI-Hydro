import { BooleanRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"

import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

const WelcomeView = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to update API configuration or complete welcome view:", error)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col bg-gradient-to-br from-aihydro-ocean-dark via-aihydro-background to-aihydro-surface">
			<div className="h-full px-5 overflow-auto">
				<h2 className="text-aihydro-text">Hi, I'm AI-Hydro</h2>
				<div className="flex justify-center my-5">
					<div className="w-16 h-16 bg-gradient-to-br from-aihydro-ocean-blue to-aihydro-teal rounded-lg flex items-center justify-center">
						<span className="text-2xl">🌊</span>
					</div>
				</div>
				<p>
					I can do all kinds of tasks thanks to breakthroughs in{" "}
					<VSCodeLink className="inline" href="https://www.anthropic.com/claude/sonnet">
						Claude 4 Sonnet's
					</VSCodeLink>
					agentic coding capabilities and access to tools that let me create & edit files, explore complex projects, use
					a browser, and execute terminal commands <i>(with your permission, of course)</i>. I can even use MCP to
					create new tools and extend my own capabilities.
				</p>

				<p className="text-[var(--vscode-descriptionForeground)]">Configure a model provider to get started.</p>

				<div className="mt-4.5">
					<ApiOptions currentMode={mode} showModelOptions={false} />
					<VSCodeButton className="mt-0.75" disabled={disableLetsGoButton} onClick={handleSubmit}>
						Let's go!
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
