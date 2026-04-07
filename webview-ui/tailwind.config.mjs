import { heroui } from "@heroui/react"

/** @type {import('tailwindcss').Config} */

export default {
	content: {
		relative: true,
		files: ["./src/**/*.{jsx,tsx,mdx}", "./node_modules/@heroui/theme/dist/**/*.{ts,tsx}"],
	},
	theme: {
		extend: {
			fontFamily: {
				"azeret-mono": ['"Azeret Mono"', "monospace"],
			},
			colors: {
				background: "var(--vscode-editor-background)",
				border: {
					DEFAULT: "var(--vscode-focusBorder)",
					panel: "var(--vscode-panel-border)",
				},
				foreground: "var(--vscode-foreground)",
				shadow: "var(--vscode-widget-shadow)",
				code: {
					background: "var(--vscode-editor-background)",
					foreground: "var(--vscode-editor-foreground)",
					border: "var(--vscode-editor-border)",
				},
				sidebar: {
					background: "var(--vscode-sideBar-background)",
					foreground: "var(--vscode-sideBar-foreground)",
				},
				input: {
					foreground: "var(--vscode-input-foreground)",
					background: "var(--vscode-input-background)",
					border: "var(--vscode-input-border)",
					placeholder: "var(--vscode-input-placeholderForeground)",
				},
				selection: {
					DEFAULT: "var(--vscode-list-activeSelectionBackground)",
					foreground: "var(--vscode-list-activeSelectionForeground)",
				},
				button: {
					background: {
						DEFAULT: "var(--vscode-button-background)",
						hover: "var(--vscode-button-hoverBackground)",
					},
					foreground: "var(--vscode-button-foreground)",
					separator: "var(--vscode-button-separator)",
					secondary: {
						background: {
							DEFAULT: "var(--vscode-button-secondaryBackground)",
							hover: "var(--vscode-button-secondaryHoverBackground)",
						},
						foreground: "var(--vscode-button-secondaryForeground)",
					},
				},
				muted: {
					DEFAULT: "var(--vscode-editor-foldBackground)",
					foreground: "var(--vscode-editor-foldPlaceholderForeground)",
				},
				menu: {
					DEFAULT: "var(--vscode-menu-background)",
					foreground: "var(--vscode-menu-foreground)",
					border: "var(--vscode-menu-border)",
					shadow: "var(--vscode-menu-shadow)",
				},
				link: {
					DEFAULT: "var(--vscode-textLink-foreground)",
					hover: "var(--vscode-textLink-activeForeground)",
				},
				list: {
					background: {
						hover: "var(--vscode-list-hoverBackground)",
					},
				},
				badge: {
					foreground: "var(--vscode-badge-foreground)",
					background: "var(--vscode-badge-background)",
				},
				banner: {
					background: "var(--vscode-banner-background)",
					foreground: "var(--vscode-banner-foreground)",
					icon: "var(--vscode-banner-iconForeground)",
				},
				toolbar: {
					DEFAULT: "var(--vscode-toolbar-background)",
					hover: "var(--vscode-toolbar-hoverBackground)",
				},
				error: "var(--vscode-errorForeground)",
				description: "var(--vscode-descriptionForeground)",
				success: "var(--vscode-charts-green)",
				warning: "var(--vscode-charts-yellow)",
				// Hydrological Theme Colors
				aihydro: {
					ocean: {
						blue: "#4A90E2",
						light: "#6BB6FF",
						dark: "#2E5BBA",
					},
					emerald: {
						DEFAULT: "#50C878",
						light: "#6ADE8F",
						dark: "#3A9B5C",
					},
					teal: {
						DEFAULT: "#20B2AA",
						light: "#48D1CC",
						dark: "#008B8B",
					},
					cyan: {
						DEFAULT: "#00CED1",
						light: "#20E3E3",
					},
					background: "#0f172a",
					surface: "#1e293b",
					border: "#334155",
					text: "#f1f5f9",
					"text-muted": "#94a3b8",
				},
			},
			fontSize: {
				xl: "calc(2 * var(--vscode-font-size))",
				lg: "calc(1.5 * var(--vscode-font-size))",
				md: "calc(1.25 * var(--vscode-font-size))",
				sm: "var(--vscode-font-size)",
				xs: "calc(0.85 * var(--vscode-font-size))",
				xxs: "calc(0.75 * var(--vscode-font-size))",
			},
		},
	},
	darkMode: "class",
	plugins: [
		heroui({
			defaultTheme: "vscode",
			themes: {
				vscode: {
					colors: {
						background: "",
					},
				},
			},
		}),
	],
}
