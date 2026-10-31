import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { HistoryIcon, MapIcon, PlusIcon, ServerIcon, SettingsIcon } from "lucide-react"
import { Fragment, useMemo } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"
import HeroTooltip from "../common/HeroTooltip"

const ConnectorsIcon = ({ className, size }: { className?: string; size?: number; strokeWidth?: number }) => (
	<span
		className={`codicon codicon-plug flex items-center justify-center ${className || ""}`}
		style={{ fontSize: size ? `${size}px` : "16px", marginBottom: "1px" }}
	/>
)

/** Tabs that start a new visual group in the navbar. */
const NAV_GROUP_STARTS = new Set(["mcp", "map", "history", "settings"])

export const Navbar = () => {
	const {
		navigateToHistory,
		navigateToSettings,
		navigateToMcp,
		navigateToMap,
		navigateToConnectors,
		navigateToChat,
		showMcp,
		showMap,
		showConnectors,
		showHistory,
		showSettings,
	} = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "Chat",
				tooltip: "New Task",
				icon: PlusIcon,
				isActive: !showMcp && !showMap && !showConnectors && !showHistory && !showSettings,
				navigate: () => {
					TaskServiceClient.clearTask({})
						.catch((error) => {
							console.error("Failed to clear task:", error)
						})
						.finally(() => navigateToChat())
				},
			},
			{
				id: "mcp",
				name: "MCP",
				tooltip: "Hydro Tools & Data Sources",
				icon: ServerIcon,
				isActive: showMcp,
				navigate: navigateToMcp,
			},
			{
				id: "connectors",
				name: "Connectors",
				tooltip: "External Connectors",
				icon: ConnectorsIcon,
				isActive: showConnectors,
				navigate: navigateToConnectors,
			},
			{
				id: "map",
				name: "Map",
				tooltip: "Map View",
				icon: MapIcon,
				isActive: showMap,
				navigate: navigateToMap,
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				isActive: showHistory,
				navigate: navigateToHistory,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				isActive: showSettings,
				navigate: navigateToSettings,
			},
		],
		[
			navigateToChat,
			navigateToHistory,
			navigateToMap,
			navigateToMcp,
			navigateToConnectors,
			navigateToSettings,
			showMcp,
			showMap,
			showConnectors,
			showHistory,
			showSettings,
		],
	)

	return (
		<nav
			aria-label="AI-Hydro navigation"
			className="flex-none inline-flex justify-end bg-transparent gap-1 mb-1 z-10 border-none items-center mr-3"
			id="aihydro-navbar-container"
			style={{ gap: "2px" }}>
			{SETTINGS_TABS.map((tab, index) => (
				<Fragment key={`navbar-group-${tab.id}`}>
					{/* Groups: new task | tools and data | map | history | settings */}
					{index > 0 && NAV_GROUP_STARTS.has(tab.id) && (
						<span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--vscode-panel-border)]" />
					)}
					<HeroTooltip content={tab.tooltip} key={`navbar-tooltip-${tab.id}`} placement="bottom">
						<VSCodeButton
							appearance="icon"
							aria-label={tab.tooltip}
							data-testid={`tab-${tab.id}`}
							key={`navbar-button-${tab.id}`}
							onClick={() => tab.navigate()}
							style={{ padding: "4px", height: "28px", width: "28px" }}>
							<div
								className={`flex items-center justify-center rounded-md transition-all duration-200 ${
									tab.isActive
										? "bg-aihydro-ocean-blue/15 text-aihydro-ocean-light"
										: "text-[var(--vscode-foreground)]/70 hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
								}`}>
								<tab.icon size={16} strokeWidth={tab.isActive ? 2 : 1.5} />
							</div>
						</VSCodeButton>
					</HeroTooltip>
				</Fragment>
			))}
		</nav>
	)
}
