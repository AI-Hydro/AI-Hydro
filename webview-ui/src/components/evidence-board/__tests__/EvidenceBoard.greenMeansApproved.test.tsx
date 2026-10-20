import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LedgerContextProvider } from "@/context/LedgerContext"
import { APPROVED_TOKEN } from "../../../design/evidenceStates"
import { EvidenceBoard } from "../EvidenceBoard"

const getLedgerStateMock = vi.fn()

vi.mock("@/services/grpc-client", () => ({
	LedgerServiceClient: {
		getLedgerState: (...args: unknown[]) => getLedgerStateMock(...args),
		subscribeToClaimUpdates: () => () => {},
	},
}))
vi.mock("@/config/platform.config", () => ({ PLATFORM_CONFIG: { postMessage: () => {} } }))

/** Any rendering of the success token. Only a verified human approval may produce it. */
const GREEN = "testing-iconPassed"

const SPAN = { sourceType: "run", sourceId: "run.a", metricRef: "key_outputs.bfi", description: "" }
const DIGEST = "sha256:abc"
const GOOD_STAMP = {
	approvalState: "approved",
	approvalForRevisionDigest: DIGEST,
	approvalChannel: "ssh_sig_sk_system_trust",
	approvalTrustRoot: "system",
	approvalPolicy: "signed_required",
	approvalPrincipal: "reviewer",
}

function claim(overrides: Record<string, unknown> = {}) {
	return {
		claimId: "c1",
		sessionId: "scratch-session",
		statement: "A claim.",
		status: "supported",
		claimType: "empirical_result",
		confidence: "high",
		createdAt: "2026-10-01T15:00:00Z",
		updatedAt: "2026-10-01T15:30:00Z",
		evidenceSpans: [SPAN],
		limitations: [],
		revision: 2,
		revisionDigest: DIGEST,
		historyLen: 2,
		revisionError: "",
		driftState: "in_sync",
		driftReason: "",
		driftChangedFields: [],
		driftEvidenceChecked: true,
		approvalState: "none",
		approvalForRevisionDigest: "",
		approvalChannel: "",
		approvalTrustRoot: "",
		approvalPrincipal: "",
		approvalPolicy: "",
		approvalReason: "",
		approvalRecordedState: "",
		approvalLiveDigest: "",
		...overrides,
	}
}

async function renderBoard(claims: unknown[]) {
	getLedgerStateMock.mockResolvedValue({ sessionId: "scratch-session", claims, updatedAtMs: Date.now() })
	const view = render(
		<LedgerContextProvider>
			<EvidenceBoard />
		</LedgerContextProvider>,
	)
	await waitFor(() => expect(screen.getByText(`${claims.length} claims`)).toBeInTheDocument())
	return view
}

