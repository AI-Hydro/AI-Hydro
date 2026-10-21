import { expect } from "@playwright/test"
import { cleanChatView } from "./utils/common"
import { e2e } from "./utils/helpers"

// One turn makes four provider requests (three file reads, then the answer) after VS Code fixtures and provider
// stabilization; keep the outer budget larger than the sum of the phase-specific bounds.
e2e.setTimeout(300_000)

e2e("Chat transcript - three reads fold into one work group at Normal detail", async ({ helper, sidebar, server }) => {
	if (!server) {
		throw new Error("The deterministic loopback API server did not start")
	}

	await helper.signin(sidebar)
	await cleanChatView(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("read_three_files")
	const generationBefore = server.generationCounter
	await sidebar.getByTestId("send-button").click({ delay: 100 })
	await expect(inputbox).toHaveValue("")
	await expect.poll(() => server.generationCounter, { timeout: 60_000 }).toBeGreaterThan(generationBefore)

	// The answer is prose at the top level.
	await expect(sidebar.getByText("This is a mock answer, not a result.").first()).toBeVisible({ timeout: 60_000 })

	// One group line for the three reads, by its accessible name and visible text.
	const header = sidebar.getByRole("button", { name: /Ran 3 tools/ })
	await expect(header).toHaveCount(1)
	await expect(header).toContainText("3 tools")
	await expect(header).toHaveAttribute("aria-expanded", "false")

	// None of the per-request machinery is on screen at Normal.
	await expect(sidebar.getByText("API Request")).toHaveCount(0)
	await expect(sidebar.locator(".transcript-call")).toHaveCount(0)

	// Expanding shows one line per call.
	await header.click()
	await expect(header).toHaveAttribute("aria-expanded", "true")
	await expect(sidebar.locator(".transcript-call")).toHaveCount(3)
	await header.click()
	await expect(sidebar.locator(".transcript-call")).toHaveCount(0)
})
