/**
 * Honest provenance labels for catalogue entries. The catalogue index carries
 * no signature or content hash, so every entry is an unsigned catalogue item,
 * and a licence is shown only when the entry declared one.
 */
export const UNSIGNED_CATALOGUE_LABEL = "Unsigned catalogue module"
export const UNSIGNED_CATALOGUE_COURSE_LABEL = "Unsigned catalogue course"
export const LICENSE_NOT_DECLARED_LABEL = "License not declared"

export function licenseLabel(license?: string | null): string {
	const v = String(license ?? "").trim()
	return v ? v : LICENSE_NOT_DECLARED_LABEL
}

/** One combined provenance line: license plus integrity/signing state. */
export function provenanceLine(license?: string | null, kind: "module" | "course" = "module"): string {
	return `${licenseLabel(license)} · ${kind === "course" ? UNSIGNED_CATALOGUE_COURSE_LABEL : UNSIGNED_CATALOGUE_LABEL}`
}
