import { describeInvestigation } from "@shared/aihydro/investigationSummary"
import { displayTitle, estimateBulkTitleTokens, isBulkTitleCandidate } from "@shared/chatTitle"
import { BooleanRequest, EmptyRequest, StringArrayRequest, StringRequest } from "@shared/proto/cline/common"
import { GetTaskHistoryRequest, TaskFavoriteRequest } from "@shared/proto/cline/task"
import { VSCodeButton, VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import Fuse, { FuseResult } from "fuse.js"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import DangerButton from "@/components/common/DangerButton"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Button, Disclosure, IconButton, KeyValue, Text } from "@/design"
import { TaskServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import { formatLargeNumber, formatSize } from "@/utils/format"
import { stripMarkdown } from "@/utils/stripMarkdown"
import { HighlightedText, withMatchRegions } from "./HighlightedText"
import { RenameField } from "./RenameField"
import { TitleBanner } from "./TitleBanner"
import "./history.css"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

// Tailwind-styled radio with custom icon support - works independently of VSCodeRadioGroup but looks the same
// Used for workspace and favorites filters

interface CustomFilterRadioProps {
	checked: boolean
	onChange: () => void
	icon: string
	label: string
}

const CustomFilterRadio = ({ checked, onChange, icon, label }: CustomFilterRadioProps) => {
	return (
		<button aria-checked={checked} className="aih-btn aih-btn--ghost" onClick={onChange} role="checkbox" type="button">
			<span aria-hidden="true" className={`codicon codicon-${checked ? "check" : "blank"}`} />
			<span aria-hidden="true" className={`codicon codicon-${icon}`} />
			{label}
		</button>
	)
}

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const extensionStateContext = useExtensionState()
	const { taskHistory, onRelinquishControl, environment, autoTitle, titleModel } = extensionStateContext
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [deleteAllDisabled, setDeleteAllDisabled] = useState(false)
	const [selectedItems, setSelectedItems] = useState<string[]>([])
	const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
	const [showCurrentWorkspaceOnly, setShowCurrentWorkspaceOnly] = useState(false)

	// Which chat is being renamed (one at a time), and whether the opt-in banner is running or dismissed.
	const [renamingId, setRenamingId] = useState<string>()
	const [bulkRunning, setBulkRunning] = useState(false)
	const [bulkOutcome, setBulkOutcome] = useState<string>()
	const [bannerDismissed, setBannerDismissed] = useState(() => readBannerDismissed())

	// Keep track of pending favorite toggle operations
	const [pendingFavoriteToggles, setPendingFavoriteToggles] = useState<Record<string, boolean>>({})

	// Load filtered task history with gRPC
	const [tasks, setTasks] = useState<any[]>([])

	// Load and refresh task history
	const loadTaskHistory = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTaskHistory(
				GetTaskHistoryRequest.create({
					favoritesOnly: showFavoritesOnly,
					searchQuery: searchQuery || undefined,
					sortBy: sortOption,
					currentWorkspaceOnly: showCurrentWorkspaceOnly,
				}),
			)
			// The host sends the checked display title; the raw prompt is only searched, never shown as the name.
			setTasks(
				(response.tasks || []).map((t) => ({
					...t,
					task: stripMarkdown(t.task ?? ""),
					title: t.title || displayTitle({ task: t.task ?? "" }),
				})),
			)
		} catch (error) {
			console.error("Error loading task history:", error)
		}
	}, [showFavoritesOnly, showCurrentWorkspaceOnly, searchQuery, sortOption, taskHistory])

	// Load when filters change
	useEffect(() => {
		// Force a complete refresh when both filters are active
		// to ensure proper combined filtering
		if (showFavoritesOnly && showCurrentWorkspaceOnly) {
			setTasks([])
		}
		loadTaskHistory()
	}, [loadTaskHistory, showFavoritesOnly, showCurrentWorkspaceOnly])

	const toggleFavorite = useCallback(
		async (taskId: string, currentValue: boolean) => {
			// Optimistic UI update
			setPendingFavoriteToggles((prev) => ({ ...prev, [taskId]: !currentValue }))

			try {
				await TaskServiceClient.toggleTaskFavorite(
					TaskFavoriteRequest.create({
						taskId,
						isFavorited: !currentValue,
					}),
				)

				// Refresh if either filter is active to ensure proper combined filtering
				if (showFavoritesOnly || showCurrentWorkspaceOnly) {
					loadTaskHistory()
				}
			} catch (err) {
				console.error(`[FAVORITE_TOGGLE_UI] Error for task ${taskId}:`, err)
				// Revert optimistic update
				setPendingFavoriteToggles((prev) => {
					const updated = { ...prev }
					delete updated[taskId]
					return updated
				})
			} finally {
				// Clean up pending state after 1 second
				setTimeout(() => {
					setPendingFavoriteToggles((prev) => {
						const updated = { ...prev }
						delete updated[taskId]
						return updated
					})
				}, 1000)
			}
		},
		[showFavoritesOnly, loadTaskHistory],
	)

	// Use the onRelinquishControl hook instead of message event
	useEffect(() => {
		return onRelinquishControl(() => {
			setDeleteAllDisabled(false)
		})
	}, [onRelinquishControl])

	const { totalTasksSize, setTotalTasksSize } = extensionStateContext

	const fetchTotalTasksSize = useCallback(async () => {
		try {
			const response = await TaskServiceClient.getTotalTasksSize(EmptyRequest.create({}))
			if (response && typeof response.value === "number") {
				setTotalTasksSize?.(response.value || 0)
			}
		} catch (error) {
			console.error("Error getting total tasks size:", error)
		}
	}, [setTotalTasksSize])

	// Request total tasks size when component mounts
	useEffect(() => {
		fetchTotalTasksSize()
	}, [fetchTotalTasksSize])

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	const handleShowTaskWithId = useCallback((id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}, [])

	const handleHistorySelect = useCallback((itemId: string, checked: boolean) => {
		setSelectedItems((prev) => {
			if (checked) {
				return [...prev, itemId]
			} else {
				return prev.filter((id) => id !== itemId)
			}
		})
	}, [])

	const handleDeleteHistoryItem = useCallback(
		(id: string) => {
			TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: [id] }))
				.then(() => fetchTotalTasksSize())
				.catch((error) => console.error("Error deleting task:", error))
		},
		[fetchTotalTasksSize],
	)

	const handleDeleteSelectedHistoryItems = useCallback(
		(ids: string[]) => {
			if (ids.length > 0) {
				TaskServiceClient.deleteTasksWithIds(StringArrayRequest.create({ value: ids }))
					.then(() => fetchTotalTasksSize())
					.catch((error) => console.error("Error deleting tasks:", error))
				setSelectedItems([])
			}
		},
		[fetchTotalTasksSize],
	)

	const formatDate = useCallback((timestamp: number) => {
		const date = new Date(timestamp)
		return date
			?.toLocaleString("en-US", {
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			})
			.replace(", ", " ")
			.replace(" at", ",")
			.toUpperCase()
	}, [])

	const fuse = useMemo(() => {
		return new Fuse(tasks, {
			keys: ["title", "task"],
			threshold: 0.6,
			shouldSort: true,
			isCaseSensitive: false,
			ignoreLocation: false,
			includeMatches: true,
			minMatchCharLength: 1,
		})
	}, [tasks])

	const taskHistorySearchResults = useMemo(() => {
		const results = searchQuery ? withMatchRegions(fuse.search(searchQuery), "title") : tasks

		results.sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return a.ts - b.ts
				case "mostExpensive":
					return (b.totalCost || 0) - (a.totalCost || 0)
				case "mostTokens":
					return (
						(b.tokensIn || 0) +
						(b.tokensOut || 0) +
						(b.cacheWrites || 0) +
						(b.cacheReads || 0) -
						((a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0))
					)
				case "mostRelevant":
					// NOTE: you must never sort directly on object since it will cause members to be reordered
					return searchQuery ? 0 : b.ts - a.ts // Keep fuse order if searching, otherwise sort by newest
				case "newest":
				default:
					return b.ts - a.ts
			}
		})

		return results
	}, [tasks, searchQuery, fuse, sortOption])

	// Calculate total size of selected items
	const selectedItemsSize = useMemo(() => {
		if (selectedItems.length === 0) {
			return 0
		}

		return taskHistory.filter((item) => selectedItems.includes(item.id)).reduce((total, item) => total + (item.size || 0), 0)
	}, [selectedItems, taskHistory])

	const handleBatchHistorySelect = useCallback(
		(selectAll: boolean) => {
			if (selectAll) {
				setSelectedItems(taskHistorySearchResults.map((item) => item.id))
			} else {
				setSelectedItems([])
			}
		},
		[taskHistorySearchResults],
	)

	const bulkCandidates = useMemo(
		() => taskHistory.filter((item) => item.ts && item.task && isBulkTitleCandidate(item)).length,
		[taskHistory],
	)

	const startBulk = useCallback(async () => {
		setBulkRunning(true)
		setBulkOutcome(undefined)
		try {
			const result = await TaskServiceClient.startBulkTitling(EmptyRequest.create({}))
			setBulkOutcome(describeBulk(result.status, result.titled, result.failed))
		} catch (error) {
			console.error("Error titling chats:", error)
			setBulkOutcome("Titling stopped before it finished. Chats keep the names they had.")
		} finally {
			setBulkRunning(false)
		}
	}, [])

	const cancelBulk = useCallback(() => {
		TaskServiceClient.cancelBulkTitling(EmptyRequest.create({})).catch((error) =>
			console.error("Error cancelling titling:", error),
		)
	}, [])

	const dismissBanner = useCallback(() => {
		setBannerDismissed(true)
		setBulkOutcome(undefined)
		writeBannerDismissed()
	}, [])

	const finishRename = useCallback(
		(saved: boolean) => {
			const id = renamingId
			setRenamingId(undefined)
			if (saved) {
				loadTaskHistory()
			}
			// The field is gone; focus goes back to the name it replaced.
			if (id) {
				setTimeout(() => document.getElementById(`history-title-${id}`)?.focus(), 0)
			}
		},
		[renamingId, loadTaskHistory],
	)

	return (
		<>
			<style>
				{`
					.history-item:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.history-item-highlight {
						background-color: var(--vscode-editor-findMatchHighlightBackground);
						color: inherit;
					}
				`}
			</style>
			<div className="history-container">
				<div className="history-header">
					<h3
						className="history-header-title"
						style={{
							color: getEnvironmentColor(environment),
						}}>
						History
					</h3>
					<Button onClick={() => onDone()}>Done</Button>
				</div>
				<div className="history-search-area">
					<div className="history-search-row">
						<VSCodeTextField
							className="w-full"
							onInput={(e) => {
								const newValue = (e.target as HTMLInputElement)?.value
								setSearchQuery(newValue)
								if (newValue && !searchQuery && sortOption !== "mostRelevant") {
									setLastNonRelevantSort(sortOption)
									setSortOption("mostRelevant")
								}
							}}
							placeholder="Fuzzy search history..."
							value={searchQuery}>
							<div
								className="codicon codicon-search opacity-80"
								slot="start"
								style={{ fontSize: 13, marginTop: 2.5 }}></div>
							{searchQuery && (
								<div
									aria-label="Clear search"
									className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
									onClick={() => setSearchQuery("")}
									slot="end"
								/>
							)}
						</VSCodeTextField>
						<VSCodeRadioGroup
							className="flex flex-wrap"
							onChange={(e) => setSortOption((e.target as HTMLInputElement).value as SortOption)}
							value={sortOption}>
							<VSCodeRadio value="newest">Newest</VSCodeRadio>
							<VSCodeRadio value="oldest">Oldest</VSCodeRadio>
							<VSCodeRadio value="mostExpensive">Most Expensive</VSCodeRadio>
							<VSCodeRadio value="mostTokens">Most Tokens</VSCodeRadio>
							<VSCodeRadio disabled={!searchQuery} style={{ opacity: searchQuery ? 1 : 0.5 }} value="mostRelevant">
								Most Relevant
							</VSCodeRadio>
							<CustomFilterRadio
								checked={showCurrentWorkspaceOnly}
								icon="workspace"
								label="Workspace"
								onChange={() => setShowCurrentWorkspaceOnly(!showCurrentWorkspaceOnly)}
							/>
							<CustomFilterRadio
								checked={showFavoritesOnly}
								icon="star-full"
								label="Favorites"
								onChange={() => setShowFavoritesOnly(!showFavoritesOnly)}
							/>
						</VSCodeRadioGroup>

						<div className="flex justify-end gap-2.5">
							<VSCodeButton onClick={() => handleBatchHistorySelect(true)}>Select All</VSCodeButton>
							<VSCodeButton onClick={() => handleBatchHistorySelect(false)}>Select None</VSCodeButton>
						</div>
					</div>
				</div>
				{autoTitle !== false && !bannerDismissed && (
					<TitleBanner
						count={bulkCandidates}
						estimatedTokens={estimateBulkTitleTokens(bulkCandidates)}
						modelLabel={titleModel ? `the model ${titleModel}` : "your chat model"}
						onCancel={cancelBulk}
						onDismiss={dismissBanner}
						onStart={startBulk}
						outcome={bulkOutcome}
						remaining={bulkCandidates}
						running={bulkRunning}
					/>
				)}
				<div className="history-list-container">
					<Virtuoso
						className="flex-grow overflow-y-scroll"
						data={taskHistorySearchResults}
						itemContent={(_index, item) => {
							const favorited = pendingFavoriteToggles[item.id] ?? item.isFavorited
							return (
								<article className="history-item modern-card mx-3 my-2 flex" key={item.id}>
									<VSCodeCheckbox
										aria-label={`Select chat: ${item.title}`}
										checked={selectedItems.includes(item.id)}
										className="pl-3 pr-1"
										onClick={(e) => {
											const checked = (e.target as HTMLInputElement).checked
											handleHistorySelect(item.id, checked)
											e.stopPropagation()
										}}
									/>
									<div className="history-item-content">
										<div className="history-item-header">
											<Text muted variant="caption">
												{formatDate(item.ts)}
											</Text>
											<div className="flex gap-1">
												{/* only show delete button if task not favorited */}
												{!favorited && (
													<Button
														aria-label={`Delete task (${formatSize(item.size)})`}
														icon="trash"
														onClick={() => handleDeleteHistoryItem(item.id)}
														variant="ghost">
														{formatSize(item.size)}
													</Button>
												)}
												<IconButton
													active={Boolean(favorited)}
													icon={favorited ? "star-full" : "star-empty"}
													label={favorited ? "Remove from favorites" : "Add to favorites"}
													onClick={() => toggleFavorite(item.id, item.isFavorited || false)}
												/>
											</div>
										</div>
										{renamingId === item.id ? (
											<RenameField
												initial={item.title}
												locked={item.titleSource === "user"}
												onDone={finishRename}
												taskId={item.id}
											/>
										) : (
											<div className="history-card__titlerow">
												<button
													className="history-card__title"
													id={`history-title-${item.id}`}
													onClick={() => handleShowTaskWithId(item.id)}
													onKeyDown={(e) => {
														if (e.key === "F2") {
															e.preventDefault()
															setRenamingId(item.id)
														}
													}}
													type="button">
													<span className="ph-no-capture">
														<HighlightedText regions={item.matchRegions} text={item.title} />
													</span>
												</button>
												<IconButton
													icon="edit"
													label={`Rename chat: ${item.title}`}
													onClick={() => setRenamingId(item.id)}
												/>
											</div>
										)}
										{item.description && (
											<Text
												as="p"
												className="history-card__description ph-no-capture"
												muted
												variant="caption">
												{item.description}
											</Text>
										)}
										<Text as="p" muted variant="caption">
											{describeInvestigation(undefined)}
										</Text>
										<Disclosure label="Usage">
											<KeyValue
												items={[
													{ label: "Tokens in", value: formatLargeNumber(item.tokensIn || 0) },
													{ label: "Tokens out", value: formatLargeNumber(item.tokensOut || 0) },
													{
														label: "Cache",
														value:
															item.cacheWrites || item.cacheReads
																? formatLargeNumber(
																		(item.cacheWrites || 0) + (item.cacheReads || 0),
																	)
																: undefined,
													},
													{
														label: "Cost",
														value: item.totalCost ? `$${item.totalCost.toFixed(4)}` : undefined,
													},
												]}
											/>
											{!item.totalCost && <ExportButton itemId={item.id} />}
										</Disclosure>
									</div>
								</article>
							)
						}}
					/>
				</div>
				<div className="history-footer">
					{selectedItems.length > 0 ? (
						<DangerButton
							aria-label="Delete selected items"
							className="w-full"
							onClick={() => {
								handleDeleteSelectedHistoryItems(selectedItems)
							}}>
							Delete {selectedItems.length > 1 ? selectedItems.length : ""} Selected
							{selectedItemsSize > 0 ? ` (${formatSize(selectedItemsSize)})` : ""}
						</DangerButton>
					) : (
						<DangerButton
							aria-label="Delete all history"
							className="w-full"
							disabled={deleteAllDisabled || taskHistory.length === 0}
							onClick={() => {
								setDeleteAllDisabled(true)
								TaskServiceClient.deleteAllTaskHistory(BooleanRequest.create({}))
									.then(() => fetchTotalTasksSize())
									.catch((error) => console.error("Error deleting task history:", error))
									.finally(() => setDeleteAllDisabled(false))
							}}>
							Delete All History{totalTasksSize !== null ? ` (${formatSize(totalTasksSize)})` : ""}
						</DangerButton>
					)}
				</div>
			</div>
		</>
	)
}

