import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect } from "chai"
import { beforeEach, describe, it } from "mocha"
import { createMapAutoOpen, MAP_AUTO_OPEN_DELAY_MS } from "../mapAutoOpen"

describe("map auto-open beside the chat", () => {
	let enabled: boolean
	let exists: boolean
	let visible: boolean
	let opened: number
	let timers: Array<() => void>
	let failOpen: boolean
	let logged: string[]
	let waits: number[]
	let cleared: unknown[]

	const make = () =>
		createMapAutoOpen({
			enabled: () => enabled,
			mapExists: () => exists,
			sidebarVisible: () => visible,
			open: async () => {
				opened++
				if (failOpen) {
					throw new Error("nope")
				}
			},
			setTimeout: (fn, ms) => {
				timers.push(fn)
				waits.push(ms)
				return fn
			},
			clearTimeout: (h) => {
				cleared.push(h)
				timers = timers.filter((t) => t !== h)
			},
			log: (m) => logged.push(m),
		})
	const flush = async () => {
		const due = timers.splice(0)
		for (const fn of due) {
			fn()
		}
		await new Promise((r) => setImmediate(r))
	}

	beforeEach(() => {
		enabled = true
		exists = false
		visible = true
		opened = 0
		timers = []
		failOpen = false
		logged = []
		waits = []
		cleared = []
	})

	it("opens the map once after a short delay when the sidebar is shown", async () => {
		const a = make()
		a.onSidebarShown()
		expect(opened).to.equal(0) // not synchronously: the chat renders first
		expect(waits).to.deep.equal([MAP_AUTO_OPEN_DELAY_MS])
		await flush()
		expect(opened).to.equal(1)
	})

	it("opens only once per window session, even if the user closed it and the sidebar is shown again", async () => {
		const a = make()
		a.onSidebarShown()
		await flush()
		exists = false // the user closed the map
		a.onSidebarShown()
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(1)
	})

	it("coalesces repeated shows while the delay is pending", async () => {
		const a = make()
		a.onSidebarShown()
		a.onSidebarShown()
		expect(timers).to.have.length(1)
		await flush()
		expect(opened).to.equal(1)
	})

	it("does nothing when the sidebar is hidden, and stays armed for the next show", async () => {
		const a = make()
		visible = false
		a.onSidebarShown()
		expect(timers).to.have.length(0)
		visible = true
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(1)
	})

	it("does not open if the sidebar was hidden again during the delay", async () => {
		const a = make()
		a.onSidebarShown()
		visible = false
		await flush()
		expect(opened).to.equal(0)
		visible = true
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(1)
	})

	it("does nothing when the setting is off", async () => {
		enabled = false
		const a = make()
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(0)
	})

	it("dispose cancels the pending delayed open, and nothing opens afterwards", async () => {
		const a = make()
		a.onSidebarShown()
		a.dispose()
		expect(cleared).to.have.length(1)
		await flush()
		expect(opened).to.equal(0)
		a.onSidebarShown()
		expect(timers).to.have.length(0)
	})

	it("is off if the setting is turned off during the delay", async () => {
		const a = make()
		a.onSidebarShown()
		enabled = false
		await flush()
		expect(opened).to.equal(0)
	})

	it("does not open a duplicate when a map already exists (restored or opened by the user)", async () => {
		exists = true
		const a = make()
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(0)
		exists = false
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(0) // settled: the existing map counts as this window's one open
	})

	it("never fires without a sidebar event (activation alone)", async () => {
		make()
		await flush()
		expect(opened).to.equal(0)
	})

	it("logs and settles if opening fails, rather than retrying on every show", async () => {
		failOpen = true
		const a = make()
		a.onSidebarShown()
		await flush()
		a.onSidebarShown()
		await flush()
		expect(opened).to.equal(1)
		expect(logged).to.have.length(1)
	})
})

describe("aihydro.map.openWithChat contribution", () => {
	it("is a boolean, default on, window scope, and the e2e profile turns it off", async () => {
		const pkg = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8"))
		const prop = pkg.contributes.configuration.properties["aihydro.map.openWithChat"]
		expect(prop.type).to.equal("boolean")
		expect(prop.default).to.equal(true)
		expect(prop.scope).to.equal("window")
		const helpers = await readFile(path.resolve(process.cwd(), "src/test/e2e/utils/helpers.ts"), "utf8")
		expect(helpers).to.match(/"aihydro\.map\.openWithChat":\s*false/)
	})
})
