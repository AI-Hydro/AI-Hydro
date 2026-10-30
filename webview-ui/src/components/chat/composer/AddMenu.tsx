import { type RefObject, useRef, useState } from "react"
import { ComposerPopover } from "./ComposerPopover"
import "./composer.css"

interface AddMenuProps {
	/** Insert an "@" mention trigger in the prompt. */
	onAddContext: () => void
	/** Open the file and image picker. */
	onAttach: () => void
	/** Open the rules and workflows panel. */
	onOpenRules: () => void
	attachDisabled?: boolean
	/** Receives the trigger so the rules panel can anchor to it. */
	triggerRef?: RefObject<HTMLButtonElement>
}

/**
 * The composer's one "Add" control: context (@), files and images, and rules and workflows. It replaces the separate
 * @, +, MCP-servers and rules buttons (nav audit N6). MCP servers are managed in the Hydro Tools view, not here.
 */
export function AddMenu({ onAddContext, onAttach, onOpenRules, attachDisabled, triggerRef }: AddMenuProps) {
	const [open, setOpen] = useState(false)
	const ownRef = useRef<HTMLButtonElement>(null)
	const buttonRef = triggerRef ?? ownRef
	const item = (id: string, icon: string, text: string, onClick: () => void, disabled = false) => (
		<button
			className="aih-menu-item"
			data-testid={id}
			disabled={disabled}
			onClick={() => {
				setOpen(false)
				onClick()
			}}
			role="menuitem"
			type="button">
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			<span>{text}</span>
		</button>
	)
	return (
		<>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Add"
				className="aih-tool-btn"
				data-testid="add-menu-button"
				onClick={() => setOpen((v) => !v)}
				ref={buttonRef}
				title="Add context, files, rules"
				type="button">
				<span aria-hidden="true" className="codicon codicon-add" />
			</button>
			<ComposerPopover anchorRef={buttonRef} label="Add" onClose={() => setOpen(false)} open={open} role="menu" width={240}>
				{item("context-button", "mention", "Add context (@)", onAddContext)}
				{item("files-button", "file-media", "Attach files & images", onAttach, attachDisabled)}
				{item("rules-button", "law", "Rules & workflows", onOpenRules)}
			</ComposerPopover>
		</>
	)
}

export default AddMenu
