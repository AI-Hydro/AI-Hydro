import { TITLE_MAX } from "@shared/chatTitle"
import { RenameChatRequest } from "@shared/proto/cline/task"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/design"
import { TaskServiceClient } from "@/services/grpc-client"

/** What the host said when it refused a name, in words for the person typing. */
const REFUSALS: Record<string, string> = {
	too_long: `Use ${TITLE_MAX} characters or fewer.`,
	newline: "Use a single line.",
	markup: "Use plain words, without markup.",
	id: "A name cannot be only an id.",
	empty: "Type a name, or reset to automatic.",
	not_found: "This chat no longer exists.",
}

export interface RenameFieldProps {
	taskId: string
	/** The name shown now. */
	initial: string
	/** The chat has a name the user set; offers "Reset to automatic". */
	locked: boolean
	/** Called once the host accepted the change, or the user cancelled (`saved` false). */
	onDone: (saved: boolean) => void
}

/**
 * Inline rename (PSMH §4.1). Enter saves, Esc cancels. A name the host refuses stays in the field with the reason
 * under it. Saving locks the name; "Reset to automatic" clears the lock.
 */
export function RenameField({ taskId, initial, locked, onDone }: RenameFieldProps) {
	const [value, setValue] = useState(initial)
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const input = useRef<HTMLInputElement>(null)

	useEffect(() => {
		input.current?.focus()
		input.current?.select()
	}, [])

	const send = async (title: string) => {
		if (busy) {
			return
		}
		setBusy(true)
		setError(undefined)
		try {
			const result = await TaskServiceClient.renameChat(RenameChatRequest.create({ taskId, title }))
			if (result.ok) {
				onDone(true)
				return
			}
			setError(REFUSALS[result.detail] ?? REFUSALS[result.reason] ?? "That name was not accepted.")
		} catch (e) {
			console.error("Error renaming chat:", e)
			setError("The name could not be saved.")
		} finally {
			setBusy(false)
		}
	}

	const errorId = `history-rename-error-${taskId}`
	return (
		<form
			className="history-rename"
			onSubmit={(e) => {
				e.preventDefault()
				void send(value)
			}}>
			<input
				aria-describedby={error ? errorId : undefined}
				aria-invalid={error ? true : undefined}
				aria-label="Chat name"
				className="history-rename__input ph-no-capture"
				maxLength={TITLE_MAX}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault()
						e.stopPropagation()
						onDone(false)
					}
				}}
				ref={input}
				value={value}
			/>
			<div className="history-rename__actions">
				<Button disabled={busy || value.trim() === ""} type="submit" variant="primary">
					Save
				</Button>
				<Button disabled={busy} onClick={() => onDone(false)} variant="ghost">
					Cancel
				</Button>
				{locked && (
					<Button disabled={busy} onClick={() => void send("")} variant="ghost">
						Reset to automatic
					</Button>
				)}
			</div>
			{error && (
				<p className="history-rename__error" id={errorId} role="alert">
					{error}
				</p>
			)}
		</form>
	)
}
