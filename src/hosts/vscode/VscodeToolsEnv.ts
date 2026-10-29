/**
 * VS Code side of the managed tools environment (X0-3): the output channel, status bar item, progress
 * notification, dialogs and commands. Everything with `vscode` in it lives here so the lifecycle in
 * src/core/mcp/toolsEnv stays host-neutral and unit-testable.
 */
import { describeToolsStatus, TOOLS_ACTION_LABEL, type ToolsEnvAction, type ToolsEnvStatus } from "@shared/aihydro/toolsEnv"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { atomicWriteFile } from "@/core/mcp/toolsEnv/atomicWrite"
import type { ToolsEnvConfig, ToolsEnvHost } from "@/core/mcp/toolsEnv/ToolsEnvController"
import { ToolsEnvController } from "@/core/mcp/toolsEnv/ToolsEnvController"
import { createNodeToolsEnvDeps } from "@/core/mcp/toolsEnv/nodeDeps"
import { setToolsEnvController } from "@/core/mcp/toolsEnv/instance"
import { ExtensionRegistryInfo } from "@/registry"

const commands = ExtensionRegistryInfo.commands
const TOOLS_COMMANDS = {
	status: commands.ToolsStatus,
	install: commands.ToolsInstall,
	repair: commands.ToolsRepair,
	showLog: commands.ToolsShowLog,
	copyDiagnostics: commands.ToolsCopyDiagnostics,
} as const

/** Per-machine tools state (kept launcher, install consent, record-existed marker), next to the launcher record. */
const STATE_FILE = "aihydro_tools_env.json"

function readConfig(): ToolsEnvConfig {
	const cfg = vscode.workspace.getConfiguration("aihydro.tools")
	// Machine-scoped settings (package.json): a workspace cannot redirect which interpreter or directory we use.
	const python = (cfg.get<string>("pythonPath") ?? "").trim()
	return {
		venvPath: (cfg.get<string>("venvPath") ?? "").trim(),
		pythonPaths: python ? [python] : [],
		autoInstall: cfg.get<boolean>("autoInstall") ?? true,
	}
}

export function statusBarText(s: ToolsEnvStatus): { text: string; tooltip: string; warn: boolean } {
	const model = describeToolsStatus(s)
	const icon =
		model.tone === "busy"
			? "$(sync~spin)"
			: model.tone === "ok"
				? "$(check)"
				: model.tone === "warn"
					? "$(warning)"
					: "$(error)"
	const v = s.version ? ` ${s.version}` : ""
	const short =
		s.phase === "ready" && s.trust === "trusted"
			? `Tools${v}`
			: s.phase === "ready"
				? `Tools${v} untrusted`
				: s.phase === "installing"
					? "Tools installing"
					: s.phase === "checking"
						? "Tools checking"
						: s.phase === "failed"
							? "Tools failed"
							: s.phase === "unhealthy"
								? "Tools unhealthy"
								: s.phase === "custom"
									? "Tools custom"
									: "Tools missing"
	return {
		text: `${icon} ${short}`,
		tooltip: `${model.label}\n${model.detail}`.trim(),
		warn: model.tone === "warn" || model.tone === "error",
	}
}

