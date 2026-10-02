import { isInsideSkillsSource, sha256Digest, skillsRoot, sourceDirForRegistrySource } from "@core/controller/skills/skillPaths"
import * as fs from "fs/promises"
import * as path from "path"

export type SkillToggles = Record<string, boolean> // skillId → enabled (default true)

type RegistryEntry = {
	id: string
	name: string
	localPath: string
	source?: string
	sha256?: string
	verified?: boolean
}

// Log "installed but unverified" once per skill per process, not on every prompt build.
const warnedUnverified = new Set<string>()

/**
 * Reads all installed + enabled skills and returns their combined content
 * for injection into the system prompt.
 *
 * Skill text is trusted prompt content, so each entry is re-checked here, not
 * only at install time: its file must live inside its source directory under
 * ~/.aihydro/skills, and when `installed.json` recorded a sha256 the file must
 * still hash to it. Skills installed without a catalog digest (`verified: false`)
 * are still injected, with a one-time log line per skill.
 */
export async function getInstalledSkillsInstructions(toggles: SkillToggles, homeDir?: string): Promise<string | undefined> {
	const registryPath = path.join(skillsRoot(homeDir), "installed.json")
	let registry: Record<string, RegistryEntry> = {}
	try {
		registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
	} catch {
		return undefined
	}

	const parts: string[] = []
	for (const entry of Object.values(registry)) {
		// A skill is enabled unless explicitly set to false
		if (toggles[entry.id] === false) {
			continue
		}
		const sourceDir = sourceDirForRegistrySource(entry.source)
		if (
			!sourceDir ||
			typeof entry.localPath !== "string" ||
			!(await isInsideSkillsSource(sourceDir, entry.localPath, homeDir))
		) {
			console.warn(
				`[skills] skipping ${entry.id}: localPath is outside ~/.aihydro/skills/${sourceDir ?? "<unknown source>"}`,
			)
			continue
		}
		try {
			const bytes = await fs.readFile(entry.localPath)
			if (entry.sha256 && sha256Digest(bytes) !== entry.sha256) {
				console.warn(`[skills] skipping ${entry.id}: SKILL.md no longer matches its recorded ${entry.sha256}`)
				continue
			}
			if (entry.verified === false && !warnedUnverified.has(entry.id)) {
				warnedUnverified.add(entry.id)
				console.warn(`[skills] injecting ${entry.id} UNVERIFIED (installed without a catalog sha256)`)
			}
			const content = bytes.toString("utf-8").trim()
			if (content) {
				parts.push(`## Skill: ${entry.name}\n\n${content}`)
			}
		} catch {
			// file removed since install — skip silently
		}
	}

	if (parts.length === 0) {
		return undefined
	}
	return `# AI-Hydro Workflow Skills\n\nThe following workflow playbooks are active. Follow them when the relevant task arises.\n\n${parts.join("\n\n---\n\n")}`
}
