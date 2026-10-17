import { EmptyRequest } from "@shared/proto/cline/common"
import AiHydroLogoVariable from "@/assets/AiHydroLogoVariable"
import { Button, Disclosure, Text } from "@/design"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import "./welcome.css"

/** Chat-home header: small static logo, plain title, and what the agent can do behind a disclosure. */
const HomeHeader = () => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	return (
		<header>
			<div className="welcome-brand">
				<AiHydroLogoVariable aria-hidden="true" className="welcome-brand__logo" environment={environment} />
				<div>
					<Text as="h1" variant="title">
						AI-Hydro
					</Text>
					<Text as="p" muted variant="label">
						Hydrology research with a recorded evidence trail.
					</Text>
				</div>
			</div>
			<div style={{ padding: "0 var(--aih-space-5) var(--aih-space-2)" }}>
				<Disclosure label="What can AI-Hydro do?">
					<Text as="p" variant="label">
						It can help with watershed analysis, CAMELS data, streamflow and signature computation, hydrological
						models and Python-based hydrology computations. Tools that fetch data need network access, and every run
						is recorded so you can replay it.
					</Text>
					<Button onClick={() => void handleTakeATour()} variant="ghost">
						Take a tour
					</Button>
				</Disclosure>
			</div>
		</header>
	)
}

export default HomeHeader