describe("Evidence Board: green means approved", () => {
	describe("scientific status axis is never green", () => {
		for (const status of ["proposed", "tested", "weakly_supported", "supported", "stale", "contradicted", "retracted"]) {
			it(`status ${status} with no approval renders no success token`, async () => {
				const { container } = await renderBoard([claim({ status })])
				expect(container.innerHTML).not.toContain(GREEN)
			})
		}

		it("labels agent-asserted support as such, in the 'Supported, not approved' lane (never 'Citable')", async () => {
			await renderBoard([claim({ status: "supported" })])
			expect(screen.getAllByText("Supported (agent-asserted)").length).toBeGreaterThan(0)
			expect(screen.getByText("Supported, not approved")).toBeInTheDocument()
			expect(screen.queryByText("Citable")).not.toBeInTheDocument()
		})

		it("shows the server's supported status unchanged and flags missing evidence instead of rewriting it", async () => {
			await renderBoard([claim({ status: "supported", evidenceSpans: [] })])
			expect(screen.getAllByText("Supported (agent-asserted)").length).toBeGreaterThan(0)
			expect(screen.queryByText("Weak support")).not.toBeInTheDocument()
			expect(screen.getByTestId("no-evidence-flag")).toBeInTheDocument()
			expect(screen.getByTestId("no-evidence-note").textContent).toContain("nothing here supports it")
		})

		it("does not flag a supported claim that cites evidence", async () => {
			await renderBoard([claim({ status: "supported" })])
			expect(screen.queryByTestId("no-evidence-flag")).not.toBeInTheDocument()
		})
	})

	describe("approval authority axis", () => {
		it("renders a verified human approval green, and only it", async () => {
			const { container } = await renderBoard([claim(GOOD_STAMP)])
			expect(screen.getByTestId("claim-approval")).toHaveAttribute("data-approved", "true")
			expect(container.innerHTML).toContain(GREEN)
			expect(APPROVED_TOKEN).toContain(GREEN)
		})

		it("renders an approved and promoted claim as 'Approved · promoted' in the approved tone", async () => {
			const { container } = await renderBoard([claim({ ...GOOD_STAMP, approvalState: "consumed" })])
			const chip = screen.getByTestId("claim-approval")
			expect(chip.textContent).toContain("Approved · promoted")
			expect(chip.textContent).not.toContain("already used")
			expect(chip).toHaveAttribute("data-approved", "true")
			expect(container.innerHTML).toContain(GREEN)
		})

		it("renders a promoted claim whose stamp is user-trust as integrity only, never green", async () => {
			const { container } = await renderBoard([
				claim({
					...GOOD_STAMP,
					approvalState: "consumed",
					approvalChannel: "ssh_sig_user_trust",
					approvalTrustRoot: "user_writable",
				}),
			])
			expect(screen.getByTestId("claim-approval").textContent).toContain("Accepted (integrity only)")
			expect(screen.getByTestId("claim-approval")).toHaveAttribute("data-approved", "false")
			expect(container.innerHTML).not.toContain(GREEN)
		})

		const NOT_APPROVED: Array<[string, Record<string, unknown>]> = [
			["no approval", { approvalState: "none" }],
			["unreported state", { approvalState: "" }],
			["unverifiable", { ...GOOD_STAMP, approvalState: "unverifiable" }],
			["stale evidence", { ...GOOD_STAMP, approvalState: "stale_evidence" }],
			["stale revision", { ...GOOD_STAMP, approvalState: "stale_revision" }],
			["evidence unchecked", { ...GOOD_STAMP, approvalState: "evidence_unchecked" }],
			["unknown state", { ...GOOD_STAMP, approvalState: "weird" }],
			["approved, empty channel", { ...GOOD_STAMP, approvalChannel: "" }],
			["approved, empty policy", { ...GOOD_STAMP, approvalPolicy: "" }],
			["approved, empty trust root", { ...GOOD_STAMP, approvalTrustRoot: "" }],
			["approved, empty approval digest", { ...GOOD_STAMP, approvalForRevisionDigest: "" }],
			["approved, empty claim digest", { ...GOOD_STAMP, revisionDigest: "" }],
			[
				"approved, user-trust channel",
				{ ...GOOD_STAMP, approvalChannel: "ssh_sig_user_trust", approvalTrustRoot: "user_writable" },
			],
			["approved, same-user CLI", { ...GOOD_STAMP, approvalChannel: "cli_same_user" }],
			["approved, opt-out policy", { ...GOOD_STAMP, approvalPolicy: "unsigned_opt_out" }],
			["approved, other revision", { ...GOOD_STAMP, approvalForRevisionDigest: "sha256:old" }],
			["promoted, empty channel", { ...GOOD_STAMP, approvalState: "consumed", approvalChannel: "" }],
			["promoted, empty policy", { ...GOOD_STAMP, approvalState: "consumed", approvalPolicy: "" }],
			["promoted, no stamp at all", { approvalState: "consumed" }],
		]
		for (const [name, fields] of NOT_APPROVED) {
			it(`${name}: not approved and no success token`, async () => {
				const { container } = await renderBoard([claim(fields)])
				expect(screen.getByTestId("claim-approval")).toHaveAttribute("data-approved", "false")
				expect(screen.getByTestId("approval-line")).toHaveAttribute("data-approved", "false")
				expect(container.innerHTML).not.toContain(GREEN)
			})
		}
	})

	describe("informational facts are neutral", () => {
		it("renders 'in sync' drift without the success token", async () => {
			const { container } = await renderBoard([claim({ driftState: "in_sync" })])
			expect(screen.getByTestId("drift-line").textContent).toContain("In sync")
			expect(container.innerHTML).not.toContain(GREEN)
		})

		it("renders '0 need review' without the success token", async () => {
			const { container } = await renderBoard([claim({ status: "supported" })])
			expect(screen.getByTestId("need-review-count").textContent).toContain("0 need review")
			expect(container.innerHTML).not.toContain(GREEN)
		})
	})

	describe("runs are not claims", () => {
		it("counts only the claims the server returns", async () => {
			await renderBoard([claim({ claimId: "c1" }), claim({ claimId: "c2" })])
			expect(screen.getByText("2 claims")).toBeInTheDocument()
			expect(screen.queryByText("evidence candidate")).not.toBeInTheDocument()
		})

		it("tells a reader that uncited runs live in Replay when there are no claims", async () => {
			getLedgerStateMock.mockResolvedValue({ sessionId: "scratch-session", claims: [], updatedAtMs: Date.now() })
			render(
				<LedgerContextProvider>
					<EvidenceBoard />
				</LedgerContextProvider>,
			)
			expect(await screen.findByText(/not claims; they are listed in Session Replay/)).toBeInTheDocument()
		})
	})

	describe("both panels use the shared tokens", () => {
		const root = resolve(__dirname, "../..")
		for (const file of ["evidence-board/EvidenceBoard.tsx", "replay-panel/ReplayPanel.tsx"]) {
			it(`${file} imports design/ and hard-codes no success token`, () => {
				const source = readFileSync(resolve(root, file), "utf8")
				expect(source).toMatch(/from "\.\.\/\.\.\/design\/(evidenceStates|approvalPresentation)"/)
				expect(source).not.toContain(GREEN)
			})
		}
	})
})