export function createVscodeToolsEnv(
	context: vscode.ExtensionContext,
	paths: ConstructorParameters<typeof ToolsEnvController>[2],
): ToolsEnvController {
	const channel = vscode.window.createOutputChannel("AI-Hydro Tools")
	const log = (line: string) => channel.appendLine(line)
	const stateFile = path.join(paths.settingsDir, STATE_FILE)
	const host: ToolsEnvHost = {
		getConfig: readConfig,
		withProgress: (title, task) =>
			Promise.resolve(
				vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title, cancellable: true },
					(progress, token) => {
						const controller = new AbortController()
						token.onCancellationRequested(() => controller.abort())
						let last = ""
						return task((step) => {
							if (step !== last) {
								progress.report({ message: step })
								log(`[step] ${step}`)
								last = step
							}
						}, controller.signal)
					},
				),
			),
		confirmTrust: async (launcher, recorded) => {
			const trust = "Trust this launcher"
			const choice = await vscode.window.showWarningMessage(
				`The "${launcher.name}" MCP server now launches \`${[launcher.command, ...launcher.args].join(" ")}\`${
					recorded
						? `, which differs from the launcher AI-Hydro recorded (\`${[recorded.command, ...recorded.args].join(" ")}\`)`
						: ""
				}. Until you confirm, it is not treated as the first-party server (claim-approval prompts and read-only subagent tools are off).`,
				{ modal: true },
				trust,
			)
			return choice === trust
		},
		askSwitch: async (current, managed) => {
			const sw = "Switch to the managed environment"
			const keep = "Keep current"
			const choice = await vscode.window.showInformationMessage(
				`AI-Hydro can run its tools from a managed environment it keeps up to date (${managed}). Your "ai-hydro" server currently launches \`${current}\`.`,
				sw,
				keep,
			)
			return choice === sw ? "switch" : choice === keep ? "keep" : undefined
		},
		notify: async (kind, message, actions) =>
			kind === "error"
				? vscode.window.showErrorMessage(message, ...actions)
				: vscode.window.showInformationMessage(message, ...actions),
		showLog: () => channel.show(true),
		copyText: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
		readState: async () => {
			try {
				const parsed = JSON.parse(await fs.readFile(stateFile, "utf-8"))
				return {
					keptLauncher: typeof parsed.keptLauncher === "string" ? parsed.keptLauncher : undefined,
					installConsent: parsed.installConsent === true,
					recordExisted: parsed.recordExisted === true,
				}
			} catch {
				return {}
			}
		},
		writeState: async (patch) => {
			let current: Record<string, unknown> = {}
			try {
				current = JSON.parse(await fs.readFile(stateFile, "utf-8"))
			} catch {
				// first write
			}
			const next: Record<string, unknown> = { ...current, ...patch }
			for (const key of Object.keys(next)) {
				if (next[key] === undefined) {
					delete next[key]
				}
			}
			await atomicWriteFile(stateFile, JSON.stringify(next, null, 2))
		},
		confirmInstall: async ({ venvPath, requirement }) => {
			const install = "Install"
			const choice = await vscode.window.showInformationMessage(
				`AI-Hydro needs its Python tools. Install ${requirement} into ${venvPath}? This downloads packages from PyPI (pypi.org and files.pythonhosted.org), typically several hundred MB (estimate), and creates a private virtual environment. Nothing is installed into your system Python.`,
				install,
				"Not now",
			)
			return choice === install
		},
		confirmRecreate: async (venvPath) => {
			const recreate = "Recreate"
			const choice = await vscode.window.showWarningMessage(
				`The AI-Hydro tools environment at ${venvPath} has lost its Python interpreter. Delete and recreate it? Packages installed into it by hand are removed.`,
				{ modal: true },
				recreate,
			)
			return choice === recreate
		},
		extensionVersion: () => ExtensionRegistryInfo.version,
	}

	const controller = new ToolsEnvController(host, createNodeToolsEnvDeps(log, paths.cacheDir), paths)
	setToolsEnvController(controller)

	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0)
	item.command = TOOLS_COMMANDS.status
	item.name = "AI-Hydro tools"
	const paint = (s: ToolsEnvStatus) => {
		const t = statusBarText(s)
		item.text = t.text
		item.tooltip = t.tooltip
		item.accessibilityInformation = { label: `AI-Hydro tools: ${t.tooltip.replace(/\n/g, ". ")}`, role: "button" }
		item.backgroundColor = t.warn ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined
	}
	paint(controller.getStatus())
	item.show()

	const run = (action: ToolsEnvAction) => () => controller.runAction(action)
	context.subscriptions.push(
		channel,
		item,
		controller.onDidChange(paint),
		vscode.commands.registerCommand(TOOLS_COMMANDS.install, run("install")),
		vscode.commands.registerCommand(TOOLS_COMMANDS.repair, run("repair")),
		vscode.commands.registerCommand(TOOLS_COMMANDS.showLog, run("showLog")),
		vscode.commands.registerCommand(TOOLS_COMMANDS.copyDiagnostics, run("copyDiagnostics")),
		vscode.commands.registerCommand(TOOLS_COMMANDS.status, async () => {
			const model = describeToolsStatus(controller.getStatus())
			const actions: ToolsEnvAction[] = [
				...model.actions,
				...(model.actions.includes("showLog") ? [] : (["showLog"] as ToolsEnvAction[])),
				"copyDiagnostics",
			]
			if (controller.getStatus().phase === "ready" && !actions.includes("repair")) {
				actions.unshift("repair")
			}
			const picked = await vscode.window.showQuickPick(
				actions.map((a) => ({ label: TOOLS_ACTION_LABEL[a], action: a })),
				{ title: model.label, placeHolder: model.detail || undefined },
			)
			if (picked) {
				await controller.runAction(picked.action)
			}
		}),
	)
	return controller
}
