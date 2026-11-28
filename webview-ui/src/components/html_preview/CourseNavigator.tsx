/**
 * CourseNavigator — sidebar list of all modules in the active course.
 *
 * Phase A: numbered list with current-module highlight; free-roam clicking.
 * Phase B: ✓ completed, ⊘ locked (prereqs not met), dimmed locked rows,
 *          completion-% summary at top, prerequisite-aware click handler.
 */

import React, { useState } from "react"
import type { CourseManifest, CourseModuleEntry } from "./useCourse"
import type { CourseProgressHook } from "./useCourseProgress"
import { chrome, ensureChromeThemeStyle } from "./chromeTheme"

interface CourseNavigatorProps {
	course: CourseManifest
	currentModuleId: string | null
	progress: CourseProgressHook
	onNavigate: (moduleId: string) => void
}

const ACCENT = chrome.accent
const GREEN = chrome.ok
const MUTED = "var(--vscode-descriptionForeground, #999)"

export const CourseNavigator: React.FC<CourseNavigatorProps> = ({ course, currentModuleId, progress, onNavigate }) => {
	ensureChromeThemeStyle()
	// Count only IDs that actually exist in this course — stale entries must not inflate the tally.
	const completedCount = course.modules.filter((m) => !!progress.progress.completed[m.id]).length
	const total = course.modules.length
	const completionPct = progress.completionPct

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0" }}>
			{/* ── Course progress summary ─────────────────────────────────── */}
			<div
				style={{
					padding: "6px 10px 4px",
					borderBottom: `1px solid var(--vscode-panel-border, ${chrome.line})`,
					marginBottom: 4,
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						fontSize: 10,
						color: MUTED,
						fontFamily: "Nunito, system-ui, sans-serif",
						marginBottom: 4,
					}}>
					<span>Progress</span>
					<span style={{ color: completionPct === 100 ? GREEN : completedCount > 0 ? ACCENT : MUTED, fontWeight: 600 }}>
						{completedCount}/{total} · {completionPct}%
					</span>
				</div>
				<div
					style={{
						height: 3,
						background: chrome.track,
						borderRadius: 2,
						position: "relative",
						overflow: "hidden",
					}}>
					<div
						style={{
							position: "absolute",
							left: 0,
							top: 0,
							height: "100%",
							width: `${completionPct}%`,
							background:
								completionPct === 100
									? `linear-gradient(90deg, ${GREEN}, ${chrome.ok2})`
									: `linear-gradient(90deg, ${chrome.accent2}, ${ACCENT})`,
							transition: "width 0.3s ease",
						}}
					/>
				</div>
			</div>

			{/* ── Module list ─────────────────────────────────────────────── */}
			{course.modules.map((m, idx) => {
				const completed = progress.isCompleted(m.id)
				const accessible = progress.canAccess(m)
				const missing = progress.missingPrerequisites(m)
				return (
					<ModuleRow
						course={course}
						index={idx + 1}
						isCompleted={completed}
						isCurrent={m.id === currentModuleId}
						isLocked={!accessible}
						key={m.id}
						missingPrerequisiteIds={missing}
						module={m}
						onClick={() => accessible && onNavigate(m.id)}
					/>
				)
			})}

			{/* ── Abstract ────────────────────────────────────────────────── */}
			{course.abstract && (
				<div
					style={{
						marginTop: 8,
						padding: "6px 10px",
						borderTop: `1px solid var(--vscode-panel-border, ${chrome.line})`,
						fontSize: 10,
						color: MUTED,
						fontStyle: "italic",
						lineHeight: 1.5,
					}}>
					{course.abstract}
				</div>
			)}
		</div>
	)
}

const ModuleRow: React.FC<{
	course: CourseManifest
	index: number
	module: CourseModuleEntry
	isCurrent: boolean
	isCompleted: boolean
	isLocked: boolean
	missingPrerequisiteIds: string[]
	onClick: () => void
}> = ({ course, index, module, isCurrent, isCompleted, isLocked, missingPrerequisiteIds, onClick }) => {
	const [hovered, setHovered] = useState(false)

	// Resolve prereq titles for the tooltip
	const missingTitles = missingPrerequisiteIds.map((id) => course.modules.find((m) => m.id === id)?.title ?? id).join(", ")

	const accentColor = isLocked ? MUTED : isCompleted ? GREEN : isCurrent ? ACCENT : "var(--vscode-foreground, #ddd)"

	// Icon for the leading badge
	let badgeIcon: string | null = null
	if (isLocked) {
		badgeIcon = "lock"
	} else if (isCompleted) {
		badgeIcon = "check"
	}

	const title = isLocked
		? `Locked — complete first: ${missingTitles}`
		: isCompleted
			? `${module.title} — completed`
			: module.title

	return (
		<button
			disabled={isLocked}
			onClick={onClick}
			onMouseEnter={() => !isLocked && setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "5px 10px 5px 8px",
				background: isCurrent
					? chrome.accentTint
					: isCompleted
						? chrome.okTint
						: hovered
							? chrome.hover
							: "transparent",
				border: "none",
				borderLeft: `2px solid ${isCurrent ? ACCENT : isCompleted ? GREEN : "transparent"}`,
				color: accentColor,
				cursor: isLocked ? "not-allowed" : "pointer",
				textAlign: "left",
				fontFamily: "Nunito, system-ui, sans-serif",
				fontSize: 11,
				fontWeight: isCurrent ? 600 : 400,
				opacity: isLocked ? 0.45 : 1,
				transition: "background 0.1s, opacity 0.15s",
				width: "100%",
				minHeight: 26,
			}}
			title={title}
			type="button">
			<span
				style={{
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					width: 18,
					height: 18,
					borderRadius: 9,
					background: isLocked
						? chrome.badge
						: isCompleted
							? GREEN
							: isCurrent
								? ACCENT
								: chrome.badge,
					color: isCompleted ? chrome.onOk : isCurrent ? chrome.onAccent : isLocked ? MUTED : MUTED,
					fontSize: 9,
					fontWeight: 700,
					flexShrink: 0,
					fontFamily: "Poppins, system-ui, sans-serif",
				}}>
				{badgeIcon ? <span className={`codicon codicon-${badgeIcon}`} style={{ fontSize: 10 }} /> : index}
			</span>
			<span
				style={{
					flex: 1,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
					textDecoration: isCompleted && !isCurrent ? "none" : "none",
				}}>
				{module.title}
			</span>
			{module.estimatedMinutes !== undefined && module.estimatedMinutes > 0 && !isLocked && (
				<span
					style={{
						fontSize: 9,
						color: MUTED,
						opacity: 0.7,
						flexShrink: 0,
					}}>
					{module.estimatedMinutes}m
				</span>
			)}
		</button>
	)
}
