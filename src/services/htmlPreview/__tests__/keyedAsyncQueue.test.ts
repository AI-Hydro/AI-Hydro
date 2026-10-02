import { expect } from "chai"
import { KeyedAsyncQueue } from "../keyedAsyncQueue"

describe("KeyedAsyncQueue", () => {
	it("preserves call order for one key while allowing another key to proceed", async () => {
		const queue = new KeyedAsyncQueue()
		const calls: string[] = []
		let releaseFirst: (() => void) | undefined
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})

		const first = queue.run("course-a", async () => {
			calls.push("a:first:start")
			await firstGate
			calls.push("a:first:end")
		})
		const second = queue.run("course-a", async () => {
			calls.push("a:second")
		})
		const independent = queue.run("course-b", async () => {
			calls.push("b:first")
		})

		await independent
		expect(calls).to.deep.equal(["a:first:start", "b:first"])
		releaseFirst?.()
		await Promise.all([first, second])
		expect(calls).to.deep.equal(["a:first:start", "b:first", "a:first:end", "a:second"])
	})

	it("continues after a rejected operation", async () => {
		const queue = new KeyedAsyncQueue()
		const failed = queue.run("course-a", async () => {
			throw new Error("expected")
		})
		const recovered = queue.run("course-a", async () => "recovered")
		let failure: unknown
		try {
			await failed
		} catch (error) {
			failure = error
		}
		expect(failure).to.be.instanceOf(Error)
		expect((failure as Error).message).to.equal("expected")
		expect(await recovered).to.equal("recovered")
	})
})
