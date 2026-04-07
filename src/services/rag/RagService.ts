import { exec, execSync } from "child_process"
import { existsSync } from "fs"
import * as path from "path"
import { promisify } from "util"
import * as vscode from "vscode"
import { Logger } from "../logging/Logger"

const execAsync = promisify(exec)

/**
 * Result from a RAG query
 */
export interface RagQueryResult {
	source: string
	key: string
	content: any
	relevance: number
	type?: string
	tool?: string
	rationale?: string
	priority?: string
	workflow?: string
	category?: string
	description?: string
	usage_example?: string
	attribute?: string
	name?: string
	title?: string
}

/**
 * Workflow recommendation from RAG
 */
export interface WorkflowRecommendation {
	workflow: string
	title?: string
	description: string
	recommended_tools?: string[]
	tool_rationales?: Record<string, string>
	category?: string
	inputs?: any[]
	outputs?: any[]
}

/**
 * RAG Service for AI-Hydro
 *
 * Provides access to the Python-based RAG (Retrieval-Augmented Generation) engine
 * for hydrological knowledge queries. This service bridges the TypeScript extension
 * with the Python RAG system.
 *
 * Python package structure:
 * - ai_hydro.rag.engine - Main RAG engine
 * - ai_hydro.registry - Tool and workflow registries
 * - ai_hydro.utils - Utility functions
 * - knowledge/ - Unified knowledge base directory
 */
export class RagService {
	private pythonPath: string
	private ragEnginePath: string
	private pythonDir: string
	private isAvailable: boolean = false
	private availabilityChecked: boolean = false
	private availabilityCheckPromise: Promise<void> | null = null
	private needsDependencyInstall: boolean = false
	private dependencyCheckError: string | null = null
	private workspaceVenvPath: string | null = null
	private venvPython: string | null = null
	private context?: vscode.ExtensionContext

	constructor(context?: vscode.ExtensionContext) {
		this.context = context
		// Path to Python executable and RAG engine
		// Use context.extensionPath for proper path resolution in VSIX packages
		this.pythonPath = this.detectPython()

		if (context) {
			// When running as VSIX extension, use the extension path
			this.pythonDir = path.join(context.extensionPath, "python")
		} else {
			// Fallback for development/testing (when context is not available)
			this.pythonDir = path.join(__dirname, "../../python")
		}

		this.ragEnginePath = path.join(this.pythonDir, "ai_hydro/rag/engine.py")

		// Start availability check but don't await (will be checked lazily)
		this.availabilityCheckPromise = this.checkAvailability()
	}

	/**
	 * Check if Python and RAG engine are available
	 */
	private async checkAvailability(): Promise<void> {
		if (this.availabilityChecked) {
			Logger.info("RAG Service: Availability already checked, returning cached result")
			return
		}

		Logger.info("RAG Service: Starting availability check...")
		try {
			// Check Python version
			const { stdout } = await execAsync(`${this.pythonPath} --version`)
			Logger.info(`RAG Service: Python version output: ${stdout.trim()}`)

			if (!stdout.includes("Python 3")) {
				this.isAvailable = false
				this.dependencyCheckError = "Python 3 not found"
				Logger.warn(`RAG Service: Python 3 not found (unexpected version output: ${stdout})`)
				return
			}

			// Try to import the RAG engine to check dependencies
			Logger.info("RAG Service: Checking RAG engine dependencies...")
			const testCode = `
import sys
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')
from ai_hydro.rag import RAGEngine
print("OK")
`
			try {
				const result = execSync(`${this.pythonPath} -c ${this.escapeShellArg(testCode)}`, {
					encoding: "utf8",
					timeout: 30000, // 30 seconds for heavy initialization (registry loading)
				})

				if (result.trim() === "OK") {
					this.isAvailable = true
					this.needsDependencyInstall = false
					Logger.info("RAG Service: ✓ RAG engine and dependencies available")
				}
			} catch (depError: any) {
				// Check if it's a ModuleNotFoundError
				const errorStr = depError.message || String(depError)
				if (errorStr.includes("ModuleNotFoundError") || errorStr.includes("No module named")) {
					this.isAvailable = false
					this.needsDependencyInstall = true

					// Extract missing module name
					const match = errorStr.match(/No module named ['"]([^'"]+)['"]/)
					const missingModule = match ? match[1] : "unknown"
					this.dependencyCheckError = `Missing Python package: ${missingModule}`

					Logger.warn(`RAG Service: Dependencies missing - ${this.dependencyCheckError}`)
					Logger.info("RAG Service: RAG brain requires dependency installation")
				} else {
					this.isAvailable = false
					this.needsDependencyInstall = false
					this.dependencyCheckError = `RAG engine test failed: ${errorStr}`
					Logger.error(`RAG Service: ${this.dependencyCheckError}`)
				}
			}
		} catch (error) {
			this.isAvailable = false
			this.needsDependencyInstall = false
			this.dependencyCheckError = `Python check failed: ${error}`
			Logger.warn(`RAG Service: ${this.dependencyCheckError}`)
		} finally {
			this.availabilityChecked = true
			Logger.info(
				`RAG Service: Availability check complete. isAvailable=${this.isAvailable}, needsDependencyInstall=${this.needsDependencyInstall}`,
			)
		}
	}

