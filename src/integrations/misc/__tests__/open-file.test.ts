import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { pathToFileURL } from "url"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { classifyFile, normalizeOpenPath, openFile, setPdfViewerProbe, systemOpener } from "../open-file"

describe("openFile", () => {
	let sandbox: sinon.SinonSandbox
	let dir: string
	let showTextDocument: sinon.SinonStub
	let hostOpen: sinon.SinonStub
	let showMessage: sinon.SinonStub
	let reveal: sinon.SinonStub
	let external: sinon.SinonStub

	const write = (name: string, data: Buffer | string) => {
		const p = path.join(dir, name)
		fs.mkdirSync(path.dirname(p), { recursive: true })
		fs.writeFileSync(p, data)
		return p
	}
	const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-open-"))
		showTextDocument = sandbox.stub().resolves({})
		hostOpen = sandbox.stub().resolves({})
		showMessage = sandbox.stub().resolves({})
		reveal = sandbox.stub().resolves({})
		external = sandbox.stub(systemOpener, "open").resolves(undefined as any)
		sandbox.stub(HostProvider, "window").get(() => ({ showTextDocument, openFile: hostOpen, showMessage }) as any)
		sandbox.stub(HostProvider, "workspace").get(() => ({ openInFileExplorerPanel: reveal }) as any)
	})
	afterEach(() => {
		sandbox.restore()
		fs.rmSync(dir, { recursive: true, force: true })
	})

	it("opens a PNG in the host viewer, not as text", async () => {
		const p = write("hydrograph_01013500.png", PNG)
		await openFile(p)
		expect(hostOpen.calledOnceWithExactly({ filePath: p })).to.equal(true)
		expect(showTextDocument.called).to.equal(false)
		expect(showMessage.called).to.equal(false)
	})

	it("hands a PDF to the system viewer when no PDF viewer extension is installed (never a binary notice)", async () => {
		const p = write("report.PDF", "%PDF-1.4")
		await openFile(p)
		expect(external.calledOnceWithExactly(p)).to.equal(true)
		expect(hostOpen.called).to.equal(false)
		expect(showTextDocument.called).to.equal(false)
		expect(showMessage.called).to.equal(false)
	})

	it("opens a PDF in the host viewer when a PDF viewer extension is installed", async () => {
		setPdfViewerProbe(() => true)
		try {
			const p = write("r.pdf", "%PDF-1.4")
			await openFile(p)
			expect(hostOpen.calledOnceWithExactly({ filePath: p })).to.equal(true)
			expect(external.called).to.equal(false)
		} finally {
			setPdfViewerProbe(() => false)
		}
	})

	it("opens text through the text-document API with the caller's options", async () => {
		const p = write("notes.md", "# hi")
		await openFile(p, true, true)
		expect(showTextDocument.firstCall.args[0]).to.deep.equal({ path: p, options: { preserveFocus: true, preview: true } })
		expect(hostOpen.called).to.equal(false)
	})

	it("sends an unknown binary extension to the host viewer", async () => {
		const p = write("blob.xyz", Buffer.from([0, 1, 2, 0, 0, 3, 0, 4, 0, 0]))
		await openFile(p)
		expect(hostOpen.calledOnce).to.equal(true)
		expect(showTextDocument.called).to.equal(false)
	})

	for (const [file, label] of [
		["dem.tif", "GeoTIFF raster"],
		["forcing.nc", "netCDF dataset"],
		["attrs.parquet", "Parquet table"],
		["setup.exe", "Windows program"],
		["x.msi", "Windows installer"],
		["x.dmg", "macOS disk image"],
		["x.pkg", "installer package"],
		["x.vsix", "VS Code extension package"],
	] as const) {
		it(`reveals ${file} and says what it is instead of failing`, async () => {
			const p = write(file, Buffer.from([0, 1, 2, 3]))
			await openFile(p)
			expect(reveal.calledOnceWithExactly({ path: p })).to.equal(true)
			const msg = showMessage.firstCall.args[0]
			expect(msg.type).to.equal(ShowMessageType.INFORMATION)
			expect(msg.message).to.contain(file).and.to.contain(label)
			expect(hostOpen.called).to.equal(false)
			expect(showTextDocument.called).to.equal(false)
		})
	}

	it("handles spaces in names and files outside the workspace (any absolute path)", async () => {
		const p = write("my plots/watershed map 01031500.png", PNG)
		await openFile(p)
		expect(hostOpen.calledOnceWithExactly({ filePath: p })).to.equal(true)
	})

	it("names the path when the file is missing", async () => {
		const p = path.join(dir, "gone.png")
		await openFile(p)
		const msg = showMessage.firstCall.args[0]
		expect(msg.type).to.equal(ShowMessageType.ERROR)
		expect(msg.message).to.equal(`File not found: ${p}`)
		expect(hostOpen.called).to.equal(false)
	})

	it("names the path and reason when the host fails to open", async () => {
		const p = write("a.png", PNG)
		hostOpen.rejects(new Error("boom"))
		await openFile(p)
		expect(showMessage.firstCall.args[0].message).to.equal(`Could not open ${p}: boom`)
	})

	it("reveals a directory rather than opening it as a document", async () => {
		await openFile(dir)
		expect(reveal.calledOnceWithExactly({ path: dir })).to.equal(true)
		expect(showTextDocument.called).to.equal(false)
	})

	it("accepts file:// URIs with encoded spaces and quotes", async () => {
		const p = write("a b.png", PNG)
		await openFile(`"${pathToFileURL(p).href}"`)
		expect(hostOpen.calledOnceWithExactly({ filePath: p })).to.equal(true)
	})
})

describe("normalizeOpenPath / classifyFile", () => {
	it("leaves Windows drive paths intact", () => {
		expect(normalizeOpenPath("C:\\Users\\me\\try\\hydrograph.png")).to.equal("C:\\Users\\me\\try\\hydrograph.png")
	})
	it("classifies by extension, case-insensitively", async () => {
		expect((await classifyFile("/x/A.PNG")).kind).to.equal("viewer")
		expect((await classifyFile("/x/a.TIFF")).kind).to.equal("data")
	})
})
