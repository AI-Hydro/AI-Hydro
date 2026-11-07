import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { fileVersionOf } from "../layerDrawPath"

const L = (metadata: Record<string, string>) => ({ id: "a", metadata }) as unknown as MapLayer

describe("fileVersionOf: which version of its file a layer holds", () => {
	const base = {
		source_size_bytes: "10",
		source_mtime_ms: "5",
		source_sha256: "aa",
		source_updated_at_utc: "t1",
		display_geojson_path: "/p1",
	}

	it("is the same for the same version", () => {
		expect(fileVersionOf(L(base))).toBe(fileVersionOf(L({ ...base })))
	})

	it("changes with the size, the time, the hash, the update and the preview, so no parse of an older version is kept", () => {
		for (const [key, value] of Object.entries({
			source_size_bytes: "11",
			source_mtime_ms: "6",
			source_sha256: "bb",
			source_updated_at_utc: "t2",
			display_geojson_path: "",
		})) {
			expect(fileVersionOf(L({ ...base, [key]: value })), key).not.toBe(fileVersionOf(L(base)))
		}
	})
})
