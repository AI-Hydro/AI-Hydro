import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { BrushContextProvider, type BrushExtent, useBrushContext } from "../../../context/BrushContext"
import TimeSliderPanel from "../TimeSliderPanel"

const layer = (id: string, start: string, end: string) =>
	({ id, name: id, layerType: "geojson", visible: true, geojson: "", metadata: { time_start: start, time_end: end } }) as any

let setBrush: (extent: BrushExtent) => void = () => {}
const Probe = () => {
	setBrush = useBrushContext().setBrushExtent
	return null
}

describe("TimeSliderPanel brush wiring", () => {
	it("adopts an externally set brush (agent set_time_range) and filters layers", () => {
		const onVisibilityChange = vi.fn()
		const layers = [layer("early", "2019-01-01", "2019-12-31"), layer("late", "2021-01-01", "2021-12-31")]
		const { container } = render(
			<BrushContextProvider>
				<Probe />
				<TimeSliderPanel
					layers={layers}
					onVisibilityChange={onVisibilityChange}
					visibleLayerIds={new Set(["early", "late"])}
				/>
			</BrushContextProvider>,
		)
		act(() => setBrush(["2021-02-01T00:00:00Z", "2021-06-30T00:00:00Z"]))
		const inputs = container.querySelectorAll<HTMLInputElement>('input[type="date"]')
		expect(inputs[0].value).toBe("2021-02-01")
		expect(inputs[1].value).toBe("2021-06-30")
		expect(onVisibilityChange).toHaveBeenCalledWith("early", false)
		expect(onVisibilityChange).not.toHaveBeenCalledWith("late", false)
	})
})
