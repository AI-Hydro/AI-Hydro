import { BooleanRequest } from "@shared/proto/cline/common"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import AiHydroLogoVariable from "@/assets/AiHydroLogoVariable"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Button, Text } from "@/design"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"
import "./welcome.css"

/** First-run view: what AI-Hydro is, then model-provider setup. Static: no hero art or motion. */
const WelcomeView = memo(() => {
	const { apiConfiguration, environment, mode } = useExtensionState()
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
		<div className="fixed inset-0 overflow-auto bg-[var(--vscode-editor-background)]">
			<main className="welcome-setup">
				<div className="welcome-brand" style={{ padding: 0 }}>
					<AiHydroLogoVariable aria-hidden="true" className="welcome-brand__logo" environment={environment} />
					<Text as="h1" variant="heading">
						Welcome to AI-Hydro
					</Text>
				</div>
				<Text as="p" variant="body">
					AI-Hydro is a hydrology research assistant. It runs analyses with recorded tools, keeps the evidence behind
					each claim, and asks before it edits files or runs commands. It connects to specialised tools through{" "}
					<VSCodeLink className="inline" href="https://modelcontextprotocol.io/">
						MCP
					</VSCodeLink>
					. Tools that fetch data need network access.
				</Text>
				<section aria-labelledby="welcome-provider-title" className="welcome-panel">
					<Text as="h2" id="welcome-provider-title" variant="title">
						Choose a model provider
					</Text>
					<ApiOptions currentMode={mode} showModelOptions={false} />
				</section>
				<div>
					<Button disabled={disableLetsGoButton} onClick={() => void handleSubmit()} variant="primary">
						Continue
					</Button>
				</div>
			</main>
		</div>
	)
})

export default WelcomeView
