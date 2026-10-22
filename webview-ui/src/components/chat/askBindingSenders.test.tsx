import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const askResponse = vi.fn()
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { askResponse: (...a: unknown[]) => askResponse(...a) } }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: any) => (
		<button onClick={onClick} type="button">
			{children}
		</button>
	),
}))
vi.mock("@/components/common/VSCodeButtonLink", () => ({ default: ({ children }: any) => <a href="#x">{children}</a> }))
vi.mock("@/components/common/CodeBlock", () => ({ CODE_BLOCK_BG_COLOR: "#000" }))

import CreditLimitError from "./CreditLimitError"
import { STALE_ASK_NOTICE } from "./chat-view/askBinding"
import { OptionsButtons } from "./OptionsButtons"

describe("remaining ask senders are bound to their ask ts (W2-E1 B2)", () => {
	beforeEach(() => {
		askResponse.mockReset()
		askResponse.mockResolvedValue({})
	})

	it("an option click sends the followup's own ts", async () => {
		render(<OptionsButtons askTs={321} isActive options={["yes please"]} />)
		fireEvent.click(screen.getByText("yes please"))
		await waitFor(() => expect(askResponse).toHaveBeenCalledTimes(1))
		expect(askResponse.mock.calls[0][0]).toMatchObject({ responseType: "messageResponse", text: "yes please", askTs: 321 })
	})

	it("an old followup option clicked while a new approval is pending comes back stale and says so", async () => {
		askResponse.mockResolvedValue({ stale: true })
		render(<OptionsButtons askTs={321} isActive options={["yes please"]} />)
		expect(screen.getByTestId("options-stale-notice").textContent).toBe("")
		fireEvent.click(screen.getByText("yes please"))
		await waitFor(() => expect(screen.getByTestId("options-stale-notice").textContent).toBe(STALE_ASK_NOTICE))
	})

	it("Retry on a credit-limit error sends the api_req_failed ask's ts", async () => {
		render(<CreditLimitError askTs={555} currentBalance={0} message="out of credits" />)
		fireEvent.click(screen.getByText("Retry Request"))
		await waitFor(() => expect(askResponse).toHaveBeenCalledTimes(1))
		expect(askResponse.mock.calls[0][0]).toMatchObject({ responseType: "yesButtonClicked", askTs: 555 })
	})

	it("an old credit-limit Retry comes back stale and shows the notice", async () => {
		askResponse.mockResolvedValue({ stale: true })
		render(<CreditLimitError askTs={555} currentBalance={0} message="out of credits" />)
		fireEvent.click(screen.getByText("Retry Request"))
		await waitFor(() => expect(screen.getByTestId("credit-stale-notice").textContent).toBe(STALE_ASK_NOTICE))
	})
})
