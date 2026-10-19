import * as crypto from "node:crypto"
import axios from "axios"
import { AiHydroEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { getDistinctId } from "@/services/logging/distinctId"
import { Setting } from "@/shared/proto/index.host"

export type RecognitionMarketplace = "gallery" | "skills" | "modules" | "mcp" | "connectors" | "courses"
export type RecognitionEventType = "import" | "install" | "open_source" | "copy_citation" | "template_open" | "uninstall" | "cite"

export interface MarketplaceRecognitionEvent {
	marketplace: RecognitionMarketplace
	itemId: string
	eventType: RecognitionEventType
	itemType?: string
	itemVersion?: string
	source?: "ui" | "agent" | "command"
}

export interface MarketplaceRecognitionCounts {
	marketplace: RecognitionMarketplace
	itemId: string
	events: Record<string, number>
	total: number
	aiHydroStars: number
	starredByClient: boolean
	updatedAt?: string
}

export interface MarketplaceStarResult {
	marketplace: RecognitionMarketplace
	itemId: string
	starred: boolean
	aiHydroStars: number
}

function apiBaseUrl(): string {
	return AiHydroEnv.config().recognitionApiBaseUrl.replace(/\/+$/, "")
}

function anonymousClientHash(): string {
	let distinctId = ""
	try {
		distinctId = getDistinctId()
	} catch {
		distinctId = "unknown"
	}
	return crypto.createHash("sha256").update(`aihydro-recognition:${distinctId}`).digest("hex")
}

/**
 * Recognition requests carry a stable client-derived pseudonymous hash, so they
 * are telemetry. Nothing is sent unless BOTH the host editor's telemetry setting
 * (VS Code: `telemetry.telemetryLevel` / `vscode.env.isTelemetryEnabled`) and the
 * extension's own `telemetrySetting` allow it. Fails closed: if either cannot be
 * read, nothing is sent.
 */
export async function isRecognitionTelemetryAllowed(): Promise<boolean> {
	let allowed = false
	try {
		const host = await HostProvider.env.getTelemetrySettings({})
		allowed =
			(host.isEnabled === Setting.ENABLED || host.isEnabled === Setting.UNSUPPORTED) &&
			StateManager.get().getGlobalSettingsKey("telemetrySetting") !== "disabled"
	} catch {
		allowed = false
	}
	if (!allowed) {
		// This exact phrase is also checked in the packaged bundle by scripts/check-bundle-leaks.mjs.
		console.debug("AI-Hydro recognition skipped: telemetry is disabled")
	}
	return allowed
}

export class MarketplaceRecognitionService {
	static isConfigured(): boolean {
		return apiBaseUrl().length > 0
	}

	static async recordEvent(event: MarketplaceRecognitionEvent): Promise<void> {
		const baseUrl = apiBaseUrl()
		if (!baseUrl || !event.itemId) return
		if (!(await isRecognitionTelemetryAllowed())) return
		try {
			await axios.post(
				`${baseUrl}/events`,
				{
					marketplace: event.marketplace,
					itemId: event.itemId,
					eventType: event.eventType,
					itemType: event.itemType ?? "",
					itemVersion: event.itemVersion ?? "",
					source: event.source ?? "ui",
					clientIdHash: anonymousClientHash(),
					aiHydroVersion: process.env.npm_package_version ?? "",
				},
				{
					headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
					timeout: 5_000,
				},
			)
		} catch (error) {
			console.warn("AI-Hydro recognition event was not recorded:", error instanceof Error ? error.message : error)
		}
	}

	static async getCounts(marketplace: RecognitionMarketplace): Promise<Map<string, MarketplaceRecognitionCounts>> {
		const baseUrl = apiBaseUrl()
		if (!baseUrl) return new Map()
		if (!(await isRecognitionTelemetryAllowed())) return new Map()
		try {
			const response = await axios.get(`${baseUrl}/counts`, {
				params: { marketplace, clientIdHash: anonymousClientHash() },
				headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
				timeout: 5_000,
			})
			const rows = Array.isArray(response.data?.items)
				? response.data.items
				: Array.isArray(response.data)
					? response.data
					: []
			const counts = new Map<string, MarketplaceRecognitionCounts>()
			for (const row of rows) {
				const itemId = String(row.itemId ?? row.item_id ?? "")
				if (!itemId) continue
				counts.set(itemId, {
					marketplace,
					itemId,
					events: row.events && typeof row.events === "object" ? row.events : {},
					total: Number(row.total ?? 0),
					aiHydroStars: Number(row.events?.star ?? row.aiHydroStars ?? row.ai_hydro_stars ?? 0),
					starredByClient: Boolean(row.starredByClient ?? row.starred_by_client ?? false),
					updatedAt: row.updatedAt ?? row.updated_at,
				})
			}
			return counts
		} catch (error) {
			console.warn("AI-Hydro recognition counts unavailable:", error instanceof Error ? error.message : error)
			return new Map()
		}
	}

	static async setStar(marketplace: RecognitionMarketplace, itemId: string, starred: boolean): Promise<MarketplaceStarResult> {
		const baseUrl = apiBaseUrl()
		if (!baseUrl || !itemId) {
			return { marketplace, itemId, starred: false, aiHydroStars: 0 }
		}
		if (!(await isRecognitionTelemetryAllowed())) {
			return { marketplace, itemId, starred: false, aiHydroStars: 0 }
		}
		try {
			const response = await axios.post(
				`${baseUrl}/stars`,
				{
					marketplace,
					itemId,
					starred,
					clientIdHash: anonymousClientHash(),
				},
				{
					headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
					timeout: 5_000,
				},
			)
			return {
				marketplace,
				itemId,
				starred: Boolean(response.data?.starred ?? starred),
				aiHydroStars: Number(response.data?.stars ?? response.data?.aiHydroStars ?? 0),
			}
		} catch (error) {
			console.warn("AI-Hydro star was not updated:", error instanceof Error ? error.message : error)
			throw error
		}
	}
}
