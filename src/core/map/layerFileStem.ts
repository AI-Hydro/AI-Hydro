import { createHash } from "crypto"

/**
 * A file name for a layer id. An id with only safe characters keeps its name. Any other character becomes `_` and a
 * short hash of the whole id is added, so `run:x` and `run_x` (which would both become `run_x`) are two files.
 */
export function layerFileStem(id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_")
	if (safe === id) return safe
	return `${safe}-${createHash("sha1").update(id).digest("hex").slice(0, 8)}`
}
