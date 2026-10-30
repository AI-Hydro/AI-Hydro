import { ExtensionMessage } from "@shared/ExtensionMessage"
import { ResetStateRequest } from "@shared/proto/cline/state"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SubviewHeader, TabPanel, Tabs } from "@/design"
import { StateServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import { Tab, TabContent } from "../common/Tab"
import SectionHeader from "./SectionHeader"
import AboutSection from "./sections/AboutSection"
import ApiConfigurationSection from "./sections/ApiConfigurationSection"
import BrowserSettingsSection from "./sections/BrowserSettingsSection"
import DebugSection from "./sections/DebugSection"
import FeatureSettingsSection from "./sections/FeatureSettingsSection"
import GeneralSettingsSection from "./sections/GeneralSettingsSection"
import TerminalSettingsSection from "./sections/TerminalSettingsSection"

const IS_DEV = process.env.IS_DEV

// The section list: a vertical tab list, icon-only (names stay as aria-label and tooltip) when the view is narrow.
const settingsTabsContainer = "flex flex-1 overflow-hidden"
const settingsTabList =
	"flex-shrink-0 overflow-y-auto overflow-x-hidden [&_.aih-tab]:h-12 [&_.aih-tab]:px-4 [&_.aih-tab]:border-l-2"

// Tab definitions
interface SettingsTab {
	id: string
	name: string
	tooltipText: string
	headerText: string
	/** Codicon name without prefix. */
	icon: string
	hidden?: boolean
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "API Configuration",
		tooltipText: "API Configuration",
		headerText: "API Configuration",
		icon: "settings",
	},
	{
		id: "features",
		name: "Features",
		tooltipText: "Feature Settings",
		headerText: "Feature Settings",
		icon: "checklist",
	},
	{
		id: "browser",
		name: "Browser",
		tooltipText: "Browser Settings",
		headerText: "Browser Settings",
		icon: "browser",
	},
	{
		id: "terminal",
		name: "Terminal",
		tooltipText: "Terminal Settings",
		headerText: "Terminal Settings",
		icon: "terminal",
	},
	// Only show in dev mode
	{
		id: "debug",
		name: "Debug",
		tooltipText: "Debug Tools",
		headerText: "Debug",
		icon: "beaker",
		hidden: !IS_DEV,
	},
	{
		id: "general",
		name: "General",
		tooltipText: "General Settings",
		headerText: "General Settings",
		icon: "tools",
	},
	{
		id: "about",
		name: "About",
		tooltipText: "About AI-Hydro",
		headerText: "About",
		icon: "info",
	},
]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

// Helper to render section header - moved outside component for better performance
const renderSectionHeader = (tabId: string) => {
	const tab = SETTINGS_TABS.find((t) => t.id === tabId)
	if (!tab) {
		return null
	}

	return (
		<SectionHeader>
			<div className="flex items-center gap-2">
				<span aria-hidden="true" className={`codicon codicon-${tab.icon}`} />
				<div>{tab.headerText}</div>
			</div>
		</SectionHeader>
	)
}

const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	// Memoize to avoid recreation
	const TAB_CONTENT_MAP = useMemo(
		() => ({
			"api-config": ApiConfigurationSection,
			general: GeneralSettingsSection,
			features: FeatureSettingsSection,
			browser: BrowserSettingsSection,
			terminal: TerminalSettingsSection,
			about: AboutSection,
			debug: DebugSection,
		}),
		[],
	) // Empty deps - these imports never change

	const { version, environment } = useExtensionState()

	// Initialize active tab with memoized calculation
	const initialTab = useMemo(() => targetSection || SETTINGS_TABS[0].id, [targetSection])

	const [activeTab, setActiveTab] = useState<string>(initialTab)
	const [isCompactMode, setIsCompactMode] = useState(true)
	const containerRef = useRef<HTMLDivElement>(null)

	// Optimized message handler with early returns
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type !== "grpc_response") {
			return
		}

		const grpcMessage = message.grpc_response?.message
		if (grpcMessage?.key !== "scrollToSettings") {
			return
		}

		const tabId = grpcMessage.value
		if (!tabId) {
			return
		}

		// Check if valid tab ID
		if (SETTINGS_TABS.some((tab) => tab.id === tabId)) {
			setActiveTab(tabId)
			return
		}

		// Fallback to element scrolling
		requestAnimationFrame(() => {
			const element = document.getElementById(tabId)
			if (!element) {
				return
			}

			element.scrollIntoView({ behavior: "smooth" })
			element.style.transition = "background-color 0.5s ease"
			element.style.backgroundColor = "var(--vscode-textPreformat-background)"

			setTimeout(() => {
				element.style.backgroundColor = "transparent"
			}, 1200)
		})
	}, [])

	useEvent("message", handleMessage)

	// Memoized reset state handler
	const handleResetState = useCallback(async (resetGlobalState?: boolean) => {
		try {
			await StateServiceClient.resetState(ResetStateRequest.create({ global: resetGlobalState }))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}, [])

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection) {
			setActiveTab(targetSection)
		}
	}, [targetSection])

	// Simplified tab change handler without debugging
	const handleTabChange = useCallback((tabId: string) => {
		setActiveTab(tabId)
	}, [])

	// Optimized resize observer with debouncing
	useEffect(() => {
		const container = containerRef.current
		if (!container) {
			return
		}

		const checkCompactMode = debounce((width: number) => {
			setIsCompactMode(width < 500)
		}, 100)

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) {
				checkCompactMode(entry.contentRect.width)
			}
		})

		observer.observe(container)
		return () => observer.disconnect()
	}, [])

	// Memoized active content component
	const ActiveContent = useMemo(() => {
		const Component = TAB_CONTENT_MAP[activeTab as keyof typeof TAB_CONTENT_MAP]
		if (!Component) {
			return null
		}

		// Special props for specific components
		const props: any = { renderSectionHeader }
		if (activeTab === "debug") {
			props.onResetState = handleResetState
		} else if (activeTab === "about") {
			props.version = version
		}

		return <Component {...props} />
	}, [activeTab, handleResetState, version])

	const titleColor = getEnvironmentColor(environment)

	const visibleTabs = SETTINGS_TABS.filter((tab) => !tab.hidden).map((tab) => ({
		id: tab.id,
		label: tab.name,
		icon: tab.icon,
		iconOnly: isCompactMode,
	}))

	return (
		<Tab>
			<SubviewHeader onClose={onDone} title="Settings" titleColor={titleColor} />

			<div className={settingsTabsContainer} ref={containerRef}>
				<Tabs
					className={`${settingsTabList} ${isCompactMode ? "w-12" : "w-48"}`}
					idBase="settings"
					items={visibleTabs}
					label="Settings sections"
					onValueChange={handleTabChange}
					orientation="vertical"
					value={activeTab}
				/>

				<TabContent className="flex-1 overflow-auto">
					<TabPanel idBase="settings" selected tab={activeTab}>
						{ActiveContent}
					</TabPanel>
				</TabContent>
			</div>
		</Tab>
	)
}

export default SettingsView
