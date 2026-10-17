/** Plain-text rendering of a markdown task title: no markers, links reduced to their text, whitespace collapsed. */
export function stripMarkdown(input: string): string {
	return input
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/<\/?[a-zA-Z][^>]*>/g, "")
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(\*|_)(.+?)\1/g, "$2")
		.replace(/~~(.+?)~~/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim()
}
