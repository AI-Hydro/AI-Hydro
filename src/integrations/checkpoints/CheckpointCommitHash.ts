const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/

/**
 * Normalize and validate a checkpoint commit hash before it is passed to git.
 *
 * Strips the legacy "HEAD " prefix that old tasks stored, then requires a
 * hex object name (7-40 chars). Anything else - in particular a value with a
 * leading "-" that git would parse as an option - is rejected.
 */
export function cleanCommitHash(hash: string): string {
	const cleaned = hash.startsWith("HEAD ") ? hash.slice(5) : hash
	if (!COMMIT_HASH_PATTERN.test(cleaned)) {
		throw new Error(`Invalid checkpoint commit hash: expected 7-40 lowercase hex characters, got ${JSON.stringify(hash)}`)
	}
	return cleaned
}