const BANNER_KEY = "aihydro.titleBannerDismissed"

// A per-viewer convenience only: the banner is an offer, so a blocked or empty store just shows it again.
function readBannerDismissed(): boolean {
	try {
		return window.localStorage.getItem(BANNER_KEY) === "1"
	} catch {
		return false
	}
}

function writeBannerDismissed(): void {
	try {
		window.localStorage.setItem(BANNER_KEY, "1")
	} catch {
		// not stored; the banner will offer again next time
	}
}

function describeBulk(status: string, titled: number, failed: number): string {
	if (status === "disabled") {
		return "Automatic titles are turned off in Settings, so nothing was sent."
	}
	if (status === "busy") {
		return "Titling is already running."
	}
	const done = `${titled} chat${titled === 1 ? "" : "s"} titled.`
	const kept = failed > 0 ? ` ${failed} kept their short name (the model gave no usable title).` : ""
	return status === "cancelled" ? `Stopped. ${done}${kept}` : `${done}${kept}`
}

const ExportButton = ({ itemId }: { itemId: string }) => (
	<Button
		icon="export"
		onClick={() => {
			TaskServiceClient.exportTaskWithId(StringRequest.create({ value: itemId })).catch((err) =>
				console.error("Failed to export task:", err),
			)
		}}
		variant="ghost">
		Export task
	</Button>
)

