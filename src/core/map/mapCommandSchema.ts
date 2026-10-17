import { z } from "zod"

/**
 * Validates JSON command files dropped by Python MCP tools into
 * ~/.aihydro/map_commands/ before MapCommandWatcher acts on them (audit
 * finding E-9). This channel is local-only and unauthenticated by design —
 * any process running as the current user can write here — so schema
 * validation is defence-in-depth against malformed payloads (wrong types,
 * prototype-pollution-shaped keys, oversized strings), not an auth boundary.
 */
/** Upper bounds for agent-pushed fields (local channel; limits are defence-in-depth, not auth). */
const MAX_ID_LENGTH = 256
const MAX_NAME_LENGTH = 512
const MAX_RUN_GEOJSON_LENGTH = 25_000_000
const MAX_FLY_TO_DURATION_MS = 60_000

/** ISO-8601 date (`2020-01-01`) or date-time with optional `Z` / numeric offset; nothing looser than that. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/
const isoTimestamp = z
	.string()
	.max(64)
	.refine((value) => ISO_8601.test(value) && !Number.isNaN(Date.parse(value)), {
		message: "must be an ISO-8601 date or date-time",
	})

const mapCommandObject = z.object({
	type: z.string().min(1),
	layer_id: z.string().max(MAX_ID_LENGTH).optional(),
	roi: z
		.object({
			id: z.string().optional(),
			name: z.string().optional(),
			source: z.string().optional(),
			geojson: z.string().optional(),
			area_ha: z.number().optional(),
			workspace_path: z.string().optional(),
		})
		.optional(),
	open_map: z.boolean().optional(),
	visible: z.boolean().optional(),
	display_name: z.string().optional(),
	clear_graduated: z.boolean().optional(),
	style: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	metadata: z.record(z.string(), z.string()).optional(),
	basemap_id: z.string().optional(),
	basemap_name: z.string().optional(),
	// fly_to
	longitude: z.number().min(-180).max(180).optional(),
	latitude: z.number().min(-90).max(90).optional(),
	zoom: z.number().min(0).max(24).optional(),
	duration_ms: z.number().min(0).max(MAX_FLY_TO_DURATION_MS).optional(),
	// add_layer_from_run
	layer_name: z.string().max(MAX_NAME_LENGTH).optional(),
	geojson: z.string().max(MAX_RUN_GEOJSON_LENGTH).optional(),
	run_id: z.string().max(MAX_ID_LENGTH).optional(),
	session_id: z.string().max(MAX_ID_LENGTH).optional(),
	auto_zoom: z.boolean().optional(),
	// set_time_range
	start_iso: isoTimestamp.optional(),
	end_iso: isoTimestamp.optional(),
})

export const mapCommandSchema = mapCommandObject.superRefine((cmd, ctx) => {
	if (cmd.start_iso && cmd.end_iso && Date.parse(cmd.end_iso) < Date.parse(cmd.start_iso)) {
		ctx.addIssue({ code: "custom", path: ["end_iso"], message: "end_iso must not precede start_iso" })
	}
})

export type MapCommandPayload = z.infer<typeof mapCommandSchema>
