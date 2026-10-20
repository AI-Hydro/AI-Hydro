/**
 * Structural assertions shared by run.mjs and its self-test.
 *
 * "Absent" means no element matching the selector has a rendered box. DOM nodes that are not rendered (display:none,
 * a closed <details> body, an unmounted virtualised row) do not count as present, so the assertion states what a
 * reader of the screenshot could see; an element that is merely scrolled out of view still counts as present.
 */
export async function findPresent(page, selector) {
	return page.locator(selector).evaluateAll((els) =>
		els
			.filter((el) => {
				// checkVisibility covers display:none, visibility:hidden and content-visibility (closed <details> bodies).
				if (
					typeof el.checkVisibility === "function" &&
					!el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })
				)
					return false
				const r = el.getBoundingClientRect()
				return r.width > 0 && r.height > 0
			})
			.map((el) => (el.textContent || "").trim().slice(0, 80)),
	)
}

/** Throws `ASSERT present but expected absent: <selector>` for the first selector that still renders. */
export async function assertAbsent(page, selectors) {
	for (const sel of selectors ?? []) {
		const hits = await findPresent(page, sel)
		if (hits.length > 0) {
			throw new Error(
				`ASSERT present but expected absent: ${sel} (${hits.length} match${hits.length === 1 ? "" : "es"}, first: "${hits[0]}")`,
			)
		}
	}
}
