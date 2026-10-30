import type { DetailLevel } from "@shared/aihydro/transcriptPresenter"
import { useContext } from "react"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

/** The transcript detail level (Focus / Normal / Verbose). Normal outside the extension provider (tests, stories). */
export function useTranscriptDetail(): DetailLevel {
	return useContext(ExtensionStateContext)?.transcriptDetail ?? "normal"
}
