import { expect } from "chai"
import { describe, it } from "mocha"
import {
	type CommandPolicyInput,
	decideCommand,
	matchProtectedCommand,
	PROTECTED_COMMAND_DENY_MESSAGE,
	PROTECTED_PACK_SIGNING_DENY_MESSAGE,
	protectedCommandDenyMessage,
} from "../commandPolicy"

/**
 * Learning Pack signing (aihydro-pack sign / init-key) is an owner action: the host denies it for the agent the same
 * way it denies `aihydro-approve`, with the same escape variants. Like that matcher this is TEXT matching and a guard,
 * not a boundary (the passphrase is the real protection; see docs/learning-pack-authoring.md).
 */
const BASE: CommandPolicyInput = {
	command: "ls",
	modelRequiresApproval: false,
	autoApproveSafe: true,
	autoApproveAll: true,
	subagentsEnabled: true,
	touchesProtectedPath: false,
	shellEnvironment: { platform: "darwin", shell: "/bin/zsh", workspaceTrusted: true },
}

const DENIED = [
	"aihydro-pack sign x.unsigned --key k --out x",
	"aihydro-pack init-key",
	"aihydro-pack  sign x",
	"aihydro-pack\tsign x",
	"aihydro-pack \\\n sign x",
	"node dist/aihydro-pack.cjs sign x.unsigned --key k --out x",
	"node dist/aihydro-pack.cjs init-key --out d",
	"npx tsx scripts/aihydro-pack.ts sign x",
	"npm run aihydro-pack -- sign x",
	"npm run aihydro-pack --silent -- init-key",
	"npm run aihydro-pack sign x",
	"/opt/x/bin/aihydro-pack sign x",
	'"aihydro-pack" sign x',
	'aihydro-"pack" sign x',
	"aihydro-pa\\ck sign x",
	"AIHYDRO-PACK SIGN x",
	"sh -c 'aihydro-pack sign x'",
	"env aihydro-pack init-key",
	"cd x && aihydro-pack sign x",
	"ls; aihydro-pack init-key",
	"ls | aihydro-pack sign x",
	"echo $(aihydro-pack sign x)",
	"bash <<'EOF'\naihydro-pack sign x\nEOF",
	"aihydro-pack ${x}sign x",
	"aihydro-pack $''sign x",
	"aihydro-pack s\\ign x",
	"script -q /dev/null aihydro-pack init-key",
	"node -e \"require('./src/services/learning-pack/authoring/signPack')\"",
	"npx tsx src/services/learning-pack/authoring/keys.ts",
	"npx tsx src/services/learning-pack/authoring/cli.ts sign x",
	"npx ts-node src\\services\\learning-pack\\authoring\\signPack.ts",
	'aihydro "run aihydro-pack sign for me"', // a subagent prompt is scanned too
]

const ALLOWED = [
	"aihydro-pack verify x.aihydropack",
	"aihydro-pack verify design.aihydropack --expect-fingerprint sha256:abc",
	"aihydro-pack inspect x.aihydropack",
	"aihydro-pack build courses/c --out x.unsigned.aihydropack",
	"aihydro-pack build courses/c --out signed.aihydropack",
	"aihydro-pack fingerprint k.pub.pem",
	"node dist/aihydro-pack.cjs verify x.aihydropack",
	"node dist/aihydro-pack.cjs build c --out o",
	"node dist/aihydro-pack.cjs inspect sign.aihydropack",
	"npm run aihydro-pack -- verify x.aihydropack",
	"npm run build:pack-cli",
	"npx tsx scripts/aihydro-pack.ts build c --out o",
	"npx mocha src/services/learning-pack/authoring/__tests__/buildPack.test.ts",
	"ls src/services/learning-pack/authoring/__tests__",
	"cat docs/learning-pack-authoring.md",
]

describe("commandPolicy: Learning Pack signing is protected", () => {
	for (const form of DENIED) {
		it(`denies ${JSON.stringify(form)} even with requires_approval=false, YOLO and execute-all`, () => {
			expect(matchProtectedCommand(form), form).to.be.a("string")
			const result = decideCommand({ ...BASE, command: form })
			expect(result.action).to.equal("deny")
			if (result.action === "deny") {
				expect(result.message).to.equal(PROTECTED_PACK_SIGNING_DENY_MESSAGE)
				expect(result.message).to.include("your own terminal")
			}
		})
	}

	for (const form of ALLOWED) {
		it(`does not deny ${JSON.stringify(form)}`, () => {
			expect(matchProtectedCommand(form), form).to.equal(undefined)
			expect(decideCommand({ ...BASE, command: form, autoApproveAll: false, autoApproveSafe: false }).action).to.not.equal(
				"deny",
			)
		})
	}

	it("scans the raw model text even when a workspace-hint rewrite removed it", () => {
		const result = decideCommand({ ...BASE, command: "ls", rawCommand: "@backend:ls; aihydro-pack sign x" })
		expect(result.action).to.equal("deny")
	})

	it("keeps the claim-approval message for aihydro-approve and the signer message for the signer", () => {
		expect(protectedCommandDenyMessage("aihydro-approve")).to.equal(PROTECTED_COMMAND_DENY_MESSAGE)
		expect(protectedCommandDenyMessage("ai_hydro.approval")).to.equal(PROTECTED_COMMAND_DENY_MESSAGE)
		expect(protectedCommandDenyMessage("aihydro-pack sign")).to.equal(PROTECTED_PACK_SIGNING_DENY_MESSAGE)
		expect(protectedCommandDenyMessage("authoring/sign")).to.equal(PROTECTED_PACK_SIGNING_DENY_MESSAGE)
		expect(PROTECTED_PACK_SIGNING_DENY_MESSAGE).to.include("verify")
		expect(PROTECTED_COMMAND_DENY_MESSAGE).to.not.include("Learning Pack")
	})

	// The matcher reads text: indirection defeats it. Pinned so nobody mistakes it for a boundary.
	for (const form of ["a=aihydro-pack; ${a} sign x", "echo YWloeWRyby1wYWNrIHNpZ24= | base64 -d | sh", "./sign.sh"]) {
		it(`documents a known miss (indirection): ${JSON.stringify(form)}`, () => {
			expect(matchProtectedCommand(form)).to.equal(undefined)
		})
	}
})
