/** Copy this map's current pixels before yielding to dialogs or asynchronous export. */
export function freezeMapCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
	if (source.width < 1 || source.height < 1) throw new Error("Map canvas has no rendered pixels")
	const capture = document.createElement("canvas")
	capture.width = source.width
	capture.height = source.height
	const context = capture.getContext("2d")
	if (!context) throw new Error("Map capture context is unavailable")
	context.drawImage(source, 0, 0)
	return capture
}

const EXPORT_METADATA = new Set([
	"legend",
	"graduated_attr",
	"graduated_breaks",
	"graduated_colors",
	"symbology_user_override",
	"raster_colormap",
	"min",
	"max",
	"units",
	"crs",
	"band",
	"nodata",
	"source_dataset_id",
	"product_identity",
	"dataset",
	"gee_dataset_id",
	"citation",
	"dataset_citation",
	"license",
	"source_status",
	"source_path",
	"source_uri",
	"provenance_path",
	"_run_id",
	"run_id",
	"validation_status",
	"uncertainty",
	"coverage_status",
	"raster_bounds",
	"gee_bounds",
	"source_loaded_at_utc",
])

export function exportLayerMetadata(metadata: Record<string, string> = {}): Record<string, string> {
	return Object.fromEntries(Object.entries(metadata).filter(([key]) => EXPORT_METADATA.has(key)))
}
