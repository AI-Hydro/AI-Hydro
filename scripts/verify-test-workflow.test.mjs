import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "test.yml")

function readPackageScripts(directory) {
	const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, directory, "package.json"), "utf8"))
	return packageJson.scripts ?? {}
}

function extractRunBlocks(workflow) {
	const lines = workflow.split("\n")
	const blocks = []

	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^(\s*)run:\s*(.*)$/)
		if (!match) {
			continue
		}
		if (!["|", ">"].includes(match[2])) {
			blocks.push(match[2])
			continue
		}

		const indentation = match[1].length
		const blockLines = []
		while (index + 1 < lines.length) {
			const next = lines[index + 1]
			if (next.trim() !== "" && next.match(/^\s*/)[0].length <= indentation) {
				break
			}
			blockLines.push(next.trim())
			index += 1
		}
		blocks.push(blockLines.join("\n"))
	}

	return blocks
}

test("the core test workflow invokes package scripts from the effective directory", () => {
	const workflow = fs.readFileSync(workflowPath, "utf8")
	const manifests = new Map([
		[".", readPackageScripts(".")],
		["webview-ui", readPackageScripts("webview-ui")],
	])
	const invocations = []

	assert.doesNotMatch(
		workflow,
		/^\s*working-directory:/m,
		"workflow contract checker must be extended before using working-directory",
	)

	for (const block of extractRunBlocks(workflow)) {
		let directory = "."
		for (const command of block.split(/\n|&&/).map((part) => part.trim())) {
			const changeDirectory = command.match(/^cd\s+(\S+)$/)
			if (changeDirectory) {
				assert.ok(manifests.has(changeDirectory[1]), `unsupported workflow directory: ${changeDirectory[1]}`)
				directory = changeDirectory[1]
				continue
			}

			for (const match of command.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
				invocations.push({ directory, script: match[1] })
			}
		}
	}

	const missingScripts = invocations
		.filter(({ directory, script }) => manifests.get(directory)?.[script] === undefined)
		.map(({ directory, script }) => `${directory}/${script}`)

	assert.ok(invocations.length > 0, "expected the core test workflow to invoke package scripts")
	assert.deepEqual(missingScripts, [], `workflow invokes undeclared package scripts: ${missingScripts.join(", ")}`)
})

test("the retired Cline testing-platform job cannot block maintained coverage", () => {
	const workflow = fs.readFileSync(workflowPath, "utf8")
	const retiredReferences = [
		"test-platform-integration",
		"compile-cli-all-platforms",
		"compile-standalone-npm",
		"test:tp-orchestrator",
		"testing-platform/",
		"cli/go.sum",
	].filter((reference) => workflow.includes(reference))

	assert.deepEqual(
		retiredReferences,
		[],
		`core workflow still references retired Cline infrastructure: ${retiredReferences.join(", ")}`,
	)
	assert.match(workflow, /^\s{4}qlty:\n\s{8}needs: test$/m)
})
