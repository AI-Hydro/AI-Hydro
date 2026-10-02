interface E2EEnvironment {
	[key: string]: string | undefined
	AIHYDRO_ENVIRONMENT?: string
	E2E_TEST?: string
}

/**
 * Returns true only for the isolated Playwright extension host.
 *
 * `evals.env` can enable other test services, so it must never be sufficient
 * for local-provider injection or remote-network suppression.
 */
export function isIsolatedLocalE2E(environment: E2EEnvironment = process.env): boolean {
	return environment.E2E_TEST === "true" && environment.AIHYDRO_ENVIRONMENT === "local"
}

export function shouldInitializeRemoteCatalogs(environment: E2EEnvironment = process.env): boolean {
	return !isIsolatedLocalE2E(environment)
}
