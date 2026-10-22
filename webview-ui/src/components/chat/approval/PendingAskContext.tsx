import { describeAutoApproveRefusal, parseAutoApproveRefusal } from "@shared/aihydro/alwaysAllowPolicy"
import { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import type { ChatState, MessageHandlers } from "../chat-view/types/chatTypes"

/** Result of "Always": approved, or why it was not (nothing is approved on a refusal). */
export type AlwaysResult = { ok: true } | { ok: false; message: string }

export interface PendingAskApi {
	/** Answers the ask on the card with `askTs` (the card's own ts), sending the composer draft as feedback. */
	respond: (askTs: number, action: "approve" | "reject") => Promise<void>
	/**
	 * Saves a per-tool "always allow" grant, checks the host's reply shows it saved, and only then approves. A
	 * refusal, a failure or a reply that does not show the tool marked approves nothing.
	 */
	alwaysAllow: (args: { askTs: number; serverName: string; toolName: string }) => Promise<AlwaysResult>
	/** The ask ts currently being answered (a click is in flight), if any. */
	busyTs: number | undefined
	draftHasContent: boolean
	/** The stale notice ("That request changed"), when a response was just dropped. */
	askNotice: string | undefined
	/** Moves focus to the composer (after an inline answer removes the focused group). */
	focusComposer: () => void
}

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
	const { setMcpServers } = useExtensionState()
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

	const send = useCallback(async (askTs: number, action: "approve" | "reject") => {
		const { inputValue, selectedImages, selectedFiles, messageHandlers } = latest.current
		await messageHandlers.executeButtonAction(action, inputValue, selectedImages, selectedFiles, askTs)
	}, [])

	const respond = useCallback(
		async (askTs: number, action: "approve" | "reject") => {
			if (!begin(askTs)) {
				return
			}
			try {
				await send(askTs, action)
			} catch (error) {
				release()
				throw error
			}
		},
		[begin, release, send],
	)

	const alwaysAllow = useCallback<PendingAskApi["alwaysAllow"]>(
		async ({ askTs, serverName, toolName }) => {
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
				await send(askTs, "approve")
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
		[begin, release, send, setMcpServers],
	)

	const focusComposer = useCallback(() => {
		textAreaRef?.current?.focus()
	}, [textAreaRef])

	const draftHasContent = inputValue.trim().length > 0 || selectedImages.length > 0 || selectedFiles.length > 0
	const value = useMemo<PendingAskApi>(
		() => ({ respond, alwaysAllow, busyTs, draftHasContent, askNotice, focusComposer }),
		[respond, alwaysAllow, busyTs, draftHasContent, askNotice, focusComposer],
	)

	return <PendingAskContext.Provider value={value}>{children}</PendingAskContext.Provider>
}
