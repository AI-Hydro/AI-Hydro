import { describe, expect, it } from "vitest"
import { ErrorBlockTitle } from "../ErrorBlockTitle"

describe("ErrorBlockTitle", () => {
	it("should return icon and title for API request cancelled", () => {
		const [icon, title] = ErrorBlockTitle({
			apiReqCancelReason: "user_cancelled",
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for completed API request", () => {
		const [icon, title] = ErrorBlockTitle({
			cost: 0.001,
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for failed API request", () => {
		const [icon, title] = ErrorBlockTitle({
			apiRequestFailedMessage: "Request failed",
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for retry status", () => {
		const [icon, title] = ErrorBlockTitle({
			retryStatus: {
				attempt: 2,
				maxAttempts: 3,
				delaySec: 5,
			},
		})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})

	it("should return icon and title for default API request", () => {
		const [icon, title] = ErrorBlockTitle({})

		expect(icon).toBeDefined()
		expect(title).toBeDefined()
	})
})

describe("ErrorBlockTitle colour", () => {
	it("does not paint a finished API request green", () => {
		const [icon] = ErrorBlockTitle({ cost: 0.001 })
		expect(JSON.stringify(icon.props)).not.toMatch(/charts-green|success/)
	})
})
