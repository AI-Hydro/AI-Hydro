import { writeFile } from "@utils/fs"
import * as fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import open from "open"

/** The system opener, a seam so tests never launch a real viewer. */
export const systemOpener = { open: (target: string) => open(target) }

import * as os from "os"
import * as path from "path"
import { fileURLToPath } from "url"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"

export async function openImage(dataUri: string) {
	const matches = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Invalid data URI format",
		})
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")
	const tempFilePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.${format}`)
	try {
		await writeFile(tempFilePath, new Uint8Array(imageBuffer))
		await HostProvider.window.openFile({
			filePath: tempFilePath,
		})
	} catch (error) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Error opening image: ${error}`,
		})
	}
}

/**
 * How a file is opened. Text goes through the text-document API; anything VS Code can show in its own viewer goes
 * through `vscode.open`; scientific/data formats VS Code cannot display get a clear action instead of an error.
 */
export type OpenFileKind = "text" | "viewer" | "data" | "pdf"

/** Formats VS Code renders itself: images, audio and video. PDF is handled separately (no built-in viewer). */
const VIEWER_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".ico",
	".avif",
	".mp3",
	".wav",
	".ogg",
	".mp4",
	".webm",
	".mov",
])

/** Data formats with no VS Code viewer: label shown in the message, so the user knows what the file is. */
const DATA_FORMATS: Record<string, string> = {
	".tif": "GeoTIFF raster",
	".tiff": "GeoTIFF raster",
	".nc": "netCDF dataset",
	".nc4": "netCDF dataset",
	".cdf": "netCDF dataset",
	".parquet": "Parquet table",
	".feather": "Feather table",
	".arrow": "Arrow table",
	".h5": "HDF5 file",
	".hdf5": "HDF5 file",
	".hdf": "HDF file",
	".gpkg": "GeoPackage",
	".shp": "Shapefile",
	".npy": "NumPy array",
	".npz": "NumPy archive",
	".pkl": "Python pickle",
	".pickle": "Python pickle",
	".zarr": "Zarr store",
	".sqlite": "SQLite database",
	".db": "database file",
	".zip": "zip archive",
	".gz": "gzip archive",
	".tar": "tar archive",
	".xlsx": "Excel workbook",
	".xls": "Excel workbook",
	".docx": "Word document",
	".pptx": "PowerPoint presentation",
	// Installers and packages are never opened or run from a chat link: reveal only.
	".exe": "Windows program",
	".msi": "Windows installer",
	".dmg": "macOS disk image",
	".pkg": "installer package",
	".vsix": "VS Code extension package",
	".app": "macOS application",
}

/** Classify by extension first (cheap, no I/O); unknown extensions fall back to content sniffing. */
let pdfViewerProbe: () => boolean = () => false

/** The host registers how to tell whether a PDF viewer extension is installed (VS Code: an extension id with "pdf"). */
export function setPdfViewerProbe(probe: () => boolean): void {
	pdfViewerProbe = probe
}

export const pdfViewerInstalled = (): boolean => pdfViewerProbe()

export async function classifyFile(absolutePath: string): Promise<{ kind: OpenFileKind; label?: string }> {
	const ext = path.extname(absolutePath).toLowerCase()
	if (VIEWER_EXTENSIONS.has(ext)) {
		return { kind: "viewer" }
	}
	if (ext === ".pdf") {
		return { kind: "pdf" }
	}
	if (DATA_FORMATS[ext]) {
		return { kind: "data", label: DATA_FORMATS[ext] }
	}
	try {
		// Anything else that is binary goes to VS Code's own handling rather than the text API, which rejects it.
		return { kind: (await isBinaryFile(absolutePath)) ? "viewer" : "text" }
	} catch {
		return { kind: "text" }
	}
}

/** Accepts what the model writes in chat: `file://` URIs and surrounding quotes or whitespace. */
export function normalizeOpenPath(raw: string): string {
	let p = raw.trim().replace(/^["'`]|["'`]$/g, "")
	if (p.startsWith("file://")) {
		try {
			p = fileURLToPath(p)
		} catch {
			// not a valid file URL: leave it and let the existence check name it
		}
	}
	return p
}

const fail = (message: string) => HostProvider.window.showMessage({ type: ShowMessageType.ERROR, message })

export async function openFile(absolutePath: string, preserveFocus: boolean = false, preview: boolean = false) {
	const target = normalizeOpenPath(absolutePath)
	let stat: Awaited<ReturnType<typeof fs.stat>>
	try {
		stat = await fs.stat(target)
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code
		fail(code === "ENOENT" || code === "ENOTDIR" ? `File not found: ${target}` : `Could not read ${target}: ${error}`)
		return
	}
	if (stat.isDirectory()) {
		await HostProvider.workspace.openInFileExplorerPanel({ path: target })
		return
	}

	const { kind, label } = await classifyFile(target)
	try {
		if (kind === "text") {
			await HostProvider.window.showTextDocument({ path: target, options: { preserveFocus, preview } })
		} else if (kind === "pdf") {
			if (pdfViewerInstalled()) {
				await HostProvider.window.openFile({ filePath: target })
			} else {
				// VS Code has no PDF viewer of its own (it would show a binary notice): hand it to the system viewer.
				await systemOpener.open(target)
			}
		} else if (kind === "viewer") {
			// VS Code's own viewer (image preview, media, or an installed PDF viewer), in the editor area.
			await HostProvider.window.openFile({ filePath: target })
		} else {
			// No viewer exists: show where the file is and say what it is, rather than failing.
			await HostProvider.workspace.openInFileExplorerPanel({ path: target })
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `${path.basename(target)} is a ${label}, which VS Code cannot display. It is selected in the Explorer; open it in a GIS or data tool.`,
			})
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		fail(`Could not open ${target}: ${reason}`)
	}
}
