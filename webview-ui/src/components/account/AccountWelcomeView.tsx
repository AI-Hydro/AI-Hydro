import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { handleSignIn } from "@/context/AiHydroAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import AiHydroLogoVariable from "../../assets/AiHydroLogoVariable"

export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()

	return (
		<div className="flex flex-col items-center pr-3">
			<AiHydroLogoVariable className="size-16 mb-4" environment={environment} />

			<p>
				Sign up for an account to get access to the latest models, billing dashboard to view usage and credits, and more
				upcoming features.
			</p>

			<VSCodeButton className="w-full mb-4" onClick={() => handleSignIn()}>
				Sign up with AI-Hydro
			</VSCodeButton>

			<p className="text-[var(--vscode-descriptionForeground)] text-xs text-center m-0">
				By continuing, you agree to the{" "}
				<VSCodeLink href="https://github.com/AI-Hydro/AI-Hydro#readme">Terms of Service</VSCodeLink> and{" "}
				<VSCodeLink href="https://github.com/AI-Hydro/AI-Hydro#readme">Privacy Policy.</VSCodeLink>
			</p>
		</div>
	)
}
