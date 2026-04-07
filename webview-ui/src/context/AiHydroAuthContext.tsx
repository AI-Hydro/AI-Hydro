import type { UserOrganization } from "@shared/proto/cline/account"
import type React from "react"
import { createContext, useContext } from "react"

// Define User type (you may need to adjust this based on your actual User type)
export interface AiHydroUser {
	uid: string
	email?: string
	displayName?: string
	photoUrl?: string
	appBaseUrl?: string
}

export interface AiHydroAuthContextType {
	aihydroUser: AiHydroUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
}

export const AiHydroAuthContext = createContext<AiHydroAuthContextType | undefined>(undefined)

export const AiHydroAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	return (
		<AiHydroAuthContext.Provider
			value={{
				aihydroUser: null,
				organizations: null,
				activeOrganization: null,
			}}>
			{children}
		</AiHydroAuthContext.Provider>
	)
}

export const useAiHydroAuth = () => {
	const context = useContext(AiHydroAuthContext)
	if (context === undefined) {
		throw new Error("useAiHydroAuth must be used within a AiHydroAuthProvider")
	}
	return context
}

export const handleSignIn = async () => {
	console.warn("Account authorization is disabled in this build.")
}

export const handleSignOut = async () => {
	console.warn("Account authorization is disabled in this build.")
}
