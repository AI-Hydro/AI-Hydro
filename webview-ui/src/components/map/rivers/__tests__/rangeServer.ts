/** A fake `fetch` over an in-memory file that answers Range requests, with knobs for the failure cases. */
export function rangeFetch(
	file: Uint8Array,
	options: { honourRange?: boolean; status?: number; etag?: string | (() => string); offline?: boolean } = {},
) {
	const calls: { range: string | null }[] = []
	const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
		// Read the plain header object directly: jsdom's Headers treats Range as a forbidden name and drops it.
		const range = (init?.headers as Record<string, string> | undefined)?.Range ?? null
		calls.push({ range })
		if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
		if (options.offline) throw new TypeError("Failed to fetch")
		if (options.status && options.status !== 206 && options.status !== 200)
			return new Response("nope", { status: options.status })
		const etag = typeof options.etag === "function" ? options.etag() : options.etag
		const extra: Record<string, string> = etag ? { etag } : {}
		if (options.honourRange === false || !range) {
			return new Response(file as unknown as BodyInit, {
				status: 200,
				headers: { "content-length": String(file.length), ...extra },
			})
		}
		const m = /bytes=(\d+)-(\d+)/.exec(range) as RegExpExecArray
		const start = Number(m[1])
		const end = Math.min(file.length - 1, Number(m[2]))
		return new Response(file.slice(start, end + 1) as unknown as BodyInit, {
			status: 206,
			headers: { "content-range": `bytes ${start}-${end}/${file.length}`, ...extra },
		})
	}
	return { fetchImpl, calls }
}
