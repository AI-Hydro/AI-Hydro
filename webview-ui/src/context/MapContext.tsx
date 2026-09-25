import { EmptyRequest } from "@shared/proto/cline/common"
import type { MapLayer, MapRoi } from "@shared/proto/cline/map"
import { SetActiveRoiRequest } from "@shared/proto/cline/map"
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ActiveRoi } from "../components/map/mapWorkspace"
import { MapServiceClient } from "../services/grpc-client"

interface MapContextType {
	connectionStatus: "loading" | "connected" | "stale"
	connectionError: string | undefined
	reconnect: () => void
	layers: MapLayer[]
	activeRoi: ActiveRoi | undefined
	addLayer: (layer: MapLayer) => void
	removeLayer: (layerId: string) => void
	clearLayers: () => void
	getLayer: (layerId: string) => MapLayer | undefined
	setActiveRoiOnHost: (roi: ActiveRoi | undefined, geojson?: string) => Promise<void>
	refreshSessionRoi: () => Promise<void>
}

const MapContext = createContext<MapContextType | undefined>(undefined)
const MAP_OPERATION_KEY = "__operation"
export const MAP_SYNC_TIMEOUT_MS = 15000

function protoToActiveRoi(roi?: MapRoi): ActiveRoi | undefined {
	if (!roi?.name && !roi?.geojson) {
		return undefined
	}
	return {
		id: roi.id,
		name: roi.name,
		source: roi.source,
		areaHa: roi.areaHa,
	}
}

export const MapContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [layers, setLayers] = useState<MapLayer[]>([])
	const [activeRoi, setActiveRoi] = useState<ActiveRoi | undefined>()
	const [connectionStatus, setConnectionStatus] = useState<"loading" | "connected" | "stale">("loading")
	const [connectionError, setConnectionError] = useState<string>()
	const [attempt, setAttempt] = useState(0)
	const roiGeneration = useRef(0)
	const roiLifecycleEpoch = useRef(0)
	const roiMutationQueue = useRef<Promise<void>>(Promise.resolve())
	const reconnect = useCallback(() => {
		roiGeneration.current += 1
		roiLifecycleEpoch.current += 1
		setAttempt((value) => value + 1)
	}, [])

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

	useEffect(() => {
		roiGeneration.current += 1
		roiLifecycleEpoch.current += 1
		let active = true
		let layersReady = false
		let sessionReady = false
		let staged: MapLayer[] | undefined
		let unsubscribeLayers = () => {}
		let unsubscribeSession = () => {}
		setConnectionStatus("loading")
		setConnectionError(undefined)
		const fail = (reason: unknown) => {
			if (!active) return
			active = false
			roiGeneration.current += 1
			roiLifecycleEpoch.current += 1
			clearTimeout(timer)
			unsubscribeLayers()
			unsubscribeSession()
			setConnectionStatus("stale")
			setConnectionError(reason instanceof Error ? reason.message : String(reason))
		}
		const timer = setTimeout(
			() => fail(new Error("Map synchronization timed out. Reconnect to refresh.")),
			MAP_SYNC_TIMEOUT_MS,
		)
		const ready = () => {
			if (active && layersReady && sessionReady) {
				clearTimeout(timer)
				setConnectionStatus("connected")
			}
		}
		try {
			unsubscribeLayers = MapServiceClient.subscribeToMapLayers(EmptyRequest.create({}), {
				onResponse: (layer: MapLayer) => {
					if (!active) return
					const operation = layer.metadata?.[MAP_OPERATION_KEY]
					if (operation === "snapshot_start") {
						staged = []
						layersReady = false
						return
					}
					if (operation === "snapshot_complete") {
						if (!staged) {
							fail(new Error("Map snapshot completion arrived without a start."))
							return
						}
						setLayers(staged)
						staged = undefined
						layersReady = true
						ready()
						return
					}
					if (staged) staged = applyIncomingLayer(staged, layer)
					else if (layersReady) setLayers((previous) => applyIncomingLayer(previous, layer))
					else fail(new Error("Map host lacks ordered synchronization. Reopen with a matching extension build."))
				},
				onError: fail,
				onComplete: () => fail(new Error("Map layer connection closed.")),
			})
			if (!active) {
				unsubscribeLayers()
				return () => clearTimeout(timer)
			}
			unsubscribeSession = MapServiceClient.subscribeToMapSession(EmptyRequest.create({}), {
				onResponse: (session) => {
					if (!active) return
					roiGeneration.current += 1
					setActiveRoi(protoToActiveRoi(session.activeRoi))
					sessionReady = true
					ready()
				},
				onError: fail,
				onComplete: () => fail(new Error("Map session connection closed.")),
			})
			if (!active) unsubscribeSession()
		} catch (error) {
			fail(error)
		}
		return () => {
			active = false
			roiGeneration.current += 1
			roiLifecycleEpoch.current += 1
			clearTimeout(timer)
			unsubscribeLayers()
			unsubscribeSession()
		}
	}, [applyIncomingLayer, attempt])

	const setActiveRoiOnHost = useCallback((roi: ActiveRoi | undefined, geojson?: string): Promise<void> => {
		// `!roi` must be part of this guard, not just `!roi?.name`: the old
		// check let a call with roi=undefined and a truthy geojson fall
		// through to `roi.id` below and throw. No current caller passes
		// geojson without roi, but the exported type allows it.
		const request =
			!roi || (!roi.name && !geojson)
				? SetActiveRoiRequest.create({})
				: SetActiveRoiRequest.create({
						roi: {
							id: roi.id || `roi_${Date.now()}`,
							name: roi.name || "ROI",
							source: roi.source || "map_draw",
							geojson: geojson || "",
							areaHa: roi.areaHa ?? 0,
							workspacePath: "",
						},
					})

		// The host RPC returns only Empty, so completion is not evidence that
		// this request is still canonical. Serialize this provider's writes and
		// let the authoritative session stream update visible ROI.
		roiGeneration.current += 1
		const lifecycleEpoch = roiLifecycleEpoch.current
		const mutation = roiMutationQueue.current.then(async () => {
			if (lifecycleEpoch !== roiLifecycleEpoch.current) {
				throw new Error("Map ROI mutation cancelled because the map connection changed.")
			}
			await MapServiceClient.setActiveRoi(request)
		})
		roiMutationQueue.current = mutation.catch(() => {})
		return mutation
	}, [])

	const refreshSessionRoi = useCallback(async () => {
		const revision = ++roiGeneration.current
		const session = await MapServiceClient.getMapSession(EmptyRequest.create({}))
		if (revision === roiGeneration.current) {
			setActiveRoi(protoToActiveRoi(session.activeRoi))
		}
	}, [])

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

	return (
		<MapContext.Provider
			value={{
				connectionStatus,
				connectionError,
				reconnect,
				layers,
				activeRoi,
				addLayer,
				removeLayer,
				clearLayers,
				getLayer,
				setActiveRoiOnHost,
				refreshSessionRoi,
			}}>
			{children}
		</MapContext.Provider>
	)
}

export const useMapContext = () => {
	const context = useContext(MapContext)
	if (!context) {
		throw new Error("useMapContext must be used within MapContextProvider")
	}
	return context
}
