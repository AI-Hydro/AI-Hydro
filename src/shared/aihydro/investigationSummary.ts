/**
 * Pure presenter for the "science line" on history cards: which basin or gauge a task investigated and how many of
 * its claims are in each evidence state. It never infers a missing value: no record means "Investigation record not linked yet".
 */

export interface InvestigationRecord {
	/** Basin or gauge label from the investigation's BasinRef or study record. */
	label?: string
	/** Claim counts by the approval presentation the Evidence Board uses. */
	claims?: { approved: number; integrityOnly: number; notApproved: number }
}

export const NO_INVESTIGATION_RECORD = "Investigation record not linked yet"

export function describeInvestigation(record: InvestigationRecord | undefined | null): string {
	if (!record || (!record.label?.trim() && !record.claims)) {
		return NO_INVESTIGATION_RECORD
	}
	const parts: string[] = []
	if (record.label?.trim()) {
		parts.push(record.label.trim())
	}
	if (record.claims) {
		const { approved, integrityOnly, notApproved } = record.claims
		const total = approved + integrityOnly + notApproved
		if (total === 0) {
			parts.push("no claims yet")
		} else {
			const detail = [
				approved ? `${approved} approved` : "",
				integrityOnly ? `${integrityOnly} integrity only` : "",
				notApproved ? `${notApproved} not approved` : "",
			]
				.filter(Boolean)
				.join(", ")
			parts.push(`${total} claim${total === 1 ? "" : "s"}: ${detail}`)
		}
	}
	return parts.join(" · ")
}
