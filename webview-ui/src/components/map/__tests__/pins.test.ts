import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	adoptHostPins,
	loadAnnotationsReport,
	type MapAnnotation,
	newAnnotation,
	saveAnnotations,
	setActiveProjectKey,
} from "../annotationStorage"
import {
	addPin,
	createPin,
	nextDefaultName,
	patchPin,
	pinAtPoint,
	pinsOf,
	removePins,
	sanitizeAnnotations,
	shapesOf,
	undoEdit,
} from "../pins"

const pin = (lon: number, lat: number, list: MapAnnotation[] = []) => createPin(list, lon, lat)

describe("pin model", () => {
	it("names new pins Pin N, one past the highest, and sketches by their own kind", () => {
		let list: MapAnnotation[] = []
		list = addPin(list, pin(1, 2, list)).next
		list = addPin(list, pin(3, 4, list)).next
		expect(list.map((p) => p.name)).toEqual(["Pin 1", "Pin 2"])
		expect(nextDefaultName(list, "line")).toBe("Line 1")
		expect(nextDefaultName(list, "polygon")).toBe("Area 1")
		expect(createPin(removePins(list, [list[0].id]).next, 0, 0).name).toBe("Pin 3")
	})

	it("place, rename, note, delete and undo round-trip", () => {
		let list: MapAnnotation[] = []
		const a = pin(10, 20, list)
		const added = addPin(list, a)
		list = added.next
		const renamed = patchPin(list, a.id, { name: "  Outlet candidate  " })
		list = renamed.next
		expect(list[0].name).toBe("Outlet candidate")
		const noted = patchPin(list, a.id, { notes: "upstream of the bridge" })
		list = noted.next
		const deleted = removePins(list, [a.id])
		expect(deleted.next).toEqual([])
		// Undo in reverse order restores every step.
		list = undoEdit(deleted.next, deleted.edit!)
		expect(list[0].notes).toBe("upstream of the bridge")
		list = undoEdit(list, noted.edit!)
		expect(list[0].notes).toBe("")
		list = undoEdit(list, renamed.edit!)
		expect(list[0].name).toBe("Pin 1")
		list = undoEdit(list, added.edit!)
		expect(list).toEqual([])
	})

	it("refuses a blank name and reports no edit for a no-op", () => {
		const a = pin(0, 0)
		const list = [a]
		expect(patchPin(list, a.id, { name: "   " }).edit).toBeUndefined()
		expect(patchPin(list, a.id, { name: a.name }).edit).toBeUndefined()
		expect(patchPin(list, "missing", { name: "x" }).edit).toBeUndefined()
		expect(removePins(list, ["missing"]).edit).toBeUndefined()
	})

	it("undoing a delete puts each pin back where it was, even after the list shrank", () => {
		const list = ["a", "b", "c", "d"].map((n, i) => ({ ...pin(i, i), id: n, name: n }))
		const deleted = removePins(list, ["b", "d"])
		expect(deleted.next.map((p) => p.id)).toEqual(["a", "c"])
		expect(undoEdit(deleted.next, deleted.edit!).map((p) => p.id)).toEqual(["a", "b", "c", "d"])
		expect(undoEdit(deleted.next.slice(0, 1), deleted.edit!).map((p) => p.id)).toEqual(["a", "b", "d"])
	})

	it("keeps pins and sketches apart", () => {
		const line = newAnnotation(
			"line",
			{
				type: "LineString",
				coordinates: [
					[0, 0],
					[1, 1],
				],
			},
			[],
		)
		const list = [pin(1, 1), line]
		expect(pinsOf(list)).toHaveLength(1)
		expect(shapesOf(list)).toEqual([line])
		expect(line.name).toBe("Line 1")
	})

	it("finds the pin under the pointer, nearest first, and none outside the radius", () => {
		const a = { ...pin(0, 0), id: "a" }
		const b = { ...pin(1, 1), id: "b" }
		const project = (lon: number, lat: number): [number, number] => [lon * 100, lat * 100]
		expect(pinAtPoint([a, b], project, 3, 4)?.id).toBe("a")
		expect(pinAtPoint([a, b], project, 101, 99)?.id).toBe("b")
		expect(pinAtPoint([a, b], project, 50, 50)).toBeUndefined()
	})
})

