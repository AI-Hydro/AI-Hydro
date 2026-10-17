/** Catalog-supplied links are untrusted: only http(s) targets may become anchors. */
export function httpUrlOrEmpty(value?: string | null): string {
	const v = String(value ?? "").trim()
	return /^https?:\/\//i.test(v) ? v : ""
}
