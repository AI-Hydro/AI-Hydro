import { CheckpointRestoreRequest } from "@shared/proto/cline/checkpoints"
import { Int64Request } from "@shared/proto/cline/common"
import { AiHydroCheckpointRestore } from "@shared/WebviewMessage"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CheckpointsServiceClient } from "@/services/grpc-client"

/**
 * The checkpoint RPCs behind the checkpoint row (CheckmarkControl) and the transcript's Rewind action
 * (RewindMenu). One implementation, so the two surfaces cannot drift: same requests, same busy states, same reset
 * when the host relinquishes control.
 */
export function useCheckpointActions(messageTs: number | undefined, isCheckpointCheckedOut: boolean | undefined) {
	const [compareDisabled, setCompareDisabled] = useState(false)
	const [restoreTaskDisabled, setRestoreTaskDisabled] = useState(false)
	const [restoreWorkspaceDisabled, setRestoreWorkspaceDisabled] = useState(false)
	const [restoreBothDisabled, setRestoreBothDisabled] = useState(false)
	const { onRelinquishControl } = useExtensionState()

	// Clear "Restore Files" button when checkpoint is no longer checked out
	useEffect(() => {
		if (!isCheckpointCheckedOut && restoreWorkspaceDisabled) {
			setRestoreWorkspaceDisabled(false)
		}
	}, [isCheckpointCheckedOut, restoreWorkspaceDisabled])

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setCompareDisabled(false)
			setRestoreTaskDisabled(false)
			setRestoreWorkspaceDisabled(false)
			setRestoreBothDisabled(false)
		})
	}, [onRelinquishControl])

	const restore = async (
		restoreType: AiHydroCheckpointRestore,
		setBusy: (busy: boolean) => void,
		label: string,
	): Promise<void> => {
		setBusy(true)
		try {
			await CheckpointsServiceClient.checkpointRestore(
				CheckpointRestoreRequest.create({
					number: messageTs,
					restoreType,
				}),
			)
		} catch (err) {
			console.error(`Checkpoint restore ${label} error:`, err)
			setBusy(false)
		}
	}

	return {
		compareDisabled,
		restoreTaskDisabled,
		restoreWorkspaceDisabled,
		restoreBothDisabled,
		handleCompare: async () => {
			setCompareDisabled(true)
			try {
				await CheckpointsServiceClient.checkpointDiff(
					Int64Request.create({
						value: messageTs,
					}),
				)
			} catch (err) {
				console.error("CheckpointDiff error:", err)
			} finally {
				setCompareDisabled(false)
			}
		},
		handleRestoreTask: () => restore("task", setRestoreTaskDisabled, "task"),
		handleRestoreWorkspace: () => restore("workspace", setRestoreWorkspaceDisabled, "workspace"),
		handleRestoreBoth: () => restore("taskAndWorkspace", setRestoreBothDisabled, "both"),
	}
}
