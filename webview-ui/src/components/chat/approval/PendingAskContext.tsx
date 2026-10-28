import { describeAutoApproveRefusal, parseAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import type { ChatState, MessageHandlers } from "../chat-view/types/chatTypes"

/** Where a saved "Always" is undone. One sentence, shown after the grant is saved. */
export const ALWAYS_REVOKE_NOTE = "Revoke it any time in MCP settings."
export const ALWAYS_SAVED_NOT_SENT = "Always was saved, but the approval was not sent — press Run."

/** Result of "Always": approved, or why it was not (nothing is approved on a refusal). */
export type AlwaysResult = { ok: true } | { ok: false; message: string }

/** A line that outlives the card: the answered row folds into a work group and remounts at Focus and Normal. */
export interface GrantNote {
	ts: number
	text: string
}

export interface ClickOptions {
	/** Keyboard focus was inside the card's group when the user clicked. */
	focusWasInside?: boolean
}

export interface PendingAskApi {
	/** Answers the ask on the card with `askTs` (the card's own ts), sending the composer draft as feedback. */
	respond: (askTs: number, action: "approve" | "reject", options?: ClickOptions) => Promise<void>
	/**
	 * Saves a per-tool "always allow" grant, checks the host's reply shows it saved, and only then approves. A
	 * refusal, a failure or a reply that does not show the tool marked approves nothing.
	 */
	alwaysAllow: (args: { askTs: number; serverName: string; toolName: string } & ClickOptions) => Promise<AlwaysResult>
	/** Where a just-saved "Always" is revoked. Shown in the footer, which survives the card being folded away. */
	grantNote: GrantNote | undefined
	dismissGrantNote: () => void
	/** The ask ts currently being answered (a click is in flight), if any. */
	busyTs: number | undefined
	draftHasContent: boolean
	/** The stale notice ("That request changed"), when a response was just dropped. */
	askNotice: string | undefined
	/** Moves focus to the composer. */
	focusComposer: () => void
}

/** How long the revoke note stays when not dismissed. */
export const GRANT_NOTE_MS = 15_000
/** A remembered "focus was in the group" is dropped if no answer arrives in this time. */
const RESTORE_FOCUS_MS = 5_000

/**
 * Handlers for the inline approval cards. ChatRow is deepEqual-memoised, so a card must not get these as props: it
 * would never see a change, or re-render on every draft keystroke. The context value is memoised on what actually
 * changes (the busy ts, the notice, whether the draft has content); the callbacks are stable and read the latest
 * draft and handlers through refs.
 */
const PendingAskContext = createContext<PendingAskApi | undefined>(undefined)

export function usePendingAsk(): PendingAskApi | undefined {
	return useContext(PendingAskContext)
}

export function PendingAskProvider({
	chatState,
	messageHandlers,
	children,
}: {
	chatState: ChatState
	messageHandlers: MessageHandlers
	children: ReactNode
}) {
	const { setMcpServers, aihydroMessages } = useExtensionState()
	const { inputValue, selectedImages, selectedFiles, askNotice, textAreaRef } = chatState

	const latest = useRef({ inputValue, selectedImages, selectedFiles, messageHandlers })
	latest.current = { inputValue, selectedImages, selectedFiles, messageHandlers }

	// One double-submit guard for every inline click, keyed by the ask it answers: it clears itself when that ask is
	// no longer the pending one (a new ts is never equal), and when a response is dropped as stale.
	const [busyTs, setBusyTs] = useState<number | undefined>()
	const busyRef = useRef<number | undefined>(undefined)
	const begin = useCallback((askTs: number) => {
		if (busyRef.current === askTs) {
			return false
		}
		busyRef.current = askTs
		setBusyTs(askTs)
		return true
	}, [])
	const release = useCallback(() => {
		busyRef.current = undefined
		setBusyTs(undefined)
	}, [])
	useEffect(() => {
		if (askNotice) {
			release()
		}
	}, [askNotice, release])

	// Focus restore (E2.8). The answered row folds into a work group and remounts at Focus and Normal, so the card
	// cannot restore focus itself. The click records that focus was inside the group; on the next message change, if
	// focus has fallen to the page (the focused button was removed), it goes to the composer. Focus anywhere else is
	// left alone. Dropped on a stale notice or after a few seconds so it cannot steal focus later.
	const restoreFocus = useRef(false)
	const restoreTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const rememberFocus = useCallback((inside?: boolean) => {
		clearTimeout(restoreTimer.current)
		restoreFocus.current = inside === true
		if (inside) {
			restoreTimer.current = setTimeout(() => {
				restoreFocus.current = false
			}, RESTORE_FOCUS_MS)
		}
	}, [])
	const focusComposer = useCallback(() => {
		textAreaRef?.current?.focus()
	}, [textAreaRef])
	useEffect(() => {
		if (!restoreFocus.current) {
			return
		}
		restoreFocus.current = false
		clearTimeout(restoreTimer.current)
		const active = document.activeElement
		if (!active || active === document.body) {
			focusComposer()
		}
		// biome-ignore lint/correctness/useExhaustiveDependencies: runs on the next message change only
	}, [aihydroMessages])
	useEffect(() => {
		if (askNotice) {
			restoreFocus.current = false
		}
	}, [askNotice])

	const [grantNote, setGrantNote] = useState<GrantNote | undefined>()
	const grantTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const showGrantNote = useCallback((note: GrantNote) => {
		clearTimeout(grantTimer.current)
		setGrantNote(note)
		grantTimer.current = setTimeout(() => setGrantNote(undefined), GRANT_NOTE_MS)
	}, [])
	// A note belongs to the task it was made in: a new task must not open with an old "Always" line.
	const taskTs = aihydroMessages?.[0]?.ts
	// biome-ignore lint/correctness/useExhaustiveDependencies: clears when the task changes
	useEffect(() => {
		clearTimeout(grantTimer.current)
		setGrantNote(undefined)
	}, [taskTs])
	const dismissGrantNote = useCallback(() => {
		clearTimeout(grantTimer.current)
		setGrantNote(undefined)
	}, [])
	useEffect(
		() => () => {
			clearTimeout(grantTimer.current)
			clearTimeout(restoreTimer.current)
		},
		[],
	)

	const send = useCallback(async (askTs: number, action: "approve" | "reject") => {
		const { inputValue, selectedImages, selectedFiles, messageHandlers } = latest.current
		await messageHandlers.executeButtonAction(action, inputValue, selectedImages, selectedFiles, askTs)
	}, [])

	const respond = useCallback(
		async (askTs: number, action: "approve" | "reject", options?: ClickOptions) => {
			if (!begin(askTs)) {
				return
			}
			rememberFocus(options?.focusWasInside)
			try {
				await send(askTs, action)
			} catch (error) {
				release()
				rememberFocus(false)
				throw error
			}
		},
		[begin, release, send, rememberFocus],
	)

	const alwaysAllow = useCallback<PendingAskApi["alwaysAllow"]>(
		async ({ askTs, serverName, toolName, focusWasInside }) => {
			if (!begin(askTs)) {
				return { ok: false, message: "" }
			}
			try {
				const response = await McpServiceClient.toggleToolAutoApprove(
					ToggleToolAutoApproveRequest.create({ serverName, toolNames: [toolName], autoApprove: true }),
				)
				const servers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(servers)
				// Approve only what the host reports saved: the reply is the settings as they now are.
				const saved =
					servers.find((s) => s.name === serverName)?.tools?.find((t) => t.name === toolName)?.autoApprove === true
				if (!saved) {
					release()
					return {
						ok: false,
						message: "Not saved: the server did not mark this tool as always allowed. Nothing was approved.",
					}
				}
				// The card's own ts: if the agent moved on while the grant was being saved, the host drops this approval
				// as stale instead of letting it answer a different request.
				rememberFocus(focusWasInside)
				try {
					await send(askTs, "approve")
				} catch {
					// The grant is saved; only the approval did not go out. Say so, not "could not save".
					release()
					rememberFocus(false)
					return { ok: false, message: ALWAYS_SAVED_NOT_SENT }
				}
				showGrantNote({ ts: askTs, text: `Always allowed ${toolName}. ${ALWAYS_REVOKE_NOTE}` })
				return { ok: true }
			} catch (error) {
				release()
				const parsed = parseAutoApproveRefusal(error instanceof Error ? error.message : String(error))
				return {
					ok: false,
					message: parsed
						? describeAutoApproveRefusal(parsed)
						: "Could not save Always. Nothing was approved. Use Run to run it once.",
				}
			}
		},
		[begin, release, send, setMcpServers, rememberFocus, showGrantNote],
	)

	const draftHasContent = inputValue.trim().length > 0 || selectedImages.length > 0 || selectedFiles.length > 0
	const value = useMemo<PendingAskApi>(
		() => ({ respond, alwaysAllow, busyTs, draftHasContent, askNotice, focusComposer, grantNote, dismissGrantNote }),
		[respond, alwaysAllow, busyTs, draftHasContent, askNotice, focusComposer, grantNote, dismissGrantNote],
	)

	return <PendingAskContext.Provider value={value}>{children}</PendingAskContext.Provider>
}
