import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useAiHydroAuth } from "@/context/AiHydroAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"

export const AiHydroAccountInfoCard = () => {
	const { aihydroUser } = useAiHydroAuth()
	const { navigateToAccount } = useExtensionState()

	const user = aihydroUser || undefined

	const handleLogin = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to get login URL:", err),
		)
	}

	const handleShowAccount = () => {
		navigateToAccount()
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					View Billing & Usage
				</VSCodeButton>
			) : (
				<div>
					<VSCodeButton className="mt-0" onClick={handleLogin}>
						Sign Up with AI-Hydro
					</VSCodeButton>
				</div>
			)}
		</div>
	)
}
