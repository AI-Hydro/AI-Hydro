export interface WebviewMessage {
	type:
		| "grpc_request"
		| "grpc_request_cancel"
		| "invokeCommand"
		| "aihydro-hydro-command"
		| "aihydro-map-agent-task"
		| "open_replay"
		| "aihydro-show-on-map"
		| "aihydro-study-binding"
	/** open_replay: the session and run a tool-call card links to. Both are validated host-side. */
	session_id?: string
	run_id?: string
	/** aihydro-show-on-map: runs whose layers to show on the map. The host finds the layers; ids are validated there. */
	run_ids?: string[]
	grpc_request?: GrpcRequest
	grpc_request_cancel?: GrpcCancel
	command?: string
	requestId?: string
	/** aihydro-study-binding: `{ action: "open" | "choose" | "decline", studyId?, kind? }` (see handleStudyBindingMessage). */
	payload?: Record<string, unknown>
	prompt?: string
}

export type GrpcRequest = {
	service: string
	method: string
	message: any // JSON serialized protobuf message
	request_id: string // For correlating requests and responses
	is_streaming: boolean // Whether this is a streaming request
}

export type GrpcCancel = {
	request_id: string // ID of the request to cancel
}

export type AiHydroAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse"

export type AiHydroCheckpointRestore = "task" | "workspace" | "taskAndWorkspace"

export type TaskFeedbackType = "thumbs_up" | "thumbs_down"
