import { expect } from "chai"
import * as fs from "fs/promises"
import { after, afterEach, before, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { saveOpenDocumentIfDirty } from "@/hosts/vscode/hostbridge/workspace/saveOpenDocumentIfDirty"
import { SaveOpenDocumentIfDirtyRequest } from "@/shared/proto/index.host"

/**
 * On Windows, VS Code (its file watcher, the text-file model, antivirus) can still hold a file for a moment after the
 * editor that showed it is closed, so a write or delete straight after fails with EBUSY/EPERM/EACCES. Retry only those,
 * with a bounded backoff (about 3s in all); any other error, and the last one, is thrown.
 */
const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES"])
async function withFsRetry<T>(op: () => Promise<T>): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await op()
		} catch (error) {
			if (attempt >= 8 || !RETRYABLE.has((error as NodeJS.ErrnoException).code ?? "")) {
				throw error
			}
			await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 800)))
		}
	}
}
const writeFileRetry = (file: string, data: string) => withFsRetry(() => fs.writeFile(file, data))

describe("saveOpenDocumentIfDirty Integration Test", () => {
	let testWorkspaceRoot: string
	let testFilePath: string
	let testFileUri: vscode.Uri
	let testCounter = 0

	before(async () => {
		// Use a temporary directory for tests
		testWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-test-"))
	})

	after(async () => {
		// Clean up: close all editors and delete test directory
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
		try {
			await fs.rm(testWorkspaceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
		} catch (_error) {
			// Directory might not exist, ignore
		}
	})

	beforeEach(async () => {
		// Close all editors before each test
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
		// A fresh path per test: a file an earlier test saved and VS Code may still hold is never rewritten.
		testFilePath = path.join(testWorkspaceRoot, `test-save-document-${++testCounter}.txt`)
		testFileUri = vscode.Uri.file(testFilePath)
	})

	afterEach(async () => {
		// Release the document before the next test (and the final cleanup) touches the directory.
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
	})

	it("should save a dirty document and return wasSaved: true", async () => {
		// Create a test file with initial content
		await writeFileRetry(testFilePath, "Initial content")

		// Open the document in VSCode
		const document = await vscode.workspace.openTextDocument(testFileUri)
		const editor = await vscode.window.showTextDocument(document)

		// Make the document dirty by editing it
		await editor.edit((editBuilder) => {
			editBuilder.insert(new vscode.Position(0, 0), "Modified ")
		})

		// Verify the document is dirty
		expect(document.isDirty).to.be.true

		// Call saveOpenDocumentIfDirty
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: testFilePath,
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.true

		// Verify the document is no longer dirty
		expect(document.isDirty).to.be.false

		// Verify the file content was saved
		const savedContent = await fs.readFile(testFilePath, "utf-8")
		expect(savedContent).to.equal("Modified Initial content")
	})

	it("should not save a clean document and return empty response", async () => {
		// Create a test file
		await writeFileRetry(testFilePath, "Clean content")

		// Open the document in VSCode
		const document = await vscode.workspace.openTextDocument(testFileUri)
		await vscode.window.showTextDocument(document)

		// Verify the document is not dirty
		expect(document.isDirty).to.be.false

		// Call saveOpenDocumentIfDirty
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: testFilePath,
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.undefined

		// Verify the document is still not dirty
		expect(document.isDirty).to.be.false
	})

	it("should return empty response when document is not open", async () => {
		// Ensure no documents are open
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")

		// Call saveOpenDocumentIfDirty with a non-existent file
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: path.join(testWorkspaceRoot, "non-existent-file.txt"),
		})
		const response = await saveOpenDocumentIfDirty(request)

		// Verify the response
		expect(response.wasSaved).to.be.undefined
	})

	it("should handle multiple open documents and save only the specified one", async () => {
		// Create multiple test files
		const testFile1 = path.join(testWorkspaceRoot, "test-file-1.txt")
		const testFile2 = path.join(testWorkspaceRoot, "test-file-2.txt")
		const testFile3 = path.join(testWorkspaceRoot, "test-file-3.txt")

		await writeFileRetry(testFile1, "File 1 content")
		await writeFileRetry(testFile2, "File 2 content")
		await writeFileRetry(testFile3, "File 3 content")

		try {
			// Open all documents
			const doc1 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile1))
			const doc2 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile2))
			const doc3 = await vscode.workspace.openTextDocument(vscode.Uri.file(testFile3))

			// Edit all documents to make them dirty
			const editor1 = await vscode.window.showTextDocument(doc1)
			await editor1.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			const editor2 = await vscode.window.showTextDocument(doc2)
			await editor2.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			const editor3 = await vscode.window.showTextDocument(doc3)
			await editor3.edit((editBuilder) => {
				editBuilder.insert(new vscode.Position(0, 0), "Modified ")
			})

			// Verify all documents are dirty
			expect(doc1.isDirty).to.be.true
			expect(doc2.isDirty).to.be.true
			expect(doc3.isDirty).to.be.true

			// Save only the second document
			const request = SaveOpenDocumentIfDirtyRequest.create({
				filePath: testFile2,
			})
			const response = await saveOpenDocumentIfDirty(request)

			// Verify the response
			expect(response.wasSaved).to.be.true

			// Verify only doc2 was saved
			expect(doc1.isDirty).to.be.true
			expect(doc2.isDirty).to.be.false
			expect(doc3.isDirty).to.be.true

			// Verify the file content
			const savedContent = await fs.readFile(testFile2, "utf-8")
			expect(savedContent).to.equal("Modified File 2 content")
		} finally {
			// Clean up
			await vscode.commands.executeCommand("workbench.action.closeAllEditors")
			for (const file of [testFile1, testFile2, testFile3]) {
				await withFsRetry(() => fs.unlink(file)).catch(() => {})
			}
		}
	})

	it("should handle empty file path gracefully", async () => {
		const request = SaveOpenDocumentIfDirtyRequest.create({
			filePath: "",
		})
		const response = await saveOpenDocumentIfDirty(request)

		expect(response.wasSaved).to.be.undefined
	})

	it("should handle undefined file path gracefully", async () => {
		const request = SaveOpenDocumentIfDirtyRequest.create({})
		const response = await saveOpenDocumentIfDirty(request)

		expect(response.wasSaved).to.be.undefined
	})
})
