import type { ToolsEnvController } from "./ToolsEnvController"

let instance: ToolsEnvController | undefined

/** The process-wide controller, set once at activation. gRPC handlers read it through `getToolsEnvController`. */
export function setToolsEnvController(controller: ToolsEnvController | undefined): void {
	instance = controller
}

export function getToolsEnvController(): ToolsEnvController | undefined {
	return instance
}
