import { expect } from "chai"
import { DEFAULT_AI_HYDRO_RANGE, PackConfigError, parsePackConfig } from "../packConfig"

function parse(value: unknown) {
	return parsePackConfig(Buffer.from(JSON.stringify(value)))
}

const MINIMAL = { schemaVersion: 1, packId: "aihydro.demo", version: "1.0.0", edition: "student", publisher: { name: "P" } }

describe("pack.config.json", () => {
	it("accepts the minimal config and fills the documented defaults", () => {
		const config = parse(MINIMAL)
		expect(config.aiHydroRange).to.equal(DEFAULT_AI_HYDRO_RANGE)
		expect(DEFAULT_AI_HYDRO_RANGE).to.equal(">=0.4.0 <0.5.0")
		expect(config.localPython).to.equal("terminal-equivalent")
		expect(config.environment).to.deep.equal({ python: ">=3.11", requiredImports: [] })
		expect(config.idMap).to.deep.equal({})
		expect(config.files).to.deep.equal([])
	})

	it("fails closed on an unknown key, at the top level and nested", () => {
		expect(() => parse({ ...MINIMAL, packID: "typo" })).to.throw(PackConfigError, /additional properties \(packID\)/)
		expect(() => parse({ ...MINIMAL, publisher: { name: "P", keyId: "sha256:00" } })).to.throw(PackConfigError, /keyId/)
		expect(() => parse({ ...MINIMAL, environment: { python: ">=3.11", extras: [] } })).to.throw(PackConfigError, /extras/)
		expect(() => parse({ ...MINIMAL, files: [{ source: "a", dest: "assets/a", mode: 1 }] })).to.throw(PackConfigError, /mode/)
	})

	it("rejects wrong types, duplicate keys, a BOM and invalid JSON", () => {
		expect(() => parse({ ...MINIMAL, version: 1 })).to.throw(PackConfigError)
		expect(() => parsePackConfig(Buffer.from('{"schemaVersion":1,"schemaVersion":1}'))).to.throw(
			PackConfigError,
			/duplicate key/,
		)
		expect(() => parsePackConfig(Buffer.from("﻿{}"))).to.throw(PackConfigError, /BOM/)
		expect(() => parsePackConfig(Buffer.from("{ // comment\n}"))).to.throw(PackConfigError)
		expect(() => parse({ ...MINIMAL, schemaVersion: 2 })).to.throw(PackConfigError)
	})

	it("validates IDs, SemVer and the compatibility range", () => {
		expect(() => parse({ ...MINIMAL, packId: "Bad_Id" })).to.throw(PackConfigError, /packId/)
		expect(() => parse({ ...MINIMAL, version: "not-semver" })).to.throw(PackConfigError, /SemVer/)
		expect(() => parse({ ...MINIMAL, aiHydroRange: "not a range" })).to.throw(PackConfigError, /range/)
		expect(() => parse({ ...MINIMAL, idMap: { a: "Has Space" } })).to.throw(PackConfigError, /idMap target/)
		expect(() => parse({ ...MINIMAL, idPrefix: "Upper." })).to.throw(PackConfigError, /idPrefix/)
	})

	it("confines extra files to the allowed pack roots and refuses the generated environment file", () => {
		for (const dest of [
			"modules/x/module.html",
			"../assets/x",
			"assets/../x",
			"assets",
			"/assets/x",
			"assets\\x",
			"environments/environment.json",
		]) {
			expect(() => parse({ ...MINIMAL, files: [{ source: "x", dest }] }), dest).to.throw(PackConfigError)
		}
		expect(() =>
			parse({
				...MINIMAL,
				files: [
					{ source: "x", dest: "assets/a" },
					{ source: "y", dest: "assets/a" },
				],
			}),
		).to.throw(PackConfigError, /duplicate dest/)
		expect(parse({ ...MINIMAL, files: [{ source: "d/x.csv", dest: "datasets/x.csv" }] }).files).to.have.length(1)
	})
})
