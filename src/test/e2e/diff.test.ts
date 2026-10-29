import { expect } from "@playwright/test"
import { cleanChatView } from "./utils/common"
import { acceptStopRunningChatModal, E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// This flow performs two independently bounded provider turns after VS Code
// fixtures and provider stabilization; keep the outer budget larger than the
// sum of those phase-specific bounds.
e2e.setTimeout(300_000)

e2e.describe("Diff Editor", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, page, sidebar, server }) => {
			if (!server) {
				throw new Error("The deterministic loopback API server did not start")
			}

			await helper.signin(sidebar)
			// Submit a message
			await cleanChatView(sidebar)

			const inputbox = sidebar.getByTestId("chat-input")
			await expect(inputbox).toBeVisible()

			await inputbox.fill("Hello, AI-Hydro!")
			await expect(inputbox).toHaveValue("Hello, AI-Hydro!")
			const initialGeneration = server.generationCounter
			await sidebar.getByTestId("send-button").click({ delay: 100 })
			await expect(inputbox).toHaveValue("")

			// Prove the request reached the deterministic loopback provider before
			// asserting the stable response rather than a transient loading frame.
			await expect.poll(() => server.generationCounter, { timeout: 60_000 }).toBeGreaterThan(initialGeneration)
			await expect(sidebar.getByText("Hello! I'm a mock AI-Hydro API response.").first()).toBeVisible({
				timeout: 30_000,
			})

			// Back to home page with history
			await sidebar.getByRole("button", { name: "New task", exact: true }).click()
			await acceptStopRunningChatModal(page)
			await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
			await expect(sidebar.getByText("Hello, AI-Hydro!")).toBeVisible() // History with the previous sent message
			const historyCard = sidebar.getByRole("article").filter({ hasText: "Hello, AI-Hydro!" })
			await historyCard.getByRole("button", { name: "Usage" }).click()
			const usage = historyCard.getByRole("region", { name: "Usage" })
			await expect(usage.getByText("Tokens in", { exact: true })).toBeVisible() // Input and output token counts
			await expect(usage.getByText("Tokens out", { exact: true })).toBeVisible()

			// Submit a file edit request
			await sidebar.getByTestId("chat-input").click()
			await sidebar.getByTestId("chat-input").fill("edit_request")
			const editGeneration = server.generationCounter
			await sidebar.getByTestId("send-button").click({ delay: 50 })

			await expect.poll(() => server.generationCounter, { timeout: 60_000 }).toBeGreaterThan(editGeneration)
			await expect(sidebar.getByText("AI-Hydro wants to edit this file:")).toBeVisible({
				timeout: 30_000,
			})

			// The edit is approved on its own card (W2-E2): Save is inline and the footer carries no actions.
			await expect(sidebar.getByTestId("inline-approval").getByRole("button", { name: "Save" })).toBeVisible()
			await expect(sidebar.getByTestId("footer-actions")).toHaveCount(0)

			// AI-Hydro Diff Editor should open with the file name and diff
			await expect(page.getByText("test.ts: Original ↔ AI-Hydro's Changes (Editable)")).toBeVisible({
				timeout: 30_000,
			})

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
