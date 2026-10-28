export enum FeatureFlag {
	CUSTOM_INSTRUCTIONS = "custom-instructions",
	DEV_ENV_POSTHOG = "dev-env-posthog",
	FOCUS_CHAIN_CHECKLIST = "focus_chain_checklist",
	DO_NOTHING = "do_nothing",
	HOOKS = "hooks",
}

export const FEATURE_FLAGS = Object.values(FeatureFlag)
