/**
 * Built-in accessibility/legibility checker, evaluated inside the page.
 * Stands in for axe-core (not installed here). It is deliberately small and
 * conservative; it reports counts plus a few samples, never "pass" claims.
 *
 * Rules:
 *  - noName:      button, [role=button], a[href], vscode-button without an accessible name
 *  - smallTarget: interactive/pointer elements smaller than 24x24 CSS px (non-inline)
 *  - smallText:   rendered text with computed font-size under 11px
 *  - contrast:    WCAG 2.x contrast below 4.5:1 (3:1 for large text) against the
 *                 composited ancestor background; text over canvas/images/gradients
 *                 is counted as `contrastIndeterminate`, not as pass or fail.
 *                 Disabled controls are exempt (WCAG 1.4.3 inactive components).
 *
 * Must stay self-contained: it is serialised with Function.prototype.toString.
 */
export function pageChecker() {
	const MIN_TARGET = 24
	const MIN_FONT = 11
	const result = { noName: 0, smallTarget: 0, smallText: 0, contrast: 0, contrastIndeterminate: 0, samples: [] }
	const sample = (rule, el, detail) => {
		if (result.samples.length < 400) {
			const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""
			result.samples.push({ rule, el: el.tagName.toLowerCase() + (cls ? "." + cls : ""), detail })
		}
	}
	const visible = (el) => {
		if (el.closest("[data-harness]")) return false
		const style = getComputedStyle(el)
		if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false
		const rect = el.getBoundingClientRect()
		return rect.width > 0 && rect.height > 0
	}
	const parseColor = (value) => {
		const m = value.match(/rgba?\(([^)]+)\)/)
		if (!m) return null
		const parts = m[1]
			.split(/[ ,/]+/)
			.filter(Boolean)
			.map(Number)
		return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
	}
	const over = (top, bottom) => {
		const a = top.a + bottom.a * (1 - top.a)
		if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
		return {
			r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
			g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
			b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
			a,
		}
	}
	const lum = (c) => {
		const f = (v) => {
			const s = v / 255
			return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
		}
		return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
	}
	const ratio = (a, b) => {
		const l1 = lum(a)
		const l2 = lum(b)
		return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
	}
	// Effective background: composite ancestor backgrounds; null when an image/gradient intervenes.
	const backgroundOf = (el) => {
		const chain = []
		for (let node = el; node; node = node.parentElement) chain.push(node)
		let acc = { r: 255, g: 255, b: 255, a: 0 }
		let indeterminate = false
		for (const node of chain) {
			const style = getComputedStyle(node)
			if (style.backgroundImage && style.backgroundImage !== "none") indeterminate = true
			const bg = parseColor(style.backgroundColor)
			if (bg && bg.a > 0) {
				acc = over(acc, bg)
				if (acc.a >= 0.999) return { color: acc, indeterminate }
			}
		}
		return { color: over(acc, { r: 255, g: 255, b: 255, a: 1 }), indeterminate: true }
	}
	const opacityOf = (el) => {
		let o = 1
		for (let node = el; node; node = node.parentElement) o *= Number(getComputedStyle(node).opacity)
		return o
	}
	const overlapsCanvas = (el) => {
		const r = el.getBoundingClientRect()
		return [...document.querySelectorAll("canvas")].some((c) => {
			const cr = c.getBoundingClientRect()
			return r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top
		})
	}

	// ── accessible names ────────────────────────────────────────────
	const nameOf = (el) => {
		const label = el.getAttribute("aria-label")
		if (label && label.trim()) return label.trim()
		const by = el.getAttribute("aria-labelledby")
		if (by) {
			const text = by
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent ?? "")
				.join(" ")
				.trim()
			if (text) return text
		}
		const text = (el.innerText || el.textContent || "").trim()
		if (text) return text
		const img = el.querySelector("img[alt]")
		if (img && img.getAttribute("alt").trim()) return img.getAttribute("alt").trim()
		const svgTitle = el.querySelector("svg title")
		if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim()
		if ((el.getAttribute("title") || "").trim()) return el.getAttribute("title").trim()
		if (el.tagName === "INPUT" && (el.value || "").trim()) return el.value.trim()
		return ""
	}
	for (const el of document.querySelectorAll("button, [role=button], a[href], vscode-button, vscode-link")) {
		if (!visible(el)) continue
		if (!nameOf(el)) {
			result.noName++
			sample("noName", el, el.outerHTML.slice(0, 120))
		}
	}

	const inSentence = (el) =>
		[...(el.parentElement?.childNodes ?? [])].some((n) => n !== el && n.nodeType === 3 && n.nodeValue.trim())

	// ── target size ─────────────────────────────────────────────────
	const interactive = new Set(
		document.querySelectorAll(
			"button, [role=button], a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=checkbox], [role=switch], vscode-button, vscode-checkbox, vscode-radio",
		),
	)
	const INTERACTIVE_SELECTOR =
		"button, [role=button], a[href], input, select, textarea, [role=tab], vscode-button, vscode-checkbox, vscode-radio"
	const nativeInteractive = new Set(interactive)
	const pointerDerived = []
	for (const el of document.querySelectorAll("body *")) {
		if (interactive.has(el) || el.closest("[data-harness]")) continue
		// cursor:pointer is inherited by decorative children (icons) of real controls; the control is the target.
		if (el.parentElement?.closest(INTERACTIVE_SELECTOR)) continue
		if (getComputedStyle(el).cursor === "pointer" && visible(el)) pointerDerived.push(el)
	}
	// Count only the outermost pointer element (a label and its inner span are one target).
	for (const el of pointerDerived) {
		let nested = false
		for (let a = el.parentElement; a; a = a.parentElement)
			if (nativeInteractive.has(a) || pointerDerived.includes(a)) nested = true
		if (!nested) interactive.add(el)
	}
	for (const el of interactive) {
		if (!visible(el)) continue
		const style = getComputedStyle(el)
		// WCAG 2.5.8 inline exemption: links that sit inside a sentence.
		if ((el.tagName === "A" || el.tagName === "VSCODE-LINK") && (style.display === "inline" || inSentence(el))) continue
		if (style.pointerEvents === "none") continue
		// Skip wrappers whose interactive child carries the target (avoid double counting).
		if ([...el.querySelectorAll("button, [role=button], a[href], input, select")].some(visible) && el.tagName !== "BUTTON")
			continue
		const r = el.getBoundingClientRect()
		if (r.width < MIN_TARGET || r.height < MIN_TARGET) {
			result.smallTarget++
			sample("smallTarget", el, `${Math.round(r.width)}x${Math.round(r.height)}`)
		}
	}

	// ── text size and contrast ──────────────────────────────────────
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
	const seen = new Set()
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.nodeValue || !node.nodeValue.trim()) continue
		const el = node.parentElement
		if (!el || seen.has(el)) continue
		if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName)) continue
		if (!visible(el)) continue
		seen.add(el)
		const style = getComputedStyle(el)
		const size = parseFloat(style.fontSize)
		// WCAG 1.4.3 exempts inactive UI components from the contrast requirement.
		const inactive = Boolean(el.closest("[disabled], [aria-disabled=true], :disabled"))
		if (size < MIN_FONT) {
			result.smallText++
			sample("smallText", el, `${size.toFixed(1)}px "${node.nodeValue.trim().slice(0, 30)}"`)
		}
		const fg = parseColor(style.color)
		if (!fg || inactive) continue
		const { color: bg, indeterminate } = backgroundOf(el)
		if (indeterminate && overlapsCanvas(el)) {
			result.contrastIndeterminate++
			continue
		}
		if (indeterminate) {
			result.contrastIndeterminate++
			continue
		}
		const alpha = fg.a * opacityOf(el)
		const flat = over({ ...fg, a: alpha }, { ...bg, a: 1 })
		const r = ratio(flat, bg)
		const bold = Number(style.fontWeight) >= 700
		const large = size >= 24 || (bold && size >= 18.66)
		const min = large ? 3 : 4.5
		if (r < min) {
			result.contrast++
			sample("contrast", el, `${r.toFixed(2)}:1 < ${min} "${node.nodeValue.trim().slice(0, 30)}"`)
		}
	}
	return result
}
