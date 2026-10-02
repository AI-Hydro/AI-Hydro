import type { InstallSkillRequest } from "@shared/proto/cline/skills"
import { InstallSkillResponse, SkillSource } from "@shared/proto/cline/skills"
import axios from "axios"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"
import { assertValidMarketplaceSkillId, resolveSkillDir, skillsRoot } from "./skillPaths"
import { assertTrustedSkillUrl } from "./skillUrlPolicy"

export interface SkillIntegrity {
	/** Digest of the SKILL.md bytes that were written, `sha256:<64 hex>`. */
	sha256: string
	/** True only when the digest matched a digest supplied by the catalog. */
	verified: boolean
}

export interface InstallSkillDeps {
	homeDir?: string
	/** Fetch the SKILL.md text; defaults to an axios GET that re-checks every redirect hop against the allowlist. */
	fetchText?: (url: string) => Promise<string>
}

function sha256Of(text: string): string {
	return `sha256:${createHash("sha256").update(text, "utf-8").digest("hex")}`
}

function normalizeDigest(digest: string): string {
	const hex = digest
		.trim()
		.toLowerCase()
		.replace(/^sha256:/, "")
	if (!/^[0-9a-f]{64}$/.test(hex)) {
		throw new Error("Invalid expected sha256: must be 64 hex characters")
	}
	return `sha256:${hex}`
}

async function defaultFetchText(url: string): Promise<string> {
	const response = await axios.get(url, {
		responseType: "text",
		timeout: 30000,
		// A redirect must not carry the download off the allowlisted origins.
		beforeRedirect: (options: { href?: string }) => {
			if (options.href) {
				assertTrustedSkillUrl(options.href, "installSkill redirect")
			}
		},
	})
	return typeof response.data === "string" ? response.data : String(response.data)
}

/**
 * Validate, download, verify and write a marketplace skill. Nothing touches the
 * disk until the id, origin and (when supplied) digest checks have passed.
 * The proto request and the Skills catalog carry no digest today, so the RPC
 * path records the computed digest as unverified; `expectedSha256` is honoured
 * as soon as a catalog supplies one.
 */
export async function installSkillVerified(
	skillId: string,
	skillUrl: string,
	name: string,
	expectedSha256?: string,
	deps: InstallSkillDeps = {},
): Promise<{ localPath: string; integrity: SkillIntegrity }> {
	assertValidMarketplaceSkillId(skillId)
	const skillDir = resolveSkillDir("marketplace", skillId, deps.homeDir)
	assertTrustedSkillUrl(skillUrl, "installSkill skillUrl")
	const expected = expectedSha256 ? normalizeDigest(expectedSha256) : undefined

	const content = await (deps.fetchText ?? defaultFetchText)(skillUrl)
	const actual = sha256Of(content)
	if (expected && expected !== actual) {
		throw new Error(`SKILL.md digest mismatch for ${skillId}: expected ${expected}, got ${actual}`)
	}
	const integrity: SkillIntegrity = { sha256: actual, verified: expected !== undefined }
	if (!integrity.verified) {
		console.warn(`[skills] ${skillId} installed UNVERIFIED (no catalog sha256 available); downloaded ${actual}`)
	}

	await fs.mkdir(skillDir, { recursive: true })
	const localPath = path.join(skillDir, "SKILL.md")
	await fs.writeFile(localPath, content, "utf-8")
	await updateInstalledRegistry(skillId, name, localPath, SkillSource.MARKETPLACE, integrity, deps.homeDir)
	return { localPath, integrity }
}

export async function installSkill(_controller: Controller, request: InstallSkillRequest): Promise<InstallSkillResponse> {
	const { skillId, skillUrl, name } = request
	try {
		const { localPath } = await installSkillVerified(skillId, skillUrl, name)
		void MarketplaceRecognitionService.recordEvent({
			marketplace: "skills",
			itemId: skillId,
			eventType: "install",
			source: "ui",
		})

		return InstallSkillResponse.create({ skillId, localPath, success: true })
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Install failed"
		return InstallSkillResponse.create({ skillId, localPath: "", success: false, error: msg })
	}
}

export async function updateInstalledRegistry(
	skillId: string,
	name: string,
	localPath: string,
	source: SkillSource,
	integrity?: SkillIntegrity,
	homeDir?: string,
): Promise<void> {
	const registryPath = path.join(skillsRoot(homeDir), "installed.json")
	let registry: Record<string, Record<string, unknown>> = {}
	try {
		registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
	} catch {
		// first time — start fresh
	}
	registry[skillId] = {
		id: skillId,
		name,
		localPath,
		source: SkillSource[source].toLowerCase(),
		installedAt: new Date().toISOString(),
		...(integrity ? { sha256: integrity.sha256, verified: integrity.verified } : {}),
	}
	await fs.mkdir(path.dirname(registryPath), { recursive: true })
	await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))
}
