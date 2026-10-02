import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "chai"
import ExcelJS from "exceljs"
import { afterEach, beforeEach, describe, it } from "mocha"
import { callTextExtractionFunctions } from "../extract-text"

describe("Excel text extraction", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-xlsx-extraction-"))
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("extracts supported visible values and omits hidden sheets", async () => {
		const filePath = path.join(tempDir, "supported-values.xlsx")
		const workbook = new ExcelJS.Workbook()
		const visible = workbook.addWorksheet("Water Balance")
		visible.addRow(["Label", "Value"])
		visible.addRow([
			{ richText: [{ text: "Actual " }, { text: "ET", font: { italic: true } }] },
			{ formula: "1+2", result: 3 },
		])
		visible.addRow([
			{ text: "AI-Hydro", hyperlink: "https://example.invalid/ai-hydro" },
			new Date("2026-01-15T00:00:00.000Z"),
		])
		visible.addRow([{ error: "#DIV/0!" }])

		const hidden = workbook.addWorksheet("Instructor Answers", { state: "hidden" })
		hidden.addRow(["INSTRUCTOR_CANARY"])
		const veryHidden = workbook.addWorksheet("Rubric", { state: "veryHidden" })
		veryHidden.addRow(["VERY_HIDDEN_CANARY"])

		await workbook.xlsx.writeFile(filePath)

		const text = await callTextExtractionFunctions(filePath)

		expect(text).to.include("--- Sheet: Water Balance ---")
		expect(text).to.include("Actual ET\t3")
		expect(text).to.include("AI-Hydro (https://example.invalid/ai-hydro)\t2026-01-15")
		expect(text).to.include("[Error: #DIV/0!]")
		expect(text).not.to.include("Instructor Answers")
		expect(text).not.to.include("INSTRUCTOR_CANARY")
		expect(text).not.to.include("Rubric")
		expect(text).not.to.include("VERY_HIDDEN_CANARY")
	})

	it("reports a formula when the workbook has no cached result", async () => {
		const filePath = path.join(tempDir, "formula-without-result.xlsx")
		const workbook = new ExcelJS.Workbook()
		workbook.addWorksheet("Formula").getCell("A1").value = { formula: "SUM(1,2)" }
		await workbook.xlsx.writeFile(filePath)

		const text = await callTextExtractionFunctions(filePath)

		expect(text).to.include("[Formula: SUM(1,2)]")
	})

	it("enforces the authored row extraction limit", async () => {
		const filePath = path.join(tempDir, "sparse-large-sheet.xlsx")
		const workbook = new ExcelJS.Workbook()
		const worksheet = workbook.addWorksheet("Sparse")
		worksheet.getCell("A1").value = "included"
		worksheet.getCell("A50001").value = "excluded"
		await workbook.xlsx.writeFile(filePath)

		const text = await callTextExtractionFunctions(filePath)

		expect(text).to.include("included")
		expect(text).to.include("[... truncated after row 50000 ...]")
		expect(text).not.to.include("excluded")
	})

	it("returns a stable extraction error for a corrupt workbook", async () => {
		const filePath = path.join(tempDir, "corrupt.xlsx")
		fs.writeFileSync(filePath, "not an xlsx archive")

		let error: Error | undefined
		try {
			await callTextExtractionFunctions(filePath)
		} catch (caught) {
			error = caught as Error
		}

		expect(error?.message).to.match(/^Failed to extract text from Excel: /)
	})
})
