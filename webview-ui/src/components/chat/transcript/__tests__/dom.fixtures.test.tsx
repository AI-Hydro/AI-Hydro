import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
	buildTranscriptView,
	filterVisibleMessages,
	groupMessages,
	processMessages,
} from "@/components/chat/chat-view/utils/messageUtils"
import { makeTranscriptResolvers } from "@/components/chat/transcript/resolvers"
import { TranscriptItemRenderer } from "@/components/chat/transcript/TranscriptItemRenderer"
import { fixtureMcpServers } from "@/screens/fixtures/aihydro"
import * as F from "@/screens/fixtures/transcripts"

vi.mock("@/components/chat/ChatRow", async () => {
	const { AnswerAuditSummary } = await import("@/components/chat/AnswerAuditSummary")
	return {
		default: (p: any) =>
			p.message.say === "answer_audit" ? (
				<AnswerAuditSummary partial={p.message.partial} text={p.message.text} />
			) : (
				<div data-row={p.message.say ?? p.message.ask}>{p.message.text}</div>
			),
	}
})
vi.mock("@/components/chat/BrowserSessionRow", () => ({ default: () => <div /> }))
vi.mock("@/services/grpc-client", () => ({ CheckpointsServiceClient: {} }))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ onRelinquishControl: () => () => {} }) }))

const ctx = (msgs: any[]) => ({
	allMessages: msgs,
	modifiedMessages: msgs,
	expandedRows: {},
	onToggleExpand() {},
	onHeightChange() {},
	onSetQuote() {},
	inputValue: "",
	messageHandlers: {} as any,
	groupExpanded: {},
	onToggleGroup() {},
	running: false,
})

/** Every transcript fixture, rendered at Normal and Focus: lifted lines are in the DOM and visible, drafts are not. */
describe("transcript fixtures render their lifted lines and hide pending drafts", () => {
	for (const [name, task] of Object.entries(F)) {
		if (!Array.isArray(task)) continue
		for (const detail of ["normal", "focus"] as const) {
			it(`${name} at ${detail}`, () => {
				const msgs = processMessages((task as any[]).slice(1))
				const view = buildTranscriptView(msgs, groupMessages(filterVisibleMessages(msgs)), {
					detail,
					...makeTranscriptResolvers(fixtureMcpServers, ["/home/u/.aihydro/approvals"]),
				})
				const { container } = render(
					<div>
						{view.entries.map((e, i) =>
							e.mode === "presented" ? (
								<TranscriptItemRenderer
									auditMessage={e.auditMessage}
									count={view.entries.length}
									ctx={ctx(msgs) as any}
									index={i}
									item={e.item}
									key={e.key}
								/>
							) : null,
						)}
					</div>,
				)
				// every lifted line in DOM and visible
				for (const e of view.entries)
					if (e.mode === "presented" && e.item.kind === "group")
						for (const l of e.item.lifted) {
							const li = container.querySelector(`li[data-reason="${l.reason}"]`)
							expect(li, `${name}/${detail} lifted ${l.reason}`).not.toBeNull()
							expect(li!.closest("[hidden]")).toBeNull()
							expect(container.textContent).toContain(l.text.slice(0, 40))
						}
				// raw failure texts are in the DOM (the reviewer's check): errors, edit failures and notices
				const misses: string[] = []
				for (const m of msgs) {
					const k = m.say
					if (
						(k === "error" ||
							k === "diff_error" ||
							k === "error_retry" ||
							k === "info" ||
							k === "mcp_notification") &&
						m.text &&
						!container.textContent?.includes(m.text.slice(0, 25))
					) {
						misses.push(`${k}: ${m.text.slice(0, 60)}`)
					}
				}
				expect(misses, `${name}/${detail} raw texts missing from the DOM`).toEqual([])
				// a pending audit row's draft never reaches the DOM
				expect(container.textContent, `${name}/${detail} leaks a pending draft`).not.toMatch(/UNCHECKED DRAFT/)
			})
		}
	}
})
