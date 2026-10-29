import * as fs from "fs/promises"
import * as path from "path"

/** Write via a temp file in the same directory, then rename, so a reader never sees a half-written file. */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
	try {
		await fs.writeFile(tmp, content)
		await fs.rename(tmp, file)
	} catch (error) {
		await fs.rm(tmp, { force: true })
		throw error
	}
}
