import * as fs from "node:fs"
import * as path from "node:path"
import { expect } from "chai"
import { describe, it } from "mocha"

/**
 * Source-level guarantees of the wiring that no unit test can run without VS Code: the old Reload route is gone, and the
 * watcher's path to the panel never opens or reveals it.
 */
const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8")

describe("map file watch wiring", () => {
	const provider = read("src/hosts/vscode/VscodeMapPanelProvider.ts")

	it("the save hook, the host method and the webview message of Reload source are gone", () => {
		expect(read("src/extension.ts")).to.not.contain("notifyFileSaved")
		expect(provider).to.not.contain("notifyFileSaved")
		expect(provider).to.not.contain("aihydro-source-file-saved")
		const webview = read("webview-ui/src/components/map/MapView.tsx") + read("webview-ui/src/components/map/LayerPanel.tsx")
		expect(webview).to.not.contain("aihydro-source-file-saved")
		expect(webview).to.not.contain("Reload source")
		expect(webview).to.not.contain("handleReloadSource")
	})

	it("the watcher reaches the panel only if there is one: nothing in its host glue opens or reveals the panel", () => {
		const start = provider.indexOf("private static startFileWatch")
		const end = provider.indexOf("public static isOpen")
		expect(start).to.be.greaterThan(0)
		const glue = provider.slice(start, end)
		expect(glue).to.not.contain("createOrShow")
		expect(glue).to.not.contain(".reveal(")
		expect(glue).to.not.contain("showTextDocument")
		const core = read("src/core/map/mapFileWatch.ts")
		expect(core).to.not.contain("createOrShow")
		expect(core).to.not.match(/from "vscode"/)
	})

	it("paths are authorized as loads, so a path a scene or message put on a layer is not watched", () => {
		const start = provider.indexOf("private static startFileWatch")
		expect(provider.slice(start, start + 2000)).to.contain('authorizeForMap(p, "load"')
	})

	it("the panel is looked at when it is shown again and when the page says it is ready", () => {
		expect(provider).to.contain("onDidChangeViewState")
		expect(provider).to.contain('case "aihydro-map-panel-ready"')
		expect(read("webview-ui/src/components/map/MapView.tsx")).to.contain('type: "aihydro-map-panel-ready"')
	})

	it("the page drops a cached parse when its layer takes a new version of its file", () => {
		const view = read("webview-ui/src/components/map/MapView.tsx")
		expect(view).to.contain("geojsonFileVersionRef")
		expect(view).to.contain("fileVersionOf(")
	})
})
