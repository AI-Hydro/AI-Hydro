/** One cached zoom per layer, invalidated by the exact source payload. */
export class LayerClusterCache {
	private entries = new Map<string, { source: string; zoom: number; value: unknown }>()
	get<T>(id: string, source: string, zoom: number, build: () => T): T {
		const level = Math.floor(zoom)
		const cached = this.entries.get(id)
		if (cached?.source === source && cached.zoom === level) return cached.value as T
		const value = build()
		this.entries.set(id, { source, zoom: level, value })
		return value
	}
	retain(ids: Set<string>): void {
		for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id)
	}
}

/** Display aggregation only: preserve unclustered features and never attribute one station's measurements to a cluster. */
export function clusterGeoJSON(geojson: any, zoom: number): any {
	if (zoom >= 8) return geojson
	const gridSize = Math.max(0.08, Math.min(1.5, 2 ** (4 - Math.floor(zoom))))
	const features =
		geojson?.type === "FeatureCollection"
			? geojson.features
			: geojson?.type === "Feature"
				? [geojson]
				: [{ type: "Feature", geometry: geojson, properties: {} }]
	const retained: any[] = []
	const cells = new Map<string, any[]>()
	const add = (feature: any): void => {
		const coord = feature?.geometry?.coordinates
		if (
			feature?.geometry?.type !== "Point" ||
			!Array.isArray(coord) ||
			!Number.isFinite(coord[0]) ||
			!Number.isFinite(coord[1])
		) {
			retained.push(feature)
			return
		}
		const key = `${Math.floor(coord[0] / gridSize)},${Math.floor(coord[1] / gridSize)}`
		const cell = cells.get(key) ?? []
		cell.push(feature)
		cells.set(key, cell)
	}
	for (const feature of features) {
		if (feature?.geometry?.type === "MultiPoint") {
			feature.geometry.coordinates.forEach((coordinates: number[]) =>
				add({ ...feature, geometry: { type: "Point", coordinates } }),
			)
		} else add(feature)
	}
	for (const members of cells.values()) {
		if (members.length === 1) {
			retained.push(members[0])
			continue
		}
		const coordinates = [0, 1].map(
			(axis) => members.reduce((sum, member) => sum + member.geometry.coordinates[axis], 0) / members.length,
		)
		retained.push({
			type: "Feature",
			geometry: { type: "Point", coordinates },
			properties: {
				_clustered: true,
				_clusterCount: members.length,
				_clusterAggregation: "display-only",
				_clusterMemberIds: members.map((member) => member.id).filter((id) => id !== undefined),
			},
		})
	}
	return { type: "FeatureCollection", features: retained }
}
