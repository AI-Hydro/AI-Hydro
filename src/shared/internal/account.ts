/**
 * List of email domains that are considered trusted testers for AI-Hydro.
 */
const AIHYDRO_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a AI-Hydro bot user.
 * E.g. Emails ending with @cline.bot
 */
export function isAiHydroBotUser(email: string): boolean {
	return email.endsWith("@cline.bot")
}

export function isAiHydroInternalTester(email: string): boolean {
	return isAiHydroBotUser(email) || AIHYDRO_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