	/**
	 * Ensure availability check has completed
	 */
	private async ensureAvailabilityChecked(): Promise<void> {
		if (!this.availabilityChecked && this.availabilityCheckPromise) {
			await this.availabilityCheckPromise
		}
	}

	/**
	 * Escape shell argument for safe execution
	 */
	/**
	 * Detect the best available Python with ai_hydro installed.
	 * Tries conda/miniconda first, then system python3.
	 */
	private detectPython(): string {
		const candidates = [
			"/opt/miniconda3/bin/python",
			"/opt/miniconda3/bin/python3",
			"/usr/local/anaconda3/bin/python",
			"/opt/homebrew/bin/python3",
			"python3",
			"python",
		]
		for (const candidate of candidates) {
			try {
				const result = require("child_process").execSync(`"${candidate}" -c "import ai_hydro; print('OK')"`, {
					encoding: "utf8",
					timeout: 5000,
					stdio: ["pipe", "pipe", "pipe"],
				})
				if (result.trim() === "OK") {
					Logger.info(`RAG Service: Using Python: ${candidate}`)
					return candidate
				}
			} catch {
				// not this one
			}
		}
		Logger.warn("RAG Service: No Python with ai_hydro found, falling back to python3")
		return "python3"
	}

	private escapeShellArg(arg: string): string {
		return `"${arg.replace(/"/g, '\\"')}"`
	}

	/**
	 * Query the RAG knowledge base
	 * @param query Natural language query about hydrology
	 * @param topK Number of results to return
	 * @returns Array of relevant knowledge entries
	 */
	async query(query: string, topK: number = 3): Promise<RagQueryResult[]> {
		Logger.info(`RAG Service: query() called with query="${query.substring(0, 100)}..." topK=${topK}`)

		await this.ensureAvailabilityChecked()
		Logger.info(`RAG Service: Availability checked. isAvailable=${this.isAvailable}`)

		if (!this.isAvailable) {
			Logger.warn("RAG Service: Skipping query, Python not available")
			return []
		}

		Logger.info("RAG Service: Executing Python RAG query...")
		Logger.info(`RAG Service: Using Python: ${this.pythonPath}`)
		try {
			const pythonCode = `
import sys
import json
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')

from ai_hydro.rag import RAGEngine

engine = RAGEngine()
results = engine.query(${JSON.stringify(query)}, ${topK})
print(json.dumps(results))
`
			const stdout = execSync(`${this.pythonPath} -c ${this.escapeShellArg(pythonCode)}`, {
				encoding: "utf8",
				timeout: 15000, // 15 seconds for query operations
				maxBuffer: 1024 * 1024,
			})

			Logger.info(`RAG Service: Python query executed successfully. Output length: ${stdout.length} chars`)
			const results = JSON.parse(stdout.trim())
			Logger.info(`RAG Service: Parsed ${results.length} results from Python`)

			if (results.length > 0) {
				Logger.info(`RAG Service: First result - source: ${results[0].source}, type: ${results[0].type}`)
			}

			return results as RagQueryResult[]
		} catch (error) {
			Logger.error(`RAG Service: Query failed - ${error}`)
			Logger.error(`RAG Service: Error stack: ${error instanceof Error ? error.stack : "N/A"}`)
			return []
		}
	}

