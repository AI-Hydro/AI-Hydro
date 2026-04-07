enum AIHYDRO_API_AUTH_ENDPOINTS {
	AUTH = "/api/v1/auth/authorize",
	REFRESH_TOKEN = "/api/v1/auth/refresh",
}

enum AIHYDRO_API_ENDPOINT_V1 {
	TOKEN_EXCHANGE = "/api/v1/auth/token",
	USER_INFO = "/api/v1/users/me",
	ACTIVE_ACCOUNT = "/api/v1/users/active-account",
	REMOTE_CONFIG = "/api/v1/organizations/{id}/remote-config",
}

export const AIHYDRO_API_ENDPOINT = {
	...AIHYDRO_API_AUTH_ENDPOINTS,
	...AIHYDRO_API_ENDPOINT_V1,
}
