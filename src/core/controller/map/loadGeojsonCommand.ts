import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import type { Controller } from ".."

/**
 * Load a GeoJSON file and display it on the map
 * Simple command - just pick a file and it shows on the map
 */
export async function loadGeojsonCommand(controller: Controller): Promise<void> {
	try {
		// Let user pick a GeoJSON file
		const result = await HostProvider.window.showOpenDialogue({
			canSelectMany: false,
			filters: {
				files: ["geojson", "json"],
			},
			openLabel: "Load to Map",
		})

		const filePaths = result.paths
		if (!filePaths || filePaths.length === 0) {
			return
		}

		const filePath = filePaths[0]
		const fileName = path.basename(filePath, path.extname(filePath))

		// Read the file
		const geojsonStr = await fs.readFile(filePath, "utf-8")

		// Parse to validate
		JSON.parse(geojsonStr)

		// Create the layer with bright, visible colors
		const layer = MapLayer.create({
			id: fileName,
			name: `Layer: ${fileName}`,
			geojson: geojsonStr,
			layerType: "polygon",
			style: MapLayerStyle.create({
				color: "#00FF00", // Bright green
				opacity: 0.4,
				strokeWidth: 3,
				strokeColor: "#FFFF00", // Bright yellow border
				fillColor: "#00FF00", // Bright green fill
			}),
			metadata: {
				source: path.basename(filePath),
				path: filePath,
			},
		})

		// Add to map
		controller.addMapLayer(layer)

		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: `✅ Loaded ${fileName} to map`,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Failed to load GeoJSON: ${message}`,
		})
	}
}
