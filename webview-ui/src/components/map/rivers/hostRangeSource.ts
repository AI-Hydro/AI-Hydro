/**
 * A pmtiles `Source` whose bytes come from the extension host.
 *
 * The host owns the file: it validated the archive, and the webview names it by id only (never a path). Each
 * `getBytes` is one request message and one reply message, matched by `requestId`. The reply carries an `ArrayBuffer`
 * (binary over the webview channel). Reads are cancellable: an aborted read rejects at once and a late reply is ignored.
 */

import { MERIT_MSG, type MeritRangeRequest } from "@shared/map/meritTileContract"
import type { RangeResponse, Source } from "pmtiles"
import { PLATFORM_CONFIG } from "../../../config/platform.config"
import { newUiRequestId } from "../resolveFileUri"
import { newRangeStats, type RangeStats } from "./pmtilesRivers"

/** The message channel to the host; injectable so tests run with no webview. */
export interface HostTransport {
	post(message: unknown): void
	/** Subscribes to messages from the host; returns the unsubscribe function. */
	listen(handler: (data: unknown) => void): () => void
}

export const windowHostTransport: HostTransport = {
	post: (message) => PLATFORM_CONFIG.postMessage(message as never),
	listen: (handler) => {
		const onMessage = (event: MessageEvent) => handler(event.data)
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	},
}

const isArrayBuffer = (value: unknown): value is ArrayBuffer => Object.prototype.toString.call(value) === "[object ArrayBuffer]"

export const HOST_RANGE_TIMEOUT_MS = 30_000

export class HostRangeSource implements Source {
	private etag: string | undefined
	constructor(
		private readonly archiveId: string,
		private readonly transport: HostTransport = windowHostTransport,
		readonly stats: RangeStats = newRangeStats(),
		private readonly timeoutMs = HOST_RANGE_TIMEOUT_MS,
	) {}

	getKey(): string {
		return `merit-host:${this.archiveId}`
	}

	getBytes(offset: number, length: number, signal?: AbortSignal): Promise<RangeResponse> {
		this.stats.requests += 1
		const requestId = newUiRequestId("tile")
		return new Promise<RangeResponse>((resolve, reject) => {
			let settled = false
			let unlisten = () => {}
			let timer: ReturnType<typeof setTimeout> | undefined
			const finish = (action: () => void) => {
				if (settled) return
				settled = true
				unlisten()
				if (timer) clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)
				action()
			}
			const fail = (message: string) =>
				finish(() => {
					this.stats.failures += 1
					reject(new Error(message))
				})
			const onAbort = () => finish(() => reject(new DOMException("aborted", "AbortError")))
			if (signal?.aborted) return onAbort()
			signal?.addEventListener("abort", onAbort)
			timer = setTimeout(() => fail("The MERIT tile request timed out."), this.timeoutMs)
			unlisten = this.transport.listen((message) => {
				const reply = message as {
					type?: unknown
					requestId?: unknown
					ok?: unknown
					data?: unknown
					etag?: unknown
					error?: unknown
				} | null
				if (!reply || reply.type !== MERIT_MSG.rangeResult || reply.requestId !== requestId) return
				if (reply.ok !== true) return fail(typeof reply.error === "string" ? reply.error : "The MERIT tile read failed.")
				if (!isArrayBuffer(reply.data)) return fail("The MERIT tile reply carried no binary data.")
				// A reply longer than the range asked for is never accepted (same guard as the HTTP source).
				if (reply.data.byteLength > length) return fail("The MERIT tile reply is longer than the range asked for.")
				const etag = typeof reply.etag === "string" ? reply.etag : undefined
				if (etag) {
					if (this.etag && this.etag !== etag)
						return fail("The MERIT archive changed while the map was open. Choose Retry to reload it.")
					this.etag = etag
				}
				const data = reply.data
				finish(() => {
					this.stats.bytes += data.byteLength
					resolve({ data, etag })
				})
			})
			const request: MeritRangeRequest = { type: MERIT_MSG.range, requestId, archiveId: this.archiveId, offset, length }
			this.transport.post(request)
		})
	}
}
