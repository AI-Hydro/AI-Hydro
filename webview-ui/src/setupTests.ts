import "@testing-library/jest-dom"
import { vi } from "vitest"

// "Official" jest workaround for mocking window.matchMedia()
// https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(), // Deprecated
		removeListener: vi.fn(), // Deprecated
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

// react-use's useSize measures through a hidden iframe and re-measures on a 35 ms setTimeout it never clears. Under load that
// timer fires after a test ends: it re-renders a still-mounted row once the test's mocks are gone, or after jsdom is torn down,
// and vitest reports unhandled errors although every test passed. No test reads the measured size, so tests get react-use's
// own non-browser branch (the element as given, size Infinity): no iframe, no timer.
vi.mock("react-use", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-use")>()
	return {
		...actual,
		useSize: (element: unknown, { width = Infinity, height = Infinity }: { width?: number; height?: number } = {}) => [
			typeof element === "function" ? element({ width, height }) : element,
			{ width, height },
		],
	}
})

// Mock VSCode API for webview tests
vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: vi.fn(),
	getState: vi.fn(),
	setState: vi.fn(),
}))
