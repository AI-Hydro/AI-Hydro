import type { MapLayer } from "@shared/proto/cline/map"
import type { PathKind } from "./resolveFileUri"

export interface DrawSource {
	path: string
	/** What the path is, so the host looks only where that kind of path can be. */
	kind: PathKind
	workspaceFolder?: string
}

/**
 * Where a layer with no geometry in hand is drawn from, best first.
 *
 * A layer that names a file is that file: the cache holds a copy under the same name that can be older, so it is only a
 * fallback. A tool's layer is the other way round: the cache holds what the run produced, and the file (if any) may have
 * been overwritten since. A simplified preview (`display_geojson_path`) was made from whichever of them applied, and is
 * drawn first when there is one.
 */
export function drawSources(layer: MapLayer): DrawSource[] {
	const meta = layer.metadata ?? {}
	const out: DrawSource[] = []
	const cache = (path: string | undefined) => path && out.push({ path, kind: "cache" })
	const project = () => {
		const path = meta.source_path || meta.workspace_path || meta.path
		if (path)
			out.push({ path, kind: "project", ...(meta.workspace_folder ? { workspaceFolder: meta.workspace_folder } : {}) })
	}
	cache(meta.display_geojson_path)
	if (meta.tool || meta._run_id) {
		cache(meta.geojson_cache_path)
		project()
	} else {
		project()
		cache(meta.geojson_cache_path)
	}
	return out
}