	/**
	 * Get CAMELS attribute information
	 * @param attributeName Name of the CAMELS attribute
	 * @returns Attribute metadata or null
	 */
	async getCamelsAttributeInfo(attributeName: string): Promise<any> {
		await this.ensureAvailabilityChecked()

		if (!this.isAvailable) {
			return null
		}

		try {
			const pythonCode = `
import sys
import json
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')

from ai_hydro.rag import RAGEngine

engine = RAGEngine()
result = engine.get_camels_attribute_info(${JSON.stringify(attributeName)})
print(json.dumps(result))
`
			const stdout = execSync(`${this.pythonPath} -c ${this.escapeShellArg(pythonCode)}`, {
				encoding: "utf8",
				timeout: 10000, // 10 seconds for attribute lookup
				maxBuffer: 1024 * 1024,
			})

			return JSON.parse(stdout.trim())
		} catch (error) {
			Logger.error(`RAG Service: Failed to get CAMELS attribute info - ${error}`)
			return null
		}
	}

	/**
	 * Get workflow recommendation based on task description
	 * @param taskDescription Description of the analysis task
	 * @returns Recommended workflow information
	 */
	async getWorkflowRecommendation(taskDescription: string): Promise<WorkflowRecommendation | null> {
		await this.ensureAvailabilityChecked()

		if (!this.isAvailable) {
			return null
		}

		try {
			const pythonCode = `
import sys
import json
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')

from ai_hydro.rag import RAGEngine

engine = RAGEngine()
result = engine.get_workflow_recommendation(${JSON.stringify(taskDescription)})
print(json.dumps(result))
`
			const stdout = execSync(`${this.pythonPath} -c ${this.escapeShellArg(pythonCode)}`, {
				encoding: "utf8",
				timeout: 10000, // 10 seconds for workflow recommendations
				maxBuffer: 1024 * 1024,
			})

			return JSON.parse(stdout.trim()) as WorkflowRecommendation
		} catch (error) {
			Logger.error(`RAG Service: Failed to get workflow recommendation - ${error}`)
			return null
		}
	}

	/**
	 * Search for hydrological concepts
	 * @param concept Hydrological concept or term
	 * @returns List of matching concepts with definitions
	 */
	async searchHydrologicalConcepts(concept: string): Promise<Array<{ concept: string; definition: any }>> {
		await this.ensureAvailabilityChecked()

		if (!this.isAvailable) {
			return []
		}

		try {
			const pythonCode = `
import sys
import json
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')

from ai_hydro.rag import RAGEngine

engine = RAGEngine()
results = engine.search_hydrological_concepts(${JSON.stringify(concept)})
print(json.dumps(results))
`
			const stdout = execSync(`${this.pythonPath} -c ${this.escapeShellArg(pythonCode)}`, {
				encoding: "utf8",
				timeout: 10000, // 10 seconds for concept search
				maxBuffer: 1024 * 1024,
			})

			return JSON.parse(stdout.trim())
		} catch (error) {
			Logger.error(`RAG Service: Failed to search hydrological concepts - ${error}`)
			return []
		}
	}

