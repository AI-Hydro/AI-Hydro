// Response shapes of the mock account endpoints served by this e2e fixture. They lived in src/shared/AiHydroAccount.ts
// until the account stack was removed (X0-6); only the mock server uses them now.

export interface UserResponse {
	id: string
	email: string
	displayName: string
	photoUrl: string
	createdAt: string
	updatedAt: string
	organizations: [
		{
			active: boolean
			memberId: string
			name: string
			organizationId: string
			roles: ["admin" | "member" | "owner"]
		},
	]
}

export interface BalanceResponse {
	balance: number
	userId: string
}

export interface UsageTransaction {
	aiInferenceProviderName: string
	aiModelName: string
	aiModelTypeName: string
	completionTokens: number
	costUsd: number
	createdAt: string
	creditsUsed: number
	generationId: string
	id: string
	metadata: {
		additionalProp1: string
		additionalProp2: string
		additionalProp3: string
	}
	organizationId: string
	promptTokens: number
	totalTokens: number
	userId: string
}

export interface PaymentTransaction {
	paidAt: string
	creatorId: string
	amountCents: number
	credits: number
}

export interface OrganizationBalanceResponse {
	balance: number
	organizationId: string
}

export interface OrganizationUsageTransaction {
	aiInferenceProviderName: string
	aiModelName: string
	aiModelTypeName: string
	completionTokens: number
	costUsd: number
	createdAt: string
	creditsUsed: number
	generationId: string
	id: string
	memberDisplayName: string
	memberEmail: string
	metadata: {
		additionalProp1: string
		additionalProp2: string
		additionalProp3: string
	}
	organizationId: string
	promptTokens: number
	totalTokens: number
	userId: string
}
