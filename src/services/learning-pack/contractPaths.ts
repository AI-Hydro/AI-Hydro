/**
 * The one ordering the Learning Pack contract uses for archive paths and module IDs: UTF-16 code-unit order,
 * which is exactly what `Array.prototype.sort()` with no comparator does for strings. Never `localeCompare`:
 * it depends on the host locale and on ICU, so two machines would sign different `checksums.json` bytes.
 *
 * Lives outside `authoring/` because the installed verifier uses it too; the authoring code (builder, signer)
 * must never be bundled into the extension.
 */
export function compareContractPaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}
