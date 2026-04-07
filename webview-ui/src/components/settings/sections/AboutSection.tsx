import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	renderSectionHeader: (tabId: string) => JSX.Element | null
}
const AboutSection = ({ version, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div style={{ padding: "0 16px" }}>
					<h2>AI-Hydro v{version}</h2>
					<p>
						An AI assistant for hydrological and computational workflows that can use your CLI and editor. AI-Hydro
						can handle complex tasks step-by-step with tools that create and edit files, explore projects, use the
						browser, and execute terminal commands (after you grant permission).
					</p>

					<h3>Community & Support</h3>
					<p>
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro/discussions">Community</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro/issues">Support</VSCodeLink>
					</p>

					<h3>Development</h3>
					<p>
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro/discussions"> Feature Requests</VSCodeLink>
					</p>

					<h3>Resources</h3>
					<p>
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro#readme">Documentation</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/galib9690/AI-Hydro">AI-Hydro Project</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
