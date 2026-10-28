import platformConfigs from "./platform-configs.json"

export interface PlatformConfig {
	type: PlatformType
	messageEncoding: MessageEncoding
	showNavbar: boolean
	postMessage: PostMessageFunction
	encodeMessage: MessageEncoder
	decodeMessage: MessageDecoder
	togglePlanActKeys: string
	supportsTerminalMentions: boolean
}

export enum PlatformType {
	VSCODE = 0,
	STANDALONE = 1,
}

function stringToPlatformType(name: string): PlatformType {
	const mapping: Record<string, PlatformType> = {
		vscode: PlatformType.VSCODE,
		standalone: PlatformType.STANDALONE,
	}
	if (name in mapping) {
		return mapping[name]
	}
	console.error("Unknown platform:", name)
	// Default to VSCode for unknown types
	return PlatformType.VSCODE
}

// Internal type for JSON structure (not exported)
type PlatformConfigJson = {
	messageEncoding: "none" | "json"
	showNavbar: boolean
	postMessageHandler: "vscode" | "standalone"
	togglePlanActKeys: string
	supportsTerminalMentions: boolean
}

type PlatformConfigs = Record<string, PlatformConfigJson>

// Global type declarations for postMessage and vscode API
declare global {
	interface Window {
		// This is the post message handler injected by JetBrains.
		// !! Do not change the name of the handler without updating it on
		// the JetBrains side as well. !!
		standalonePostMessage?: (message: string) => void
	}
	function acquireVsCodeApi(): any
}

// Initialize the vscode API if available
const vsCodeApi = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null

/**
 * VS Code's per-webview state: survives a reload of the same webview (a shell reload), unlike React
 * state. Reads and writes merge by key so independent features do not clobber each other.
 */
export const webviewState = {
	get<T>(key: string): T | undefined {
		try {
			return (vsCodeApi?.getState?.() as Record<string, unknown> | undefined)?.[key] as T | undefined
		} catch {
			return undefined
		}
	},
	set(key: string, value: unknown): void {
		try {
			vsCodeApi?.setState?.({ ...((vsCodeApi.getState?.() as object | undefined) ?? {}), [key]: value })
		} catch {
			// state is a convenience; never break the shell over it
		}
	},
}

// Implementations for post message handling
const postMessageStrategies: Record<string, PostMessageFunction> = {
	vscode: (message: any) => {
		if (vsCodeApi) {
			vsCodeApi.postMessage(message)
		} else {
			console.log("postMessage fallback: ", message)
		}
	},
	standalone: (message: any) => {
		if (!window.standalonePostMessage) {
			console.error("Standalone postMessage not found.")
			return
		}
		const json = JSON.stringify(message)
		console.log("Standalone postMessage: " + json.slice(0, 200))
		window.standalonePostMessage(json)
	},
}

// Implementations for message encoding
const messageEncoders: Record<string, MessageEncoder> = {
	none: <T>(message: T, _encoder: (_: T) => unknown) => message,
	json: <T>(message: T, encoder: (_: T) => unknown) => encoder(message),
}

// Implementations for message decoding
const messageDecoders: Record<string, MessageDecoder> = {
	none: <T>(message: any, _decoder: (_: { [key: string]: any }) => T) => message,
	json: <T>(message: any, decoder: (_: { [key: string]: any }) => T) => decoder(message),
}

// Local declaration of the platform compile-time constant
declare const __PLATFORM__: string

// Get the specific platform config at compile time
const configs = platformConfigs as PlatformConfigs
const selectedConfig = configs[__PLATFORM__]
console.log("[PLATFORM_CONFIG] Build platform:", __PLATFORM__)

// Build the platform config with injected functions
// Callers should use this in the situations where the react component is not available.
export const PLATFORM_CONFIG: PlatformConfig = {
	type: stringToPlatformType(__PLATFORM__),
	messageEncoding: selectedConfig.messageEncoding,
	showNavbar: selectedConfig.showNavbar,
	postMessage: postMessageStrategies[selectedConfig.postMessageHandler],
	encodeMessage: messageEncoders[selectedConfig.messageEncoding],
	decodeMessage: messageDecoders[selectedConfig.messageEncoding],
	togglePlanActKeys: selectedConfig.togglePlanActKeys,
	supportsTerminalMentions: selectedConfig.supportsTerminalMentions,
}

type MessageEncoding = "none" | "json"

// Function types for platform-specific behaviors
type PostMessageFunction = (message: any) => void
type MessageEncoder = <T>(message: T, encoder: (_: T) => unknown) => any
type MessageDecoder = <T>(message: any, decoder: (_: { [key: string]: any }) => T) => T
