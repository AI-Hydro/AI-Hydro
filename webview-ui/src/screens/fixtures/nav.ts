/**
 * Synthetic catalogue rows for the navigation-surface screens (MCP marketplace, Skills). Invented for layout review:
 * none of these servers or skills exists. Names carry the "Fixture" prefix so a screenshot cannot be mistaken for a
 * real listing.
 */
import type { McpMarketplaceItem } from "@shared/proto/cline/mcp"
import { type SkillItem, SkillSource } from "@shared/proto/cline/skills"

const STAMP = "2026-10-01T00:00:00Z"

export const fixtureMcpMarketplace: McpMarketplaceItem[] = [
	{
		mcpId: "fx-mcp-1",
		githubUrl: "https://example.invalid/fixture-gauge-server",
		name: "Fixture Gauge Server",
		author: "fixture-author",
		description: "A synthetic listing used to check card layout: serves invented gauge records.",
		codiconIcon: "server",
		logoUrl: "",
		category: "Data",
		tags: ["gauges", "fixture"],
		requiresApiKey: false,
		isRecommended: true,
		githubStars: 120,
		downloadCount: 3400,
		createdAt: STAMP,
		updatedAt: STAMP,
		lastGithubSync: STAMP,
		authorUrl: "",
		citation: "",
		citationUrl: "",
		aiHydroInstalls: 12,
		aiHydroStars: 4,
		starredByClient: false,
	},
	{
		mcpId: "fx-mcp-2",
		githubUrl: "https://example.invalid/fixture-raster-server",
		name: "Fixture Raster Server with a deliberately long listing name to test wrapping",
		author: "fixture-author",
		description: "A second synthetic listing that needs an API key.",
		codiconIcon: "server",
		logoUrl: "",
		category: "Imagery",
		tags: ["raster"],
		requiresApiKey: true,
		isRecommended: false,
		githubStars: 8,
		downloadCount: 90,
		createdAt: STAMP,
		updatedAt: STAMP,
		lastGithubSync: STAMP,
		authorUrl: "",
		citation: "",
		citationUrl: "",
		aiHydroInstalls: 1,
		aiHydroStars: 0,
		starredByClient: false,
	},
]

const skill = (skillId: string, name: string, isInstalled: boolean, source: SkillSource): SkillItem => ({
	skillId,
	name,
	description: "A synthetic skill used to check card layout.",
	version: "0.0.0",
	author: "fixture-author",
	domain: "Hydrology",
	category: "Analysis",
	codiconIcon: "beaker",
	tags: ["fixture"],
	toolsUsed: [],
	whenToUse: "Never: this is a fixture.",
	githubUrl: "",
	skillUrl: "",
	isRecommended: false,
	githubStars: 3,
	downloadCount: 10,
	isInstalled,
	createdAt: STAMP,
	updatedAt: STAMP,
	source,
	authorUrl: "",
	citation: "",
	citationUrl: "",
	aiHydroInstalls: 0,
	aiHydroStars: 0,
	starredByClient: false,
})

export const fixtureInstalledSkills: SkillItem[] = [
	skill("fx-skill-1", "Fixture Flow Duration Review", true, SkillSource.MARKETPLACE),
	skill("fx-skill-2", "Fixture Baseflow Check", true, SkillSource.MANUAL),
]

export const fixtureMarketplaceSkills: SkillItem[] = [
	skill("fx-skill-1", "Fixture Flow Duration Review", true, SkillSource.MARKETPLACE),
	skill("fx-skill-3", "Fixture Rating Curve Walkthrough", false, SkillSource.MARKETPLACE),
]
