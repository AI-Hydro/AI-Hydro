/**
 * List of email domains that are considered trusted testers for AI-Hydro.
 */
const AIHYDRO_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

export function isAiHydroInternalTester(email: string): boolean {
	return AIHYDRO_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
