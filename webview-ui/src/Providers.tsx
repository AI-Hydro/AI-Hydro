import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { BrushContextProvider } from "./context/BrushContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { HtmlPreviewContextProvider } from "./context/HtmlPreviewContext"
import { LedgerContextProvider } from "./context/LedgerContext"
import { MapContextProvider } from "./context/MapContext"
import { PlatformProvider } from "./context/PlatformContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<MapContextProvider>
					<BrushContextProvider>
						<LedgerContextProvider>
							<HtmlPreviewContextProvider>
								<CustomPostHogProvider>
									<HeroUIProvider>{children}</HeroUIProvider>
								</CustomPostHogProvider>
							</HtmlPreviewContextProvider>
						</LedgerContextProvider>
					</BrushContextProvider>
				</MapContextProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
