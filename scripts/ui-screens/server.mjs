/**
 * Vite dev server for the UI screen harness.
 *
 * Generalises scripts/map-browser-smoke.mjs: only the host boundary is replaced
 * (services/grpc-client and context/MapContext are virtual modules backed by
 * webview-ui/src/screens/mockHost.ts); the real contexts and components run.
 * Serves /screen/<id>?theme=&font= and the approximate theme CSS files.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const webview = resolve(root, "webview-ui")
const require = createRequire(resolve(webview, "package.json"))
const { createServer } = await import(resolve(webview, "node_modules/vite/dist/node/index.js"))
const tailwindcss = (await import(resolve(webview, "node_modules/@tailwindcss/vite/dist/index.mjs"))).default

export const THEMES = ["dark", "light", "hc-dark", "hc-light"]
const themeDir = resolve(root, "scripts/ui-screens/themes")

const clientNames = () =>
	[...readFileSync(resolve(webview, "src/services/grpc-client.ts"), "utf8").matchAll(/export class (\w+)/g)].map((m) => m[1])

const BODY_CLASSES = {
	dark: "vscode-dark",
	light: "vscode-light",
	"hc-dark": "vscode-dark vscode-high-contrast",
	"hc-light": "vscode-light vscode-high-contrast vscode-high-contrast-light",
}

function screenHtml(id, query) {
	const theme = THEMES.includes(query.get("theme")) ? query.get("theme") : "dark"
	const font = Number(query.get("font")) || 13
	const surface = query.get("surface") || "editor"
	const bg = surface === "sidebar" ? "var(--vscode-sideBar-background)" : "var(--vscode-editor-background)"
	return `<!doctype html>
<html lang="en" style="--vscode-font-size:${font}px">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screen ${id}</title>
<link rel="stylesheet" href="/__themes/${theme}.css">
<style>html,body{background:${bg};color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);margin:0;height:100%}#root{height:100%}</style>
<script>
  // Every load starts from empty storage: persisted UI state (expanded sections, map workspace) must not leak
  // between cells that share a browser context. The screen entry installs its own fixture storage afterwards.
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  window.__PLATFORM__ = "vscode";
  window.acquireVsCodeApi = function () {
    return { postMessage: function (m) { if (window.__hostPost) window.__hostPost(m) }, getState: function () { return {} }, setState: function () {} };
  };
  document.addEventListener("DOMContentLoaded", function () {
    document.body.className = ${JSON.stringify(BODY_CLASSES[theme])};
    document.body.setAttribute("data-vscode-theme-kind", ${JSON.stringify(theme)});
  });
</script>
</head>
<body><div id="root"></div><script type="module" src="/src/screens/entry.tsx"></script></body>
</html>`
}

export async function startServer() {
	const grpcModule = (() => {
		const names = clientNames()
		return `import {hostCall, hostSubscribe} from "/src/screens/mockHost.ts";
const make = (service) => new Proxy({}, {get: (_, name) => typeof name !== "string" ? undefined : name.startsWith("subscribe") ? (req, handlers) => hostSubscribe(service, name, req, handlers || {}) : (req) => hostCall(service, name, req)});
${names.map((n) => `export const ${n} = make(${JSON.stringify(n)});`).join("\n")}`
	})()
	const mapContextModule = `import React from "react";
import {getActiveScreen} from "/src/screens/active.ts";
export const MAP_SYNC_TIMEOUT_MS = 15000;
let cached;
export const useMapContext = () => {
  const screen = getActiveScreen();
  if (!cached || cached.__screen !== screen) {
    cached = {__screen: screen, layers: screen?.layers ?? [], connectionStatus: "connected", connectionError: undefined, reconnect() {}, activeRoi: undefined, boundClaimId: undefined,
      addLayer() {}, removeLayer() {}, clearLayers() {}, getLayer: (id) => (screen?.layers ?? []).find((l) => l.id === id), setActiveRoiOnHost: async () => {}, refreshSessionRoi: async () => {}};
  }
  return cached;
};
export const MapContextProvider = ({children}) => React.createElement(React.Fragment, null, children);`
	const server = await createServer({
		configFile: false,
		root: webview,
		logLevel: "warn",
		cacheDir: resolve(process.env.UI_SCREENS_CACHE ?? "/private/tmp/aihydro-ui-screens-vite", "cache"),
		server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
		esbuild: { jsx: "automatic" },
		optimizeDeps: { entries: ["src/screens/entry.tsx"] },
		define: {
			__PLATFORM__: JSON.stringify("vscode"),
			process: JSON.stringify({ env: { NODE_ENV: "production", CLINE_ENVIRONMENT: "production" } }),
		},
		resolve: {
			alias: {
				"@shared": resolve(root, "src/shared"),
				"@": resolve(webview, "src"),
				"@components": resolve(webview, "src/components"),
				"@context": resolve(webview, "src/context"),
				"@utils": resolve(webview, "src/utils"),
			},
		},
		plugins: [
			tailwindcss(),
			{
				name: "ui-screens-host",
				enforce: "pre",
				resolveId(id, importer) {
					if (id.endsWith("services/grpc-client")) return "\0screens-grpc"
					if (id.endsWith("context/MapContext") && !(importer ?? "").includes("screens-"))
						return "\0screens-map-context"
				},
				load(id) {
					if (id === "\0screens-grpc") return grpcModule
					if (id === "\0screens-map-context") return mapContextModule
				},
				configureServer(s) {
					s.middlewares.use((req, res, next) => {
						const url = new URL(req.url ?? "/", "http://127.0.0.1")
						const themeMatch = url.pathname.match(/^\/__themes\/([\w-]+)\.css$/)
						if (themeMatch && THEMES.includes(themeMatch[1])) {
							res.setHeader("Content-Type", "text/css")
							res.end(readFileSync(resolve(themeDir, `${themeMatch[1]}.css`), "utf8"))
							return
						}
						const screenMatch = url.pathname.match(/^\/screen\/([^/]+)\/?$/)
						if (screenMatch) {
							res.setHeader("Content-Type", "text/html")
							res.end(screenHtml(decodeURIComponent(screenMatch[1]), url.searchParams))
							return
						}
						next()
					})
				},
			},
		],
	})
	await server.listen()
	return { server, url: server.resolvedUrls.local[0].replace(/\/$/, ""), close: () => server.close() }
}
