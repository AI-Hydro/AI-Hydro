import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ClaimChip } from "../ClaimChip"

const claims: Record<string, Record<string, unknown>> = {}

vi.mock("../../../context/LedgerContext", () => ({
	useLedgerContext: () => ({ getClaim: (id: string) => claims[id] }),
}))

const base = {
	statement: "Baseflow index exceeds 0.5",
	confidence: "medium",
	evidenceSpans: [],
	limitations: [],
	revisionDigest: "sha256:abc",
}

describe("ClaimChip", () => {
	it("renders the stale status label", () => {
		claims["c-stale"] = { ...base, claimId: "c-stale", status: "stale" }
		render(<ClaimChip claimId="c-stale" />)
		expect(screen.getByText("· stale")).toBeTruthy()
	})

	it("does not look approved for a supported claim with no approval", () => {
		claims["c-sup"] = { ...base, claimId: "c-sup", status: "supported" }
		const { container } = render(<ClaimChip claimId="c-sup" />)
		const button = container.querySelector("button")
		expect(button?.getAttribute("data-approved")).toBe("false")
		expect(button?.className).not.toContain("testing-iconPassed")
	})

	it("does not look approved for same-user (integrity-only) approvals", () => {
		claims["c-int"] = {
			...base,
			claimId: "c-int",
			status: "supported",
			approvalState: "approved",
			approvalChannel: "cli_same_user",
			approvalTrustRoot: "user_writable",
			approvalForRevisionDigest: "sha256:abc",
		}
		const { container } = render(<ClaimChip claimId="c-int" />)
		expect(container.querySelector("button")?.getAttribute("data-approved")).toBe("false")
	})

	it("does not look approved when the approval is for a different revision", () => {
		claims["c-rev"] = {
			...base,
			claimId: "c-rev",
			status: "supported",
			approvalState: "approved",
			approvalChannel: "ssh_sig_sk_system_trust",
			approvalTrustRoot: "system",
			approvalPolicy: "signed_required",
			approvalForRevisionDigest: "sha256:old",
		}
		const { container } = render(<ClaimChip claimId="c-rev" />)
		expect(container.querySelector("button")?.getAttribute("data-approved")).toBe("false")
	})

	it("looks approved only for an explicit verified approval of the current revision", () => {
		claims["c-ok"] = {
			...base,
			claimId: "c-ok",
			status: "supported",
			approvalState: "approved",
			approvalChannel: "ssh_sig_sk_system_trust",
			approvalTrustRoot: "system",
			approvalPolicy: "signed_required",
			approvalForRevisionDigest: "sha256:abc",
		}
		const { container } = render(<ClaimChip claimId="c-ok" />)
		expect(container.querySelector("button")?.getAttribute("data-approved")).toBe("true")
	})

	it("never looks approved for a contradicted claim, even with a verified approval of the current revision", () => {
		claims["c-contra"] = {
			...base,
			claimId: "c-contra",
			status: "contradicted",
			approvalState: "approved",
			approvalChannel: "ssh_sig_sk_system_trust",
			approvalTrustRoot: "system",
			approvalPolicy: "signed_required",
			approvalForRevisionDigest: "sha256:abc",
		}
		const { container } = render(<ClaimChip claimId="c-contra" />)
		expect(container.querySelector("button")?.getAttribute("data-approved")).toBe("false")
	})

	it("does not look approved when the verified stamp is missing its policy or channel (fail closed)", () => {
		const stamp: Record<string, unknown> = {
			approvalChannel: "ssh_sig_sk_system_trust",
			approvalTrustRoot: "system",
			approvalPolicy: "signed_required",
			approvalForRevisionDigest: "sha256:abc",
		}
		for (const [id, field] of [
			["c-nopolicy", "approvalPolicy"],
			["c-nochannel", "approvalChannel"],
			["c-nodigest", "approvalForRevisionDigest"],
		] as const) {
			claims[id] = { ...base, claimId: id, status: "supported", approvalState: "approved", ...stamp, ...{ [field]: "" } }
			const { container, unmount } = render(<ClaimChip claimId={id} />)
			expect(container.querySelector("button")?.getAttribute("data-approved"), id).toBe("false")
			unmount()
		}
	})
})
