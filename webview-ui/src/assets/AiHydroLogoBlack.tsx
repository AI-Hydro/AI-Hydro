import { SVGProps } from "react"

const AiHydroLogoBlack = (props: SVGProps<SVGSVGElement>) => (
	<svg fill="none" height="50" viewBox="0 0 100 100" width="50" xmlns="http://www.w3.org/2000/svg" {...props}>
		<path d="M50 10 C50 10 25 35 25 55 C25 70 35 85 50 85 C65 85 75 70 75 55 C75 35 50 10 50 10 Z" fill="black" />
		<ellipse cx="20" cy="52" fill="black" rx="5" ry="7" />
		<ellipse cx="80" cy="52" fill="black" rx="5" ry="7" />
		<ellipse cx="40" cy="48" fill="white" rx="6" ry="9" />
		<ellipse cx="60" cy="48" fill="white" rx="6" ry="9" />
		<path d="M 38 62 Q 50 68 62 62" fill="none" stroke="white" strokeLinecap="round" strokeWidth="3" />
		<circle cx="50" cy="14" fill="black" r="4" />
	</svg>
)

export default AiHydroLogoBlack
