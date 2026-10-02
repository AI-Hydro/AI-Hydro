#!/usr/bin/env node

import { Writable } from "node:stream"
import { finished } from "node:stream/promises"
import archiver from "archiver"
import { Project } from "ts-morph"

let archiveBytes = 0
const sink = new Writable({
	write(chunk, _encoding, callback) {
		archiveBytes += chunk.length
		callback()
	},
})
const archive = archiver("zip")
archive.pipe(sink)
archive.append("build-tool-smoke", { name: "smoke.txt" })
await archive.finalize()
await finished(sink)

if (archiveBytes <= 0) {
	throw new Error("archiver build-tool smoke produced no ZIP bytes")
}

const project = new Project({ useInMemoryFileSystem: true })
project.createSourceFile("smoke.ts", "export const ok = true")
if (project.getSourceFiles().length !== 1) {
	throw new Error("ts-morph build-tool smoke failed")
}

console.log(`Build-tool smoke passed: archiver produced ${archiveBytes} bytes and ts-morph parsed one source file.`)