// https://gist.github.com/evenfrost/1ba123656ded32fb7a0cd4651efd4db0
export const highlight = (fuseSearchResult: FuseResult<any>[], highlightClassName: string = "history-item-highlight") => {
	const set = (obj: Record<string, any>, path: string, value: any) => {
		const pathValue = path.split(".")
		let i: number

		for (i = 0; i < pathValue.length - 1; i++) {
			obj = obj[pathValue[i]] as Record<string, any>
		}

		obj[pathValue[i]] = value
	}

	// Function to merge overlapping regions
	const mergeRegions = (regions: [number, number][]): [number, number][] => {
		if (regions.length === 0) {
			return regions
		}

		// Sort regions by start index
		regions.sort((a, b) => a[0] - b[0])

		const merged: [number, number][] = [regions[0]]

		for (let i = 1; i < regions.length; i++) {
			const last = merged[merged.length - 1]
			const current = regions[i]

			if (current[0] <= last[1] + 1) {
				// Overlapping or adjacent regions
				last[1] = Math.max(last[1], current[1])
			} else {
				merged.push(current)
			}
		}

		return merged
	}

	const generateHighlightedText = (inputText: string, regions: [number, number][] = []) => {
		if (regions.length === 0) {
			return inputText
		}

		// Sort and merge overlapping regions
		const mergedRegions = mergeRegions(regions)

		let content = ""
		let nextUnhighlightedRegionStartingIndex = 0

		mergedRegions.forEach((region) => {
			const start = region[0]
			const end = region[1]
			const lastRegionNextIndex = end + 1

			content += [
				inputText.substring(nextUnhighlightedRegionStartingIndex, start),
				`<span class="${highlightClassName}">`,
				inputText.substring(start, lastRegionNextIndex),
				"</span>",
			].join("")

			nextUnhighlightedRegionStartingIndex = lastRegionNextIndex
		})

		content += inputText.substring(nextUnhighlightedRegionStartingIndex)

		return content
	}

	return fuseSearchResult
		.filter(({ matches }) => matches && matches.length)
		.map(({ item, matches }) => {
			const highlightedItem = { ...item }

			matches?.forEach((match) => {
				if (match.key && typeof match.value === "string" && match.indices) {
					// Merge overlapping regions before generating highlighted text
					const mergedIndices = mergeRegions([...match.indices])
					set(highlightedItem, match.key, generateHighlightedText(match.value, mergedIndices))
				}
			})

			return highlightedItem
		})
}

export default memo(HistoryView)
