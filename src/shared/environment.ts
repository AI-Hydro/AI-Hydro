/**
 * Environment names, kept in their own module so the webview can import the enum
 * without bundling `src/config.ts` (service URLs, Firebase settings) into the UI.
 */
export enum Environment {
	production = "production",
	staging = "staging",
	local = "local",
}
