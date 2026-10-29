/**
 * Dry run of the M1 project migration (X1-P1) against a COPY of `taskHistory.json`.
 *
 *   TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register \
 *     scripts/project-migration-dry-run.ts <path-to-copy-of-taskHistory.json>
 *
 * Reads the file, never writes it, and never calls the tools server: it reports what the migration WOULD assign.
 * Output is counts and folder names only (no chat titles, no full paths).
 */
import * as fs from "node:fs/promises"
import { planProjectMigration, summarizePlan } from "../src/core/storage/projectMigration"

async function main() {
	const file = process.argv[2]
	if (!file) {
		console.error("usage: project-migration-dry-run.ts <copy of taskHistory.json>")
		process.exit(2)
	}
	const history = JSON.parse(await fs.readFile(file, "utf8"))
	if (!Array.isArray(history)) {
		console.error("not a history array")
		process.exit(2)
	}
	const plan = await planProjectMigration(history, (dir) =>
		fs.stat(dir).then(
			(st) => st.isDirectory(),
			() => false,
		),
	)
	console.log(JSON.stringify(summarizePlan(plan), null, 2))
}

void main()
