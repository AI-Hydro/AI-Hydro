import plotlyUrl from "plotly.js-dist-min/plotly.min.js?url"
import threeUrl from "three/build/three.min.js?url"
import threeOrbitUrl from "three/examples/js/controls/OrbitControls.js?url"
import manifest from "./vendorManifest.json"

/**
 * Chart libraries shipped inside the extension for documents that cannot reach a CDN (installed
 * Learning Packs run under `script-src 'unsafe-inline'` and `connect-src 'none'`).
 *
 * The preview document asks for a library by id; this host reads the bundled file, checks its SHA-256
 * against `vendorManifest.json` (pinned from the npm package, byte-identical to the CDN release the
 * helpers used before), and returns the source for the document to run inline. A document can only name
 * an id from this list, never a URL, and a file whose digest differs from the manifest is never sent.
 */
export type VendorLibraryId = keyof typeof manifest

const VENDOR_URLS: Record<VendorLibraryId, string> = {
	plotly: plotlyUrl,
	three: threeUrl,
	"three-orbit": threeOrbitUrl,
}

export function isVendorLibraryId(value: unknown): value is VendorLibraryId {
	return typeof value === "string" && Object.hasOwn(VENDOR_URLS, value)
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes)
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const verified = new Map<VendorLibraryId, Promise<string>>()

export function loadVendorLibrarySource(
	id: VendorLibraryId,
	fetchBytes: (url: string) => Promise<ArrayBuffer> = async (url) => {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`vendor library ${id} is not readable (${response.status})`)
		return response.arrayBuffer()
	},
): Promise<string> {
	const cached = verified.get(id)
	if (cached) return cached
	const load = (async () => {
		const bytes = await fetchBytes(VENDOR_URLS[id])
		const actual = await sha256Hex(bytes)
		if (actual !== manifest[id].sha256) {
			throw new Error(`vendor library ${id} failed its integrity check`)
		}
		return new TextDecoder().decode(bytes)
	})()
	// A failure must not be remembered: a later request may succeed.
	load.catch(() => verified.delete(id))
	verified.set(id, load)
	return load
}

/** Test seam: forget verified sources. */
export function resetVendorLibraryCache(): void {
	verified.clear()
}
