import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// The outer bound includes VS Code fixtures and provider stabilization. The
// request-arrival and rendered-response phases retain their tighter bounds.
e2e.setTimeout(240_000)

e2e("Chat - can send messages and switch between modes", async ({ helper, sidebar, page, server }) => {
	if (!server) {
		throw new Error("The deterministic loopback API server did not start")
	}

	// Sign in
	await helper.signin(sidebar)

	// Submit a message
	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Hello, AI-Hydro!")
	await expect(inputbox).toHaveValue("Hello, AI-Hydro!")
	const generationBefore = server.generationCounter
	await sidebar.getByTestId("send-button").click({ delay: 100 })
	await expect(inputbox).toHaveValue("")

	// On loaded Windows hosts, task initialization can take longer than the
	// response render itself. Prove the request reached the deterministic
	// loopback provider before asserting its stable rendered response.
	await expect.poll(() => server.generationCounter, { timeout: 60_000 }).toBeGreaterThan(generationBefore)
	await expect(sidebar.getByText("Hello! I'm a mock AI-Hydro API response.").first()).toBeVisible({
		timeout: 30_000,
	})

	// Starting a new task should clear the current chat view and show the recent tasks
	await sidebar.getByRole("button", { name: "Start a New Task", exact: true }).click()
	await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
	await expect(sidebar.getByText("Hello, AI-Hydro!")).toBeVisible()

	// Makes sure the act and plan switches are working correctly
	// Aria-checked state should be true for Act and false for Plan
	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })

	await expect(actButton).toBeChecked()
	await expect(planButton).not.toBeChecked()

	await actButton.click()
	await expect(actButton).not.toBeChecked()
	await expect(planButton).toBeChecked()

	// === slash commands preserve following text ===
	await expect(inputbox).toHaveValue("")
	// Type partial slash command to trigger menu
	await inputbox.pressSequentially("/new", { delay: 100 })

	// Wait for menu to be visible and select first option with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("/newtask ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("/newtask following text should be preserved")

	// === @ mentions preserve following text ===
	await inputbox.fill("")
	await expect(inputbox).toHaveValue("")

	// Type partial @ mention to trigger menu
	await inputbox.pressSequentially("@prob")

	// Wait for menu to be visible and select first option with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("@problems ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("@problems following text should be preserved")

	await page.close()
})
