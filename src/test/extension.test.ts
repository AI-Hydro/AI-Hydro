import { readFile } from "fs/promises"
import { parse } from "jsonc-parser"
import { after, describe, it } from "mocha"
import path from "path"
import "should"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "../registry"

const packagePath = path.join(__dirname, "..", "..", "package.json")
const launchConfigPath = path.join(__dirname, "..", "..", "..", ".vscode", "launch.json")

describe("AI-Hydro Extension", () => {
	after(() => {
		vscode.window.showInformationMessage("All tests done!")
	})

	it("should verify extension ID matches package.json", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const id = packageJSON.publisher + "." + packageJSON.name
		const aihydroExtensionApi = vscode.extensions.getExtension(id)

		aihydroExtensionApi?.id.should.equal(id)
	})

	it("should successfully execute the plus button command", async () => {
		const packageJSON = JSON.parse(await readFile(packagePath, "utf8"))
		const contributedCommands = packageJSON.contributes.commands.map((command: { command: string }) => command.command)

		contributedCommands.should.containEql(ExtensionRegistryInfo.commands.PlusButton)
		await new Promise((resolve) => setTimeout(resolve, 400))
		await vscode.commands.executeCommand(ExtensionRegistryInfo.commands.PlusButton)
	})

	it("should isolate secret storage in every extension development launch", async () => {
		const launchConfig = parse(await readFile(launchConfigPath, "utf8")) as {
			configurations: Array<{ type: string; args?: string[] }>
		}
		const extensionHostConfigurations = launchConfig.configurations.filter(
			(configuration) => configuration.type === "extensionHost",
		)

		extensionHostConfigurations.length.should.be.above(0)
		for (const configuration of extensionHostConfigurations) {
			should.exist(configuration.args)
			configuration.args?.should.containEql("--password-store=basic")
			configuration.args?.should.containEql("--use-inmemory-secretstorage")
		}
	})

	// New test to verify xvfb and webview functionality
	it("should create and display a webview panel", async () => {
		// Create a webview panel
		const panel = vscode.window.createWebviewPanel("testWebview", "CI/CD Test", vscode.ViewColumn.One, {
			enableScripts: true,
		})

		// Set some HTML content
		panel.webview.html = `
			<!DOCTYPE html>
			<html>
				<head>
					<meta charset="UTF-8">
					<title>xvfb Test</title>
				</head>
				<body>
					<div id="test">Testing xvfb display server</div>
				</body>
			</html>
		`

		// Verify panel exists
		should.exist(panel)
		panel.visible.should.be.true()

		// Clean up
		panel.dispose()
	})

	// Test webview message passing
	it("should handle webview messages", async () => {
		const panel = vscode.window.createWebviewPanel("testWebview", "Message Test", vscode.ViewColumn.One, {
			enableScripts: true,
		})

		// Set up message handling
		const messagePromise = new Promise<string>((resolve) => {
			panel.webview.onDidReceiveMessage((message) => resolve(message.text), undefined)
		})

		// Add message sending script
		panel.webview.html = `
			<!DOCTYPE html>
			<html>
				<head>
					<meta charset="UTF-8">
					<title>Message Test</title>
				</head>
				<body>
					<script>
						const vscode = acquireVsCodeApi();
						vscode.postMessage({ text: 'test-message' });
					</script>
				</body>
			</html>
		`

		// Wait for message
		const message = await messagePromise
		message.should.equal("test-message")

		// Clean up
		panel.dispose()
	})
})
