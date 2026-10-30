/**
 * Deterministic partition of the screen registry across CI shards, and the coverage proof that every screen
 * landed in exactly one shard. Pure functions (no browser) so they can be self-tested.
 */

/** Parse "i/n" (1-based). Throws on anything else so a typo cannot silently run the wrong subset. */
export function parseShard(spec) {
	const m = /^(\d+)\/(\d+)$/.exec(String(spec).trim())
	if (!m) throw new Error(`--shard expects i/n (for example 2/4), got "${spec}"`)
	const index = Number(m[1])
	const count = Number(m[2])
	if (count < 1 || index < 1 || index > count) throw new Error(`--shard ${spec}: need 1 <= i <= n`)
	return { index, count }
}

/**
 * Screens for shard i of n: sort by id, take every n-th starting at i-1. Sorting makes the split independent of
 * registry order; striding spreads neighbouring (usually similarly heavy) screens over different shards.
 * Every screen has the same cell count in a given matrix, so balancing by screen count balances cells.
 */
export function shardScreens(screens, { index, count }) {
	return [...screens].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((_, i) => i % count === index - 1)
}

/**
 * Prove full coverage. `registry` is the list of registered screen ids; `reports` are the per-shard JSON files
 * ({ shard, of, screens: [ids], registry: [ids] }). Returns a list of problems; empty means every screen was
 * covered by exactly one shard and all n shards reported against the same registry.
 */
export function coverageProblems(registry, reports) {
	const problems = []
	const expected = new Set(registry)
	if (expected.size !== registry.length) problems.push("registry lists a screen id more than once")
	if (registry.length === 0) problems.push("registry is empty")
	const counts = new Set(reports.map((r) => r.of))
	if (counts.size !== 1) {
		problems.push(`shards disagree on the shard count: ${[...counts].join(", ") || "no reports"}`)
		return problems
	}
	const of = reports[0].of
	const seenShards = new Map()
	for (const r of reports) seenShards.set(r.shard, (seenShards.get(r.shard) ?? 0) + 1)
	for (let i = 1; i <= of; i++) {
		if (!seenShards.has(i)) problems.push(`shard ${i}/${of} produced no coverage report`)
		else if (seenShards.get(i) > 1) problems.push(`shard ${i}/${of} reported ${seenShards.get(i)} times`)
	}
	const owner = new Map()
	for (const r of reports) {
		if (JSON.stringify([...r.registry].sort()) !== JSON.stringify([...registry].sort()))
			problems.push(`shard ${r.shard}/${of} saw a different registry than the registry listing`)
		if (r.screens.length === 0) problems.push(`shard ${r.shard}/${of} covered no screens`)
		for (const id of r.screens) {
			if (!expected.has(id)) problems.push(`shard ${r.shard}/${of} covered unregistered screen ${id}`)
			if (owner.has(id)) problems.push(`screen ${id} covered by shards ${owner.get(id)} and ${r.shard}`)
			else owner.set(id, r.shard)
		}
	}
	for (const id of registry) if (!owner.has(id)) problems.push(`screen ${id} was covered by no shard`)
	return problems
}
