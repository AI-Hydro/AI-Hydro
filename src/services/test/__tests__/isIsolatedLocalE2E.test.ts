import assert from "node:assert/strict"
import { isIsolatedLocalE2E, shouldInitializeRemoteCatalogs } from "../isIsolatedLocalE2E"

describe("isIsolatedLocalE2E", () => {
	it("requires both the exact E2E marker and local environment", () => {
		assert.equal(isIsolatedLocalE2E({ E2E_TEST: "true", AIHYDRO_ENVIRONMENT: "local" }), true)
		assert.equal(isIsolatedLocalE2E({ E2E_TEST: "false", AIHYDRO_ENVIRONMENT: "local" }), false)
		assert.equal(isIsolatedLocalE2E({ E2E_TEST: "true", AIHYDRO_ENVIRONMENT: "production" }), false)
		assert.equal(isIsolatedLocalE2E({ E2E_TEST: "1", AIHYDRO_ENVIRONMENT: "local" }), false)
		assert.equal(isIsolatedLocalE2E({}), false)
	})

	it("suppresses remote catalogs only for the isolated local E2E host", () => {
		assert.equal(shouldInitializeRemoteCatalogs({ E2E_TEST: "true", AIHYDRO_ENVIRONMENT: "local" }), false)
		assert.equal(shouldInitializeRemoteCatalogs({ E2E_TEST: "true", AIHYDRO_ENVIRONMENT: "production" }), true)
		assert.equal(shouldInitializeRemoteCatalogs({ AIHYDRO_ENVIRONMENT: "local" }), true)
		assert.equal(shouldInitializeRemoteCatalogs({}), true)
	})
})