	/**
	 * Format RAG query results as context for inclusion in agent prompts
	 * Uses the Python engine's enhanced formatting for better guidance
	 */
	formatResultsAsContext(results: RagQueryResult[]): string {
		Logger.info(`RAG Service: formatResultsAsContext() called with ${results?.length || 0} results`)

		if (!results || results.length === 0) {
			Logger.warn("RAG Service: No results to format")
			return ""
		}

		// Call Python's format_context_for_agent method for enhanced formatting
		Logger.info("RAG Service: Calling Python format_context_for_agent...")
		try {
			// Use base64 encoding to safely pass JSON data with newlines to Python
			const jsonString = JSON.stringify(results)
			const base64Results = Buffer.from(jsonString).toString("base64")

			const pythonCode = `
import sys
import json
import base64
sys.path.insert(0, '${this.pythonDir.replace(/\\/g, "/")}')

from ai_hydro.rag import RAGEngine

engine = RAGEngine()
# Decode base64-encoded JSON
results_json = base64.b64decode('${base64Results}').decode('utf-8')
results = json.loads(results_json)
formatted = engine.format_context_for_agent(results)
print(formatted)
`
			const stdout = execSync(`${this.pythonPath} -c ${this.escapeShellArg(pythonCode)}`, {
				encoding: "utf8",
				timeout: 15000, // 15 seconds for context formatting
				maxBuffer: 1024 * 1024,
			})

			const formattedContext = stdout.trim()
			Logger.info(`RAG Service: ✓ Context formatted successfully. Length: ${formattedContext.length} chars`)
			Logger.info(`RAG Service: Context preview: ${formattedContext.substring(0, 200)}...`)
			return formattedContext
		} catch (error) {
			// Fallback to simple formatting if Python call fails
			Logger.warn(`RAG Service: Failed to use enhanced formatting, using fallback - ${error}`)
			Logger.error(`RAG Service: Error stack: ${error instanceof Error ? error.stack : "N/A"}`)

			const contextParts = [
				"\n# AI-Hydro Knowledge Base Context",
				"\nThe following information from the AI-Hydro knowledge base may help with this task:\n",
			]

			for (const result of results) {
				contextParts.push(`\n## ${result.source}: ${result.key}`)
				if (typeof result.content === "string") {
					contextParts.push(result.content)
				} else if (result.content.definition) {
					contextParts.push(result.content.definition)
				} else {
					contextParts.push(JSON.stringify(result.content, null, 2))
				}
			}

			return contextParts.join("\n")
		}
	}

	/**
	 * Check if the RAG service is available
	 * @returns True if Python and RAG engine are available
	 */
	async isRagAvailable(): Promise<boolean> {
		Logger.info("RAG Service: isRagAvailable() called")
		await this.ensureAvailabilityChecked()
		Logger.info(`RAG Service: Returning isAvailable=${this.isAvailable}`)
		return this.isAvailable
	}

	/**
	 * Check if dependencies need to be installed
	 * @returns True if Python is available but dependencies are missing
	 */
	async needsDependencies(): Promise<boolean> {
		await this.ensureAvailabilityChecked()
		return this.needsDependencyInstall
	}

	/**
	 * Get the error message from dependency check
	 * @returns Error message or null
	 */
	async getDependencyError(): Promise<string | null> {
		await this.ensureAvailabilityChecked()
		return this.dependencyCheckError
	}

