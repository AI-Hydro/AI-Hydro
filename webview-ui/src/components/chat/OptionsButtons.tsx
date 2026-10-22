import { useState } from "react"
import styled from "styled-components"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import { STALE_ASK_NOTICE, sendBoundAskResponse } from "./chat-view/askBinding"

const OptionButton = styled.button<{ isSelected?: boolean; isNotSelectable?: boolean }>`
	padding: 8px 12px;
	background: ${(props) => (props.isSelected ? "var(--vscode-focusBorder)" : CODE_BLOCK_BG_COLOR)};
	color: ${(props) => (props.isSelected ? "white" : "var(--vscode-input-foreground)")};
	border: 1px solid var(--vscode-editorGroup-border);
	border-radius: 2px;
	cursor: ${(props) => (props.isNotSelectable ? "default" : "pointer")};
	text-align: left;
	font-size: 12px;

	${(props) =>
		!props.isNotSelectable &&
		`
		&:hover {
			background: var(--vscode-focusBorder);
			color: white;
		}
	`}
`

const FreeTextArea = styled.textarea`
	width: 100%;
	box-sizing: border-box;
	padding: 8px 12px;
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid var(--vscode-focusBorder);
	border-radius: 2px;
	font-size: 12px;
	font-family: var(--vscode-font-family);
	resize: vertical;
	min-height: 48px;
`

export const OptionsButtons = ({
	options,
	selected,
	isActive,
	inputValue,
	askTs,
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
	/** ts of the ask message these options belong to; the response is dropped if that ask is no longer pending. */
	askTs: number
}) => {
	// Inline free-text answer (mirrors Claude Code's "Other"): clicking the
	// escape-hatch reveals an editable field right here, so the user can always
	// type a custom answer without relying on the (possibly disabled / easily
	// missed) main chat box at the bottom.
	const [freeTextMode, setFreeTextMode] = useState(false)
	const [freeText, setFreeText] = useState("")
	const [staleNotice, setStaleNotice] = useState(false)

	if (!options?.length) {
		return null
	}

	const hasSelected = selected !== undefined && options.includes(selected)
	const showEscapeHatch = !hasSelected && isActive

	const sendText = async (text: string) => {
		const trimmed = text.trim()
		if (!trimmed) {
			return
		}
		try {
			setStaleNotice(await sendBoundAskResponse({ responseType: "messageResponse", text: trimmed, images: [] }, askTs))
		} catch (error) {
			console.error("Error sending response:", error)
		}
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				paddingTop: 15,
			}}>
			{options.map((option, index) => (
				<OptionButton
					className="options-button"
					id={`options-button-${index}`}
					isNotSelectable={hasSelected || !isActive}
					isSelected={option === selected}
					key={index}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						await sendText(option + (inputValue ? `: ${inputValue.trim()}` : ""))
					}}>
					<span className="ph-no-capture">{option}</span>
				</OptionButton>
			))}

			{/* Free-text escape hatch — never box the user into the model's options. */}
			{showEscapeHatch && !freeTextMode && (
				<OptionButton
					className="options-button options-button-free-text"
					id="options-button-free-text"
					key="free-text"
					onClick={() => {
						// Seed the inline field with anything already typed in the
						// main box, then let the user edit/submit it right here.
						setFreeText(inputValue?.trim() ?? "")
						setFreeTextMode(true)
					}}>
					<span style={{ opacity: 0.85 }}>✏️ Let me answer in my own words…</span>
				</OptionButton>
			)}

			{showEscapeHatch && freeTextMode && (
				<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
					<FreeTextArea
						autoFocus
						className="options-free-text-input"
						onChange={(e) => setFreeText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault()
								void sendText(freeText)
							} else if (e.key === "Escape") {
								setFreeTextMode(false)
							}
						}}
						placeholder="Type your answer — Enter to send, Shift+Enter for a new line"
						rows={2}
						value={freeText}
					/>
					<div style={{ display: "flex", gap: "8px" }}>
						<OptionButton id="options-free-text-send" onClick={() => void sendText(freeText)}>
							Send
						</OptionButton>
						<OptionButton
							id="options-free-text-cancel"
							onClick={() => {
								setFreeTextMode(false)
								setFreeText("")
							}}>
							Cancel
						</OptionButton>
					</div>
				</div>
			)}
			<div aria-live="polite" data-testid="options-stale-notice" role="status" style={{ fontSize: "12px", opacity: 0.85 }}>
				{staleNotice ? STALE_ASK_NOTICE : ""}
			</div>
		</div>
	)
}
