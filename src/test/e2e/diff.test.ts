import { expect } from "@playwright/test"
import { cleanChatView } from "./utils/common"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Diff Editor", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ page, sidebar }) => {
			await sidebar.getByRole("button", { name: "Get Started for Free" }).click({ delay: 100 })
			// Submit a message
			await cleanChatView(page)

			const inputbox = sidebar.getByTestId("chat-input")
			await expect(inputbox).toBeVisible()

			await inputbox.fill("Hello, AI-Hydro!")
			await expect(inputbox).toHaveValue("Hello, AI-Hydro!")
			await sidebar.getByTestId("send-button").click({ delay: 100 })
			await expect(inputbox).toHaveValue("")

			// Loading State initially
			await expect(sidebar.getByText("API Request...")).toBeVisible()

			// Back to home page with history
			await sidebar.getByRole("button", { name: "Start New Task" }).click()
			await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
			await expect(sidebar.getByText("Hello, AI-Hydro!")).toBeVisible() // History with the previous sent message
			await expect(sidebar.getByText("Tokens:")).toBeVisible() // History with token usage

			// Submit a file edit request
			await sidebar.getByTestId("chat-input").click()
			await sidebar.getByTestId("chat-input").fill("edit_request")
			await sidebar.getByTestId("send-button").click({ delay: 50 })

			// Wait for the sidebar to load the file edit request
			await sidebar.waitForSelector('span:has-text("AI-Hydro wants to edit this file:")')

			// AI-Hydro Diff Editor should open with the file name and diff
			await expect(page.getByText("test.ts: Original ↔ AI-Hydro's")).toBeVisible()

			// Diff editor should show the original and modified content
			const diffEditor = page.locator(
				".monaco-editor.modified-in-monaco-diff-editor > .overflow-guard > .monaco-scrollable-element.editor-scrollable > .lines-content > div:nth-child(4)",
			)
			await diffEditor.click()
			await expect(diffEditor).toBeVisible()

			await page.close()
		})
	})
})