describe("sanitizeAnnotations (a malformed stored pin never reaches the renderer)", () => {
	const good = { ...pin(5, 6), id: "good" }

	it("drops entries without a usable geometry and counts them", () => {
		const bad = [
			null,
			"junk",
			{ id: "x" },
			{ id: "nan", geometry: { type: "Point", coordinates: [Number.NaN, 1] } },
			{ id: "short", geometry: { type: "Point", coordinates: [1] } },
			{ id: "line", geometry: { type: "LineString", coordinates: [[0, 0]] } },
			{ id: "weird", geometry: { type: "MultiPoint", coordinates: [[0, 0]] } },
		]
		const out = sanitizeAnnotations([good, ...bad])
		expect(out.annotations.map((a) => a.id)).toEqual(["good"])
		expect(out.dropped).toBe(bad.length)
	})

	it("returns an empty list for something that is not a list", () => {
		expect(sanitizeAnnotations({ not: "a list" }).annotations).toEqual([])
		expect(sanitizeAnnotations(undefined).annotations).toEqual([])
	})

	it("fills missing fields, repairs a bad colour and de-duplicates ids", () => {
		const out = sanitizeAnnotations([
			{ id: "p", name: "A", geometry: { type: "Point", coordinates: [1, 2] }, color: "orange" },
			{ id: "p", name: "B", geometry: { type: "Point", coordinates: [3, 4] } },
		])
		expect(out.annotations[0].color).toMatch(/^#[0-9a-f]{6}$/i)
		expect(out.annotations[0].notes).toBe("")
		expect(new Set(out.annotations.map((a) => a.id)).size).toBe(2)
	})

	it('renames the old default "Annotation N" to "Pin N" for points only', () => {
		const out = sanitizeAnnotations([
			{ id: "1", name: "Annotation 2", geometry: { type: "Point", coordinates: [1, 2] } },
			{
				id: "2",
				name: "Annotation 3",
				geometry: {
					type: "LineString",
					coordinates: [
						[0, 0],
						[1, 1],
					],
				},
			},
			{ id: "3", name: "Annotation of a dam", geometry: { type: "Point", coordinates: [1, 2] } },
		])
		expect(out.annotations.map((a) => a.name)).toEqual(["Pin 2", "Annotation 3", "Annotation of a dam"])
		expect(out.renamed).toBe(1)
	})
})

describe("pin storage migration", () => {
	beforeEach(() => {
		localStorage.clear()
		setActiveProjectKey(null)
	})
	afterEach(() => setActiveProjectKey(null))

	it("reads the v2 list, repairing the old default names", () => {
		localStorage.setItem(
			"aihydro.map.annotations.v2",
			JSON.stringify([{ id: "1", name: "Annotation 2", type: "point", geometry: { type: "Point", coordinates: [1, 2] } }]),
		)
		const out = loadAnnotationsReport()
		expect(out.annotations[0].name).toBe("Pin 2")
		expect(out.renamed).toBe(1)
	})

	it("upgrades a v1 list (comment becomes notes) and saves it as v2", () => {
		localStorage.setItem(
			"aihydro.map.annotations.v1",
			JSON.stringify([
				{
					id: "v1",
					name: "Old",
					comment: "from v1",
					color: "#ef4444",
					type: "point",
					geometry: { type: "Point", coordinates: [1, 2] },
					tags: "a, b",
					createdAt: "2020-01-01T00:00:00.000Z",
				},
			]),
		)
		const out = loadAnnotationsReport()
		expect(out.annotations[0]).toMatchObject({ notes: "from v1", tags: ["a", "b"] })
		expect(JSON.parse(localStorage.getItem("aihydro.map.annotations.v2") ?? "[]")).toHaveLength(1)
	})

	it("once the host names the project, the cache is that project's and the unscoped list is gone", () => {
		localStorage.setItem(
			"aihydro.map.annotations.v2",
			JSON.stringify([
				{ id: "g", name: "Greenville", type: "point", geometry: { type: "Point", coordinates: [-69.5, 45.4] } },
			]),
		)
		const mine = sanitizeAnnotations([{ ...pin(1, 2), id: "mine" }]).annotations
		adoptHostPins("prj_A", mine)
		expect(localStorage.getItem("aihydro.map.annotations.v2")).toBeNull()
		expect(loadAnnotationsReport().annotations.map((a) => a.id)).toEqual(["mine"])
		// Saving now writes the project's cache, never the unscoped key.
		saveAnnotations([])
		expect(localStorage.getItem("aihydro.map.annotations.v2")).toBeNull()
		expect(loadAnnotationsReport("prj_A").annotations).toEqual([])
		// Another project sees nothing of project A's pins.
		expect(loadAnnotationsReport("prj_B").annotations).toEqual([])
	})
})
