# Third-party licence notices

The VSIX redistributes third-party code in two ways, and each has its own notice file.

| What ships | Notice file in the VSIX | Produced by |
|---|---|---|
| Files vendored verbatim into `webview-ui/build/assets` (Plotly, three.js) | `THIRD_PARTY_NOTICES` (extension root) | `generate-third-party-notices.mjs`, committed, `--check` in tests |
| npm packages compiled into `dist/extension.js` (esbuild) | `dist/THIRD_PARTY_LICENSES.txt` | `bundled-licenses.mjs`, called by `esbuild.mjs` on every production build |
| npm packages compiled into `webview-ui/build/assets/index.js` (vite) | `webview-ui/build/assets/THIRD_PARTY_LICENSES.txt` | the `bundledLicensesPlugin` in `webview-ui/vite.config.ts` |

The bundled lists are built from the bundler's own record of what it emitted (esbuild metafile inputs with
`bytesInOutput > 0`, rollup chunk modules with `renderedLength > 0`), so they follow every dependency change
without a committed copy to keep in sync.

## When a build fails with "bundled licence check failed"

A newly bundled package has one of these problems:

1. **No licence file in the npm package.** Fetch the upstream text and record it:
   `node scripts/third-party/fetch-licence-overrides.mjs name@version`
   (or `name@version=owner/repo:path/to/LICENSE` when `repository` is missing or wrong). If upstream
   publishes no licence text anywhere, record where you looked:
   `node scripts/third-party/fetch-licence-overrides.mjs "name@version=none:<places checked, date>"`.
   Review the diff of `licence-overrides.json` before committing.
2. **A copyleft-only licence** (GPL, LGPL, AGPL, MPL, EPL, ... with no permissive alternative). Do not just
   add it to `knownProblems`: copyleft code inside a minified bundle needs a decision (unbundle it, replace
   it, or accept it with the obligations met). Record that decision in `DECISIONS.md` and, only then, the
   problem string and decision under `knownProblems`.

`node --test scripts/third-party/bundled-licenses.test.mjs` (`npm run test:licences`) tests the generator.
