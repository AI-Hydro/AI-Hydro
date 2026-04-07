import { SVGProps } from "react"
import type { Environment } from "../../../src/config"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * AiHydroLogoVariable component renders the AI-Hydro logo with automatic theme adaptation
 * and environment-based color indicators.
 *
 * This component uses VS Code theme variables for the fill color, with environment-specific colors:
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: gradient (default - bright blue gradient)
 *
 * @param {SVGProps<SVGSVGElement> & { environment?: Environment }} props - Standard SVG props plus optional environment
 * @returns {JSX.Element} SVG AI-Hydro logo that adapts to VS Code themes and environment
 */
const AiHydroLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props

	// Determine fill color based on environment
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"
	const useGradient = !environment || environment === "production"

	return (
		<svg fill="none" height="50" viewBox="0 0 100 100" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			{useGradient && (
				<defs>
					<linearGradient gradientUnits="userSpaceOnUse" id="dropletGrad" x1="50" x2="50" y1="10" y2="90">
						<stop offset="0%" stopColor="#00A3FF" />
						<stop offset="100%" stopColor="#00DDFF" />
					</linearGradient>
				</defs>
			)}
			<path
				d="M50 10 C50 10 25 35 25 55 C25 70 35 85 50 85 C65 85 75 70 75 55 C75 35 50 10 50 10 Z"
				fill={useGradient ? "url(#dropletGrad)" : fillColor}
			/>
			<ellipse cx="20" cy="52" fill={useGradient ? "url(#dropletGrad)" : fillColor} rx="5" ry="7" />
			<ellipse cx="80" cy="52" fill={useGradient ? "url(#dropletGrad)" : fillColor} rx="5" ry="7" />
			<ellipse cx="40" cy="48" fill={fillColor} rx="6" ry="9" />
			<ellipse cx="60" cy="48" fill={fillColor} rx="6" ry="9" />
			<path d="M 38 62 Q 50 68 62 62" fill="none" stroke={fillColor} strokeLinecap="round" strokeWidth="3" />
			<circle cx="50" cy="14" fill={useGradient ? "url(#dropletGrad)" : fillColor} r="4" />
		</svg>
	)
}

export default AiHydroLogoVariable
