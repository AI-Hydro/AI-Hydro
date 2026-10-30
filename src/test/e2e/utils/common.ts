import type { Frame, Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToAiHydroWebview = async (_page: Page) => {
	await _page.locator("div:nth-child(4) > span > span").first().click()
	await _page.getByRole("textbox", { name: "The editor is not accessible" }).press("ControlOrMeta+a")

	// The "Add to AI-Hydro" keybinding (aihydro.addToChat, `when: editorHasSelection`). The editor lightbulb only
	// appears in Python, R and notebooks, and this test opens index.html, so the lightbulb is not the path.
	await _page.keyboard.press("ControlOrMeta+'")
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!editorSearchBar.isVisible()) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}

export async function cleanChatView(sidebar: Page | Frame): Promise<Page | Frame> {
	// Verify the help improve banner is visible and can be closed.
	const helpBanner = sidebar.getByText("Help Improve AI-Hydro")
	if (await helpBanner.isVisible()) {
		await sidebar.getByRole("button", { name: "Close banner and enable" }).click()
	}

	// Verify the release banner is visible for new installs and can be closed.
	const releaseBanner = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	if (await releaseBanner.isVisible()) {
		await sidebar.getByTestId("close-button").locator("span").first().click()
	}

	return sidebar
}
