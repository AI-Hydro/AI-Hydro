import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { AiHydroAuthInfo } from "../AuthService"

export interface IAuthProvider {
	readonly name: string
	config: EnvironmentConfig
	shouldRefreshIdToken(token: string, expiresAt?: number): Promise<boolean>
	retrieveAiHydroAuthInfo(controller: Controller): Promise<AiHydroAuthInfo | null>
	refreshToken(refreshToken: string): Promise<Partial<AiHydroAuthInfo>>
	getAuthRequest(callbackUrl: string): Promise<string>
	signIn(controller: Controller, authorizationCode: string, provider: string): Promise<AiHydroAuthInfo | null>
}
