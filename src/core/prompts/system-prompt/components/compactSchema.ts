/**
 * Compact JSON-Schema rendering for the MCP tool listing.
 *
 * The listing carries the full input schema of every hot tool on every request, pretty-printed (about 42k of 85k
 * characters of the hot block on the first-party server). Two things in it carry no information for the model:
 *  - whitespace: indentation, one token-bearing line per brace and key;
 *  - pydantic/FastMCP boilerplate: a generated `title` on every property ("Session Id"), `default: null`, and
 *    `anyOf: [X, {type: "null"}]` wrapping every optional parameter (optionality is already the absence from
 *    `required`).
 *
 * Nothing that constrains a call is removed: `type`, `enum`, `const`, `required`, `format`, bounds, `description`,
 * non-null defaults and every property NAME survive. The transform is pure, schema-aware (it walks schema positions
 * only, so a property that happens to be called "title" or "default" is untouched, and enum/default/example VALUES are
 * never rewritten), and it never mutates its input. It cannot make a call invalid that was valid: it removes only the
 * explicit "or null" alternative, and a server that wants a null still receives what the model sends.
 */

const SCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"] as const
const SCHEMA_VALUES = [
	"items",
	"additionalProperties",
	"not",
	"if",
	"then",
	"else",
	"contains",
	"propertyNames",
	"unevaluatedItems",
] as const
const SCHEMA_ARRAYS = ["allOf", "prefixItems"] as const

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function isNullSchema(node: unknown): boolean {
	return (
		isObject(node) &&
		node.type === "null" &&
		Object.keys(node).every((k) => k === "type" || k === "title" || k === "description")
	)
}

function compactNode(node: unknown): unknown {
	if (!isObject(node)) {
		return node // true/false schemas and anything unexpected pass through
	}
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(node)) {
		if (key === "title" && typeof value === "string") {
			continue
		}
		if (key === "default" && value === null) {
			continue
		}
		if ((SCHEMA_MAPS as readonly string[]).includes(key) && isObject(value)) {
			out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, compactNode(child)]))
		} else if ((SCHEMA_VALUES as readonly string[]).includes(key)) {
			out[key] = compactNode(value)
		} else if ((SCHEMA_ARRAYS as readonly string[]).includes(key) && Array.isArray(value)) {
			out[key] = value.map(compactNode)
		} else if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
			const alternatives = value.map(compactNode)
			const nonNull = alternatives.filter((a) => !isNullSchema(a))
			if (nonNull.length === 1 && nonNull.length < alternatives.length && isObject(nonNull[0])) {
				// `X or null` is just X for an optional parameter: fold X into this node (this node's own keys win).
				for (const [k, v] of Object.entries(nonNull[0])) {
					if (!(k in out) && !(k in node)) {
						out[k] = v
					}
				}
			} else if (nonNull.length > 0 && nonNull.length < alternatives.length) {
				out[key] = nonNull
			} else {
				out[key] = alternatives
			}
		} else {
			out[key] = value
		}
	}
	return out
}

/** The schema with generated boilerplate removed. Pure; the input is not changed. */
export function compactSchema(schema: unknown): unknown {
	return compactNode(schema)
}

/** One line of JSON for the prompt. */
export function renderSchema(schema: unknown): string {
	return JSON.stringify(compactSchema(schema))
}
