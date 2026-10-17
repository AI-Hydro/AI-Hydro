import type { ScreenDef } from "./types"

let active: ScreenDef | undefined

export function setActiveScreen(screen: ScreenDef | undefined) {
	active = screen
}

export function getActiveScreen(): ScreenDef | undefined {
	return active
}