	/**
	 * Install Python dependencies for the RAG brain
	 * @returns Object with success status and message
	 */
	async installDependencies(): Promise<{ success: boolean; message: string; output: string }> {
		Logger.info("RAG Service: Starting dependency installation...")

		const requirementsPath = path.join(this.pythonDir, "requirements.txt")

		try {
			// Check if requirements.txt exists
			if (!existsSync(requirementsPath)) {
				const error = `requirements.txt not found at ${requirementsPath}`
				Logger.error(`RAG Service: ${error}`)
				return {
					success: false,
					message: error,
					output: "",
				}
			}

			Logger.info(`RAG Service: Installing from ${requirementsPath}...`)

			// Install dependencies using pip
			const installCmd = `${this.pythonPath} -m pip install -r "${requirementsPath}"`
			Logger.info(`RAG Service: Running: ${installCmd}`)

			const output = execSync(installCmd, {
				encoding: "utf8",
				timeout: 120000, // 2 minutes timeout
				maxBuffer: 5 * 1024 * 1024, // 5MB buffer
			})

			Logger.info("RAG Service: Dependency installation completed")
			Logger.info(`RAG Service: Installation output: ${output.substring(0, 500)}...`)

			// Re-check availability
			this.availabilityChecked = false
			this.availabilityCheckPromise = this.checkAvailability()
			await this.ensureAvailabilityChecked()

			if (this.isAvailable) {
				Logger.info("RAG Service: ✓ Dependencies installed successfully, RAG now available")
				return {
					success: true,
					message: "Dependencies installed successfully",
					output,
				}
			} else {
				Logger.warn("RAG Service: Dependencies installed but RAG still not available")
				return {
					success: false,
					message: "Dependencies installed but RAG engine still unavailable",
					output,
				}
			}
		} catch (error: any) {
			const errorMsg = error.message || String(error)
			Logger.error(`RAG Service: Dependency installation failed - ${errorMsg}`)

			// Check for common errors
			let userMessage = "Dependency installation failed"
			if (errorMsg.includes("pip: command not found") || errorMsg.includes("No module named pip")) {
				userMessage = "pip is not installed. Please install pip first."
			} else if (errorMsg.includes("Permission denied") || errorMsg.includes("EACCES")) {
				userMessage = "Permission denied. Try: pip3 install --user -r requirements.txt"
			} else if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
				userMessage = "Installation timed out. Check your internet connection and try again."
			}

			return {
				success: false,
				message: userMessage,
				output: errorMsg,
			}
		}
	}

	/**
	 * Get the path to requirements-rag.txt (RAG-compatible requirements)
	 * @returns Path to requirements-rag.txt
	 */
	getRequirementsPath(): string {
		return path.join(this.pythonDir, "requirements-rag.txt")
	}

	/**
	 * Get workspace root path for virtual environment
	 * Note: Uses vscode.workspace directly - only available when running as VSCode extension
	 * @returns Workspace root path or null if no workspace open
	 */
	async getWorkspaceRoot(): Promise<string | null> {
		// Check if context is available (running as extension)
		if (!this.context) {
			Logger.info("RAG Service: No extension context available")
			return null
		}

		// biome-ignore lint: Workspace folder access required for venv functionality
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			Logger.info("RAG Service: No workspace folders open")
			return null
		}

		// Use the first workspace folder
		const workspaceRoot = workspaceFolders[0].uri.fsPath
		Logger.info(`RAG Service: Detected workspace root: ${workspaceRoot}`)
		return workspaceRoot
	}

	/**
	 * Get workspace information for display to user
	 * @returns Object with workspace details for user confirmation
	 */
	async getWorkspaceEnvInfo(): Promise<{
		workspaceRoot: string | null
		envPath: string | null
		diskSpace: string
		estimatedTime: string
	}> {
		const workspaceRoot = await this.getWorkspaceRoot()

		if (!workspaceRoot) {
			return {
				workspaceRoot: null,
				envPath: null,
				diskSpace: "~800MB",
				estimatedTime: "2-5 minutes",
			}
		}

		const envPath = path.join(workspaceRoot, ".ai-hydro-env")

		return {
			workspaceRoot,
			envPath,
			diskSpace: "~800MB",
			estimatedTime: "2-5 minutes",
		}
	}

	/**
	 * Check if workspace virtual environment exists
	 * @returns True if venv exists and is valid
	 */
	async workspaceVenvExists(): Promise<boolean> {
		const workspaceRoot = await this.getWorkspaceRoot()
		if (!workspaceRoot) {
			return false
		}

		const venvPath = path.join(workspaceRoot, ".ai-hydro-env")
		const venvPythonPath = path.join(venvPath, "bin", "python3")

		const exists = existsSync(venvPythonPath)

		if (exists) {
			Logger.info(`RAG Service: Workspace venv found at ${venvPath}`)
		} else {
			Logger.info(`RAG Service: No workspace venv found at ${venvPath}`)
		}

		return exists
	}

	/**
	 * Check if ai_hydro package is properly installed in venv (not just metadata)
	 * @returns True if package source code is accessible
	 */
	async isPackageProperlyInstalled(): Promise<boolean> {
		const workspaceRoot = await this.getWorkspaceRoot()
		if (!workspaceRoot) {
			return false
		}

		const venvPath = path.join(workspaceRoot, ".ai-hydro-env")
		const venvPythonPath = path.join(venvPath, "bin", "python3")

		if (!existsSync(venvPythonPath)) {
			return false
		}

		try {
			// Try to import actual source code, not just metadata
			const testCode = `
import sys
from ai_hydro.tools.watershed import delineate_watershed
from ai_hydro.rag import RAGEngine
print("OK")
`
			const result = execSync(`"${venvPythonPath}" -c ${this.escapeShellArg(testCode)}`, {
				encoding: "utf8",
				timeout: 30000, // 30 seconds for package verification (includes imports)
			})

			const success = result.trim() === "OK"
			if (success) {
				Logger.info("RAG Service: ✓ ai_hydro package properly installed with source code")
			} else {
				Logger.warn("RAG Service: ai_hydro package installation incomplete")
			}
			return success
		} catch (error: any) {
			Logger.warn(`RAG Service: ai_hydro package not properly installed: ${error.message}`)
			return false
		}
	}

	/**
	 * Reinstall ai_hydro package in existing venv
	 * @returns Object with success status and message
	 */
	async reinstallPackageInVenv(): Promise<{ success: boolean; message: string; output: string }> {
		Logger.info("RAG Service: Reinstalling ai_hydro package in workspace venv...")

		const workspaceRoot = await this.getWorkspaceRoot()
		if (!workspaceRoot) {
			return {
				success: false,
				message: "No workspace folder open",
				output: "",
			}
		}

		const venvPath = path.join(workspaceRoot, ".ai-hydro-env")
		const venvPythonPath = path.join(venvPath, "bin", "python3")

		if (!existsSync(venvPythonPath)) {
			return {
				success: false,
				message: "Virtual environment not found",
				output: "",
			}
		}

		try {
			// Uninstall old package
			Logger.info("RAG Service: Uninstalling old ai-hydro package...")
			try {
				const uninstallCmd = `"${venvPythonPath}" -m pip uninstall -y ai-hydro`
				const uninstallOutput = execSync(uninstallCmd, {
					encoding: "utf8",
					timeout: 30000,
					maxBuffer: 5 * 1024 * 1024,
				})
				Logger.info("RAG Service: Old package uninstalled")
			} catch (uninstallError: any) {
				// Package might not be installed, continue anyway
				Logger.info("RAG Service: No old package to uninstall (or already removed)")
			}

			// Install package in editable mode with fixed pyproject.toml
			Logger.info("RAG Service: Installing ai_hydro package in editable mode...")
			const installCmd = `"${venvPythonPath}" -m pip install -e "${this.pythonDir}"`
			const installOutput = execSync(installCmd, {
				encoding: "utf8",
				timeout: 60000,
				maxBuffer: 5 * 1024 * 1024,
			})

			Logger.info("RAG Service: Package installation complete")

			// Verify installation
			const isInstalled = await this.isPackageProperlyInstalled()
			if (isInstalled) {
				Logger.info("RAG Service: ✓ Package verified successfully")
				return {
					success: true,
					message: "ai_hydro package reinstalled successfully",
					output: installOutput,
				}
			} else {
				Logger.warn("RAG Service: Package installed but verification failed")
				return {
					success: false,
					message: "Package installed but verification failed",
					output: installOutput,
				}
			}
		} catch (error: any) {
			const errorMsg = error.message || String(error)
			Logger.error(`RAG Service: Package reinstallation failed - ${errorMsg}`)
			return {
				success: false,
				message: "Package reinstallation failed",
				output: errorMsg,
			}
		}
	}

	/**
	 * Setup workspace-based virtual environment
	 * @param chatCallback Optional callback to send progress messages to chat
	 * @returns Object with success status and message
	 */
	async setupWorkspaceEnvironment(
		chatCallback?: (message: string) => Promise<void>,
	): Promise<{ success: boolean; message: string; output: string }> {
		Logger.info("RAG Service: Starting workspace environment setup...")

		const workspaceRoot = await this.getWorkspaceRoot()
		if (!workspaceRoot) {
			const error = "No workspace folder open. Please open a workspace first."
			Logger.error(`RAG Service: ${error}`)
			return {
				success: false,
				message: error,
				output: "",
			}
		}

		// Wrap the entire setup process with progress notification
		return await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Setting up AI-Hydro RAG workspace",
				cancellable: false,
			},
			async (progress) => {
				return await this.performWorkspaceSetup(workspaceRoot, progress, chatCallback)
			},
		)
	}

	/**
	 * Internal method to perform the actual workspace setup
	 * Extracted to allow progress reporting
	 */
	private async performWorkspaceSetup(
		workspaceRoot: string,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		chatCallback?: (message: string) => Promise<void>,
	): Promise<{ success: boolean; message: string; output: string }> {
		const venvPath = path.join(workspaceRoot, ".ai-hydro-env")
		this.workspaceVenvPath = venvPath
		this.venvPython = path.join(venvPath, "bin", "python3")

		try {
			// Check if venv already exists
			progress.report({ message: "Checking existing environment...", increment: 10 })
			if (chatCallback) await chatCallback("Checking existing environment...")
			if (await this.workspaceVenvExists()) {
				Logger.info("RAG Service: Workspace venv already exists, checking package installation...")

				// Verify Python works
				const testResult = execSync(`"${this.venvPython}" --version`, {
					encoding: "utf8",
					timeout: 10000, // 10 seconds for version check
				})

				Logger.info(`RAG Service: Existing venv Python version: ${testResult.trim()}`)

				// Update pythonPath to use venv for package checks
				this.pythonPath = this.venvPython

				// Check if ai_hydro package is properly installed
				const isProperlyInstalled = await this.isPackageProperlyInstalled()

				if (!isProperlyInstalled) {
					Logger.info("RAG Service: ai_hydro package not properly installed, reinstalling...")
					const reinstallResult = await this.reinstallPackageInVenv()

					if (!reinstallResult.success) {
						Logger.error("RAG Service: Failed to reinstall package in existing venv")
						return {
							success: false,
							message: `Existing venv found but package reinstallation failed: ${reinstallResult.message}`,
							output: reinstallResult.output,
						}
					}

					Logger.info("RAG Service: ✓ Package reinstalled successfully in existing venv")
				} else {
					Logger.info("RAG Service: ✓ ai_hydro package already properly installed")
				}

				// Re-check availability with venv Python
				this.availabilityChecked = false
				this.availabilityCheckPromise = this.checkAvailability()
				await this.ensureAvailabilityChecked()

				if (this.isAvailable) {
					return {
						success: true,
						message: isProperlyInstalled
							? "Using existing workspace environment"
							: "Updated existing workspace environment with fixed package installation",
						output: testResult,
					}
				} else {
					return {
						success: false,
						message: "Existing venv found but RAG engine still unavailable",
						output: testResult,
					}
				}
			}

			// Create new venv
			progress.report({ message: "Creating virtual environment...", increment: 15 })
			if (chatCallback) await chatCallback("Creating virtual environment...")
			Logger.info(`RAG Service: Creating virtual environment at ${venvPath}...`)
			const createCmd = `python3 -m venv "${venvPath}"`
			const createOutput = execSync(createCmd, {
				encoding: "utf8",
				timeout: 60000, // 1 minute
				maxBuffer: 5 * 1024 * 1024,
			})

			Logger.info("RAG Service: Virtual environment created successfully")

			// Upgrade pip
			progress.report({ message: "Upgrading pip...", increment: 10 })
			if (chatCallback) await chatCallback("Upgrading pip in virtual environment...")
			Logger.info("RAG Service: Upgrading pip in venv...")
			const upgradePipCmd = `"${this.venvPython}" -m pip install --upgrade pip`
			const upgradePipOutput = execSync(upgradePipCmd, {
				encoding: "utf8",
				timeout: 60000,
				maxBuffer: 5 * 1024 * 1024,
			})

			// Install dependencies
			progress.report({ message: "Installing Python dependencies (this may take 2-3 minutes)...", increment: 20 })
			if (chatCallback) await chatCallback("Installing Python dependencies (this may take 2-3 minutes)...")
			Logger.info("RAG Service: Installing dependencies in venv...")
			const requirementsPath = this.getRequirementsPath()
			const installCmd = `"${this.venvPython}" -m pip install -r "${requirementsPath}"`
			const installOutput = execSync(installCmd, {
				encoding: "utf8",
				timeout: 300000, // 5 minutes for heavy dependencies
				maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			})

			Logger.info("RAG Service: Dependencies installed in workspace venv")

			// Install the local ai_hydro package in editable mode
			progress.report({ message: "Installing ai_hydro package...", increment: 20 })
			if (chatCallback) await chatCallback("Installing ai_hydro package...")
			Logger.info("RAG Service: Installing ai_hydro package in venv...")
			const installPackageCmd = `cd "${this.pythonDir}" && "${this.venvPython}" -m pip install -e .`
			const installPackageOutput = execSync(installPackageCmd, {
				encoding: "utf8",
				timeout: 60000,
				maxBuffer: 5 * 1024 * 1024,
				cwd: this.pythonDir,
			})

			Logger.info("RAG Service: ai_hydro package installed successfully")

			// Configure VSCode to use the workspace venv
			progress.report({ message: "Configuring VSCode settings...", increment: 10 })
			if (chatCallback) await chatCallback("Configuring VSCode settings...")
			Logger.info("RAG Service: Configuring VSCode to use workspace venv...")
			const vscodeDir = path.join(workspaceRoot, ".vscode")
			const settingsPath = path.join(vscodeDir, "settings.json")

			// Ensure .vscode directory exists
			if (!existsSync(vscodeDir)) {
				require("fs").mkdirSync(vscodeDir, { recursive: true })
			}

			// Create activation script that deactivates conda first
			const activateScriptPath = path.join(vscodeDir, "activate_venv.sh")
			const activateScript = `#!/bin/bash
# AI-Hydro workspace venv activation script
# This script deactivates conda (if active) before activating the workspace venv

# Deactivate conda if it's currently active
if [ -n "$CONDA_DEFAULT_ENV" ]; then
    echo "Deactivating conda environment: $CONDA_DEFAULT_ENV"
    conda deactivate
fi

# Activate workspace venv
if [ -f "${venvPath}/bin/activate" ]; then
    echo "Activating AI-Hydro workspace environment..."
    source "${venvPath}/bin/activate"
else
    echo "Warning: AI-Hydro venv not found at ${venvPath}"
fi
`
			require("fs").writeFileSync(activateScriptPath, activateScript, { mode: 0o755 })
			Logger.info(`RAG Service: Created activation script at ${activateScriptPath}`)

			// Read existing settings or create new
			let settings: any = {}
			if (existsSync(settingsPath)) {
				const content = require("fs").readFileSync(settingsPath, "utf8")
				try {
					settings = JSON.parse(content)
				} catch (parseError) {
					Logger.warn(`RAG Service: Could not parse existing settings.json, will overwrite: ${parseError}`)
					settings = {}
				}
			}

			// Update Python interpreter path
			settings["python.defaultInterpreterPath"] = this.venvPython

			// Configure terminal to prevent conda auto-activation
			settings["python.terminal.activateEnvironment"] = true
			settings["terminal.integrated.env.osx"] = {
				...(settings["terminal.integrated.env.osx"] || {}),
				CONDA_AUTO_ACTIVATE_BASE: "false",
			}
			settings["terminal.integrated.env.linux"] = {
				...(settings["terminal.integrated.env.linux"] || {}),
				CONDA_AUTO_ACTIVATE_BASE: "false",
			}

			// Add shell initialization args to source our activation script
			const shellArgs = `-c "source ${activateScriptPath} && exec $SHELL"`
			settings["terminal.integrated.shellArgs.osx"] = [shellArgs]
			settings["terminal.integrated.shellArgs.linux"] = [shellArgs]

			// Write back to settings.json
			require("fs").writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
			Logger.info("RAG Service: ✓ VSCode configured to use workspace venv with conda deactivation")

			// Update pythonPath to use venv
			this.pythonPath = this.venvPython

			// Re-check availability
			progress.report({ message: "Verifying installation...", increment: 15 })
			if (chatCallback) await chatCallback("Verifying installation...")
			this.availabilityChecked = false
			this.availabilityCheckPromise = this.checkAvailability()
			await this.ensureAvailabilityChecked()

			if (this.isAvailable) {
				Logger.info("RAG Service: ✓ Workspace environment setup complete, RAG now available")
				return {
					success: true,
					message: "Workspace environment created and dependencies installed successfully",
					output: `${createOutput}\n${upgradePipOutput}\n${installOutput}\n${installPackageOutput}`,
				}
			} else {
				Logger.warn("RAG Service: Workspace environment created but RAG still not available")
				return {
					success: false,
					message: "Workspace environment created but RAG engine still unavailable",
					output: `${createOutput}\n${upgradePipOutput}\n${installOutput}`,
				}
			}
		} catch (error: any) {
			const errorMsg = error.message || String(error)
			Logger.error(`RAG Service: Workspace environment setup failed - ${errorMsg}`)

			// Check for common errors
			let userMessage = "Workspace environment setup failed"
			if (errorMsg.includes("venv: command not found")) {
				userMessage = "Python venv module not available. Please install python3-venv package."
			} else if (errorMsg.includes("Permission denied") || errorMsg.includes("EACCES")) {
				userMessage = "Permission denied. Check workspace folder permissions."
			} else if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
				userMessage = "Installation timed out. Check your internet connection and try again."
			}

			return {
				success: false,
				message: userMessage,
				output: errorMsg,
			}
		}
	}
}
