import { expect } from "chai"
import { cleanCommitHash } from "../CheckpointCommitHash"

describe("cleanCommitHash", () => {
	const full = "0123456789abcdef0123456789abcdef01234567"

	it("accepts 7-40 char lowercase hex hashes", () => {
		expect(cleanCommitHash(full)).to.equal(full)
		expect(cleanCommitHash("abc1234")).to.equal("abc1234")
	})

	it("strips the legacy HEAD prefix", () => {
		expect(cleanCommitHash(`HEAD ${full}`)).to.equal(full)
	})

	it("rejects option-like and malformed values", () => {
		for (const bad of [
			"--hard",
			"-abc1234",
			"HEAD --upload-pack=x",
			"HEAD",
			"",
			"abc123",
			`${full}0`,
			"ABCDEF1",
			"abc1234;rm",
			"HEAD~1",
			"main",
			" abc1234",
		]) {
			expect(() => cleanCommitHash(bad), bad).to.throw(/Invalid checkpoint commit hash/)
		}
	})
})
