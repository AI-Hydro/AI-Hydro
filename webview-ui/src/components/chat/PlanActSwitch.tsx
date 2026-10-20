import { useRef } from "react"
import styled from "styled-components"

export const PLAN_MODE_COLOR = "#4A90E2" // Ocean blue for planning
// Act is a theme accent, not green: green is reserved for approved claims. The text colour is paired with it so
// contrast holds in every theme (including high-contrast).
export const ACT_MODE_COLOR = "var(--vscode-button-background, #0e639c)"
const ACT_MODE_TEXT = "var(--vscode-button-foreground, #ffffff)"

type Mode = "plan" | "act"

const SwitchOption = styled.button.withConfig({
	shouldForwardProp: (prop) => !["isActive", "activeColor", "activeText"].includes(prop),
})<{ isActive: boolean; activeColor: string; activeText: string }>`
	padding: 4px 10px;
	min-height: 24px;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	font-family: inherit;
	cursor: pointer;
	/* Active text is paired with the mode colour (black on the light blue; the theme button foreground on Act). */
	background-color: ${(props) => (props.isActive ? props.activeColor : "transparent")};
	color: ${(props) => (props.isActive ? props.activeText : "var(--vscode-input-foreground)")};
	z-index: 1;
	transition: color 0.2s ease;
	font-size: 12px;
	width: 50%;
	text-align: center;

	&:hover {
		background-color: ${(props) => (!props.isActive ? "var(--vscode-toolbar-hoverBackground)" : props.activeColor)};
	}

	&:focus-visible {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: -2px;
	}
`

const SwitchContainer = styled.div`
	display: flex;
	align-items: center;
	background-color: var(--vscode-editor-background);
	border: 1px solid var(--vscode-input-border);
	border-radius: 12px;
	overflow: hidden;
	user-select: none; // Prevent text selection
`

interface PlanActSwitchProps {
	mode: Mode
	/** Called to switch to the other mode. `keepFocus` is true for keyboard use, so focus stays on the switch. */
	onToggle: (options?: { keepFocus?: boolean }) => void
	/** Tooltip hook: the option being hovered or focused, or null. */
	onHover?: (mode: Mode | null) => void
}

/** Plan/Act mode switch: a two-option radio group (roving tabindex, arrow keys, Space/Enter on the focused option). */
export function PlanActSwitch({ mode, onToggle, onHover }: PlanActSwitchProps) {
	const refs = useRef<Record<Mode, HTMLButtonElement | null>>({ plan: null, act: null })

	const select = (target: Mode, keepFocus: boolean) => {
		if (target !== mode) onToggle(keepFocus ? { keepFocus: true } : undefined)
		if (keepFocus) refs.current[target]?.focus()
	}

	const option = (value: Mode, label: string, activeColor: string, activeText: string) => (
		<SwitchOption
			activeColor={activeColor}
			activeText={activeText}
			aria-checked={mode === value}
			isActive={mode === value}
			onBlur={() => onHover?.(null)}
			onClick={(e) => select(value, e.detail === 0)}
			onFocus={() => onHover?.(value)}
			onMouseLeave={() => onHover?.(null)}
			onMouseOver={() => onHover?.(value)}
			ref={(el) => {
				refs.current[value] = el
			}}
			role="radio"
			tabIndex={mode === value ? 0 : -1}
			type="button">
			{label}
		</SwitchOption>
	)

	return (
		<SwitchContainer
			aria-label="Mode"
			data-testid="mode-switch"
			onKeyDown={(e) => {
				if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return
				e.preventDefault()
				const forward = e.key === "ArrowRight" || e.key === "ArrowDown"
				select(forward ? "act" : "plan", true)
			}}
			role="radiogroup">
			{option("plan", "Plan", PLAN_MODE_COLOR, "#000000")}
			{option("act", "Act", ACT_MODE_COLOR, ACT_MODE_TEXT)}
		</SwitchContainer>
	)
}
