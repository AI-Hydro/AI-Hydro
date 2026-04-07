import { EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Handles the user clicking the login link in the UI.
 * Generates a secure nonce for state validation, stores it in secrets,
 * and opens the authentication URL in the external browser.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function ocaAccountLoginClicked(_controller: Controller, _: EmptyRequest): Promise<ProtoString> {
	// OCA account authorization is intentionally disabled in AI-Hydro lightweight mode.
	return ProtoString.create({ value: "" })
}
