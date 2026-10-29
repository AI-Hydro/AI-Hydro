import { expect } from "chai"
import { describe, it } from "mocha"
import type { ITelemetryProvider, TelemetryProperties } from "../providers/ITelemetryProvider"
import { CHAT_TEXT_KEYS, TelemetryService, withoutChatText } from "../TelemetryService"

/**
 * X1-P2: chat titles and descriptions never leave the machine through telemetry (PSMH §9). The exclusion is enforced at
 * the one place every event passes through, and these tests drive every `capture*` method the service has.
 */
const TITLE = "SENTINEL_TITLE_TEXT"
const DESC = "SENTINEL_DESCRIPTION_TEXT"

function recorder() {
	const events: Array<{ event: string; properties?: TelemetryProperties; required: boolean }> = []
	const provider = {
		log: (event: string, properties?: TelemetryProperties) => events.push({ event, properties, required: false }),
		logRequired: (event: string, properties?: TelemetryProperties) => events.push({ event, properties, required: true }),
		identifyUser: (_u: unknown, properties?: TelemetryProperties) =>
			events.push({ event: "identify", properties, required: false }),
		setOptIn: () => {},
		isEnabled: () => true,
		getSettings: () => ({ extensionEnabled: true, hostEnabled: true }),
		dispose: async () => {},
	} as unknown as ITelemetryProvider
	return { provider, events }
}

function keysDeep(value: unknown, depth = 0): string[] {
	if (depth > 8 || value === null || typeof value !== "object") {
		return []
	}
	if (Array.isArray(value)) {
		return value.flatMap((v) => keysDeep(v, depth + 1))
	}
	return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...keysDeep(v, depth + 1)])
}

const METADATA = {
	extension_version: "0.0.0",
	platform: "test",
	platform_version: "1",
	os_type: "test",
	os_version: "1",
	is_dev: "",
}

describe("X1-P2 telemetry excludes chat titles and descriptions", () => {
	it("strips title, description and their siblings from any property bag, at any depth, without touching other keys", () => {
		const out = withoutChatText({
			ulid: "u1",
			title: TITLE,
			description: DESC,
			titleSource: "user",
			userQuestion: "q",
			nested: { title: TITLE, kept: 1, deeper: [{ description: DESC, kept: true }] },
		}) as Record<string, unknown>
		expect(JSON.stringify(out)).to.not.contain(TITLE)
		expect(JSON.stringify(out)).to.not.contain(DESC)
		expect(out).to.deep.equal({ ulid: "u1", nested: { kept: 1, deeper: [{ kept: true }] } })
		expect([...CHAT_TEXT_KEYS]).to.include.members(["title", "description"])
	})

	it("capture() and captureRequired() send no title or description, even when a caller passes them", () => {
		const { provider, events } = recorder()
		const service = new TelemetryService([provider], METADATA)
		events.length = 0
		service.capture({ event: "x.y", properties: { ulid: "u1", title: TITLE, description: DESC, item: { title: TITLE } } })
		service.captureRequired("x.z", { title: TITLE, description: DESC })
		expect(events).to.have.length(2)
		for (const e of events) {
			expect(JSON.stringify(e.properties)).to.not.contain(TITLE)
			expect(JSON.stringify(e.properties)).to.not.contain(DESC)
			expect(keysDeep(e.properties)).to.not.include.members(["title", "description"])
		}
		// the rest of the payload is intact
		expect(events[0].properties).to.deep.include({ ulid: "u1", extension_version: "0.0.0" })
	})

	it("no capture* method the service has sends a title or description key, whatever it is given", () => {
		const names = Object.getOwnPropertyNames(TelemetryService.prototype).filter(
			(n) => n.startsWith("capture") && typeof (TelemetryService.prototype as any)[n] === "function",
		)
		expect(names.length).to.be.greaterThan(20)
		const argSets: Array<(n: number) => unknown[]> = [
			(n) => Array.from({ length: Math.max(n, 6) }, () => TITLE),
			(n) =>
				Array.from({ length: Math.max(n, 6) }, () => ({
					title: TITLE,
					description: DESC,
					titleSource: "user",
					nested: { title: TITLE },
				})),
			(n) => Array.from({ length: Math.max(n, 6) }, (_, i) => (i % 2 ? { title: TITLE, description: DESC } : 3)),
		]
		let sent = 0
		for (const name of names) {
			for (const args of argSets) {
				const { provider, events } = recorder()
				const service = new TelemetryService([provider], METADATA)
				events.length = 0
				try {
					;(service as any)[name](...args((service as any)[name].length))
				} catch {
					// a method that needs a particular shape of argument is not the point
				}
				for (const e of events) {
					sent++
					expect(keysDeep(e.properties), `${name} -> ${e.event}`).to.not.include.members(["title"])
					expect(keysDeep(e.properties), `${name} -> ${e.event}`).to.not.include.members(["description"])
					// The object-shaped sentinels only ever appear under those keys, so they must not be in the payload at all.
					expect(JSON.stringify(e.properties), `${name} -> ${e.event}`).to.not.contain(DESC)
				}
			}
		}
		expect(sent).to.be.greaterThan(40)
	})
})
