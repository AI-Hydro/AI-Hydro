import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapLayer } from "@shared/proto/cline/map"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { MapServiceClient } from "../services/grpc-client"

interface MapContextType {
	layers: MapLayer[]
	addLayer: (layer: MapLayer) => void
	removeLayer: (layerId: string) => void
	clearLayers: () => void
	getLayer: (layerId: string) => MapLayer | undefined
}

const MapContext = createContext<MapContextType | undefined>(undefined)
const MAP_OPERATION_KEY = "__operation"

export const MapContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [layers, setLayers] = useState<MapLayer[]>([])
	const subscriptionRef = useRef<(() => void) | null>(null)

	const applyIncomingLayer = useCallback((prevLayers: MapLayer[], incomingLayer: MapLayer): MapLayer[] => {
		const operation = incomingLayer.metadata?.[MAP_OPERATION_KEY]

		if (operation === "clear") {
			return []
		}

		if (operation === "remove") {
			return prevLayers.filter((layer) => layer.id !== incomingLayer.id)
		}

		const existingIndex = prevLayers.findIndex((layer) => layer.id === incomingLayer.id)
		if (existingIndex >= 0) {
			const nextLayers = [...prevLayers]
			nextLayers[existingIndex] = incomingLayer
			return nextLayers
		}
		return [...prevLayers, incomingLayer]
	}, [])

	// Subscribe to map layer updates from backend
	useEffect(() => {
		MapServiceClient.getMapState(EmptyRequest.create({}))
			.then((response) => {
				setLayers(response.layers || [])
			})
			.catch((error) => {
				console.error("[MapContext] Failed to fetch initial map state:", error)
			})

		subscriptionRef.current = MapServiceClient.subscribeToMapLayers(EmptyRequest.create({}), {
			onResponse: (layer: MapLayer) => {
				console.log("[MapContext] Received layer update:", layer.id)
				setLayers((prevLayers) => applyIncomingLayer(prevLayers, layer))
			},
			onError: (error) => {
				console.error("[MapContext] Error in layer subscription:", error)
			},
			onComplete: () => {
				console.log("[MapContext] Layer subscription completed")
			},
		})

		return () => {
			if (subscriptionRef.current) {
				subscriptionRef.current()
				subscriptionRef.current = null
			}
		}
	}, [applyIncomingLayer])

	const addLayer = useCallback((layer: MapLayer) => {
		setLayers((prevLayers) => {
			const existingIndex = prevLayers.findIndex((l) => l.id === layer.id)
			if (existingIndex >= 0) {
				const newLayers = [...prevLayers]
				newLayers[existingIndex] = layer
				return newLayers
			}
			return [...prevLayers, layer]
		})
	}, [])

	const removeLayer = useCallback((layerId: string) => {
		setLayers((prevLayers) => prevLayers.filter((l) => l.id !== layerId))
	}, [])

	const clearLayers = useCallback(() => {
		setLayers([])
	}, [])

	const getLayer = useCallback(
		(layerId: string) => {
			return layers.find((l) => l.id === layerId)
		},
		[layers],
	)

	return <MapContext.Provider value={{ layers, addLayer, removeLayer, clearLayers, getLayer }}>{children}</MapContext.Provider>
}

export const useMapContext = () => {
	const context = useContext(MapContext)
	if (!context) {
		throw new Error("useMapContext must be used within MapContextProvider")
	}
	return context
}
