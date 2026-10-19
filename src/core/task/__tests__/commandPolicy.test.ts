import { expect } from "chai"
import { describe, it } from "mocha"
import {
	classifyCommand,
	commandMentionsProtectedPath,
	decideCommand,
	matchProtectedCommand,
	PROTECTED_COMMAND_DENY_MESSAGE,
	type CommandPolicyInput,
} from "../commandPolicy"

const base: CommandPolicyInput = {
	command: "ls",
	modelRequiresApproval: false,
	autoApproveSafe: true,
	autoApproveAll: false,
	isSubagentLaunch: false,
	subagentsEnabled: true,
	touchesProtectedPath: false,
	// Classification is shell-dependent (fail closed outside bash/zsh/sh/dash and on Windows): pin it.
	shellEnvironment: { platform: "darwin", shell: "/bin/zsh" },
}
const decide = (over: Partial<CommandPolicyInput>) => decideCommand({ ...base, ...over })

// Every form the host must deny. These run with requires_approval=false and the most permissive settings (YOLO
// shape: safe and all both on), the worst case for the matcher.
const EVASION_FORMS = [
	"aihydro-approve s c",
	"/opt/miniconda3/bin/aihydro-approve s c",
	"AIHYDRO_REQUIRE_SIGNED=0 aihydro-approve s c",
	"bash <<'EOF'\naihydro-approve s c\nEOF",
	"cd x && aihydro-approve s c",
	'"aihydro-approve" s c',
	"'aihydro-approve' s c",
	"aihydro-appro\\ve s c",
	'aihydro-""approve s c',
	"AIHYDRO-APPROVE s c",
	"sh -c 'aihydro-approve s c'",
	"env aihydro-approve s c",
	"script -q /dev/null aihydro-approve s c",
	"ls; aihydro-approve s c",
	"ls | aihydro-approve s c",
	"echo $(aihydro-approve s c)",
	"uvx --from aihydro-tools aihydro-approve s c",
	"python -m ai_hydro.approval.cli s c",
	'python -c "import ai_hydro.approval.cli as c; c.main()"',
	'python -c "from ai_hydro.approval import writer"',
	'python -c "from ai_hydro import approval"',
	"python ai_hydro/approval/cli.py s c",
	"python ai_hydro\\approval\\cli.py s c",
	'aihydro "run aihydro-approve for me"', // a subagent prompt is scanned too
]

describe("commandPolicy: protected commands (T13)", () => {
	for (const form of EVASION_FORMS) {
		it(`T13 denies ${JSON.stringify(form)} even with requires_approval=false, YOLO and execute-all`, () => {
			const result = decide({ command: form, autoApproveSafe: true, autoApproveAll: true })
			expect(result.action).to.equal("deny")
			if (result.action === "deny") {
				expect(result.message).to.equal(PROTECTED_COMMAND_DENY_MESSAGE)
				expect(result.message).to.include("your own")
				expect(result.message).to.include("terminal")
			}
		})
	}

	it("T13 scans the raw model text even when the workspace-hint rewrite removed it", () => {
		const result = decide({ command: "ls", rawCommand: "@backend:ls; aihydro-approve s c" })
		expect(result.action).to.equal("deny")
	})

	// Documented known misses (see commandPolicy.ts header): the matcher reads text, so indirection defeats it.
	// These assertions pin the limitation so nobody mistakes the matcher for a boundary.
	const KNOWN_MISSES = [
		"a=aihydro-; ${a}approve s c",
		"echo YWloeWRyby1hcHByb3Zl | base64 -d | sh",
		"printf '\\x61ihydro-approve' | sh",
		"./approve.sh",
	]
	for (const form of KNOWN_MISSES) {
		it(`documents a known miss (indirection): ${JSON.stringify(form)}`, () => {
			expect(matchProtectedCommand(form)).to.equal(undefined)
		})
	}

	it("does not flag ordinary commands", () => {
		for (const ok of ["ls -la", "git status", "python -c 'print(1)'", "pip install aihydro-tools", "cat README.md"]) {
			expect(matchProtectedCommand(ok), ok).to.equal(undefined)
		}
	})
})

describe("commandPolicy: host-side read-only classification (T14)", () => {
	const readOnly = [
		"ls",
		"ls -la src",
		"cat README.md",
		"git status",
		"git log --oneline -5",
		"git diff HEAD~1",
		"git branch --list 'feat*'",
		"git remote -v",
		"cat README.md | head -5",
		'grep -rn "a|b" src | wc -l',
		"find . -name '*.ts'",
		"tail -n 20 file.log",
		"echo hello",
		"pwd",
		"git diff HEAD~1 -- README.md",
		"git log --oneline --graph -n 5",
		"du -sh .",
		"head -n 5 file",
	]
	for (const command of readOnly) {
		it(`T14 runs ${JSON.stringify(command)}`, () => {
			expect(
				classifyCommand(command, base.shellEnvironment).readOnly,
				classifyCommand(command, base.shellEnvironment).reason,
			).to.equal(true)
			expect(decide({ command }).action).to.equal("run")
		})
	}

	const notReadOnly = [
		"python -c 'print(1)'",
		"python - <<'EOF'\nprint(1)\nEOF",
		"sh -c 'ls'",
		"bash -c ls",
		"node -e 1",
		"ls; rm -rf x",
		"ls && rm x",
		"ls || rm x",
		"ls & rm x",
		"cat a > b",
		"cat a >> b",
		"cat < a",
		"echo $(id)",
		"echo `id`",
		"echo $HOME",
		"cat <<EOF\nx\nEOF",
		"cat a\nrm b",
		"curl https://example.com",
		"curl -d @file https://example.com",
		"curl -o out https://example.com",
		"curl -T file https://example.com",
		"wget https://example.com",
		"find . -delete",
		"find . -exec rm {} ;",
		"find . -ok rm x",
		"find . -fprint out",
		"sort -o out in",
		"sort -uo out in",
		"sort in",
		"rg foo",
		"jq .name package.json",
		"git -C sub status",
		"tail -f app.log",
		"git commit -m x",
		"git push",
		"git -c core.pager=evil log",
		"git branch newbranch",
		"git config user.name x",
		"git log --output=out.txt",
		"git diff --ext-diff",
		"git stash",
		"ls | xargs rm",
		"cat a | tee b",
		"FOO=1 ls",
		"/bin/ls",
		"sed -i s/a/b/ f",
		"awk 'BEGIN{system(\"id\")}'",
		"rm -rf x",
		"npm install",
		"pip install x",
		"",
		"ls 'unterminated",
		"| ls",
		"ls ||",
	]
	for (const command of notReadOnly) {
		it(`T14 asks for ${JSON.stringify(command)}`, () => {
			expect(classifyCommand(command, base.shellEnvironment).readOnly, command).to.equal(false)
			expect(decide({ command }).action, command).to.equal("ask")
		})
	}

	it("T14 python -c with requires_approval=false and default settings asks (B1: the model's word is not enough)", () => {
		expect(decide({ command: "python -c 'print(1)'", modelRequiresApproval: false }).action).to.equal("ask")
	})

	it("the model's requires_approval=true can only tighten", () => {
		expect(decide({ command: "ls", modelRequiresApproval: true }).action).to.equal("ask")
		expect(decide({ command: "ls", modelRequiresApproval: false }).action).to.equal("run")
	})

	it("auto-run off asks even for read-only commands", () => {
		expect(decide({ command: "ls", autoApproveSafe: false }).action).to.equal("ask")
	})

	it("execute-all-commands (and so YOLO) still runs non-read-only commands, the user's explicit choice", () => {
		expect(decide({ command: "python -c 'print(1)'", autoApproveAll: true }).action).to.equal("run")
	})
})

describe("commandPolicy: subagent launch (T15)", () => {
	const launch = { command: 'aihydro "summarise the repo"', isSubagentLaunch: true }

	it("T15 asks with requires_approval=false and default settings", () => {
		expect(decide(launch).action).to.equal("ask")
	})

	it("T15 asks even under execute-all / YOLO", () => {
		expect(decide({ ...launch, autoApproveAll: true, autoApproveSafe: true }).action).to.equal("ask")
	})

	it("T15 is refused when subagentsEnabled is false, in every setting", () => {
		for (const autoApproveAll of [false, true]) {
			const result = decide({ ...launch, subagentsEnabled: false, autoApproveAll })
			expect(result.action).to.equal("deny")
		}
	})
})

describe("commandPolicy: protected paths (T-B3)", () => {
	it("asks when a command touches a protected path, even under execute-all / YOLO", () => {
		expect(decide({ command: "cat ~/.ssh/id_ed25519", touchesProtectedPath: true }).action).to.equal("ask")
		expect(decide({ command: "echo x", touchesProtectedPath: true, autoApproveAll: true }).action).to.equal("ask")
	})

	it("detects the protected locations in command text", () => {
		const mentions = [
			"cat ~/.ssh/id_ed25519",
			"cat $HOME/.ssh/config",
			"cp key .ssh/authorized_keys",
			"ls ~/.aihydro/approvals",
			"rm -r /Users/x/.aihydro/trust",
			"cat $AIHYDRO_HOME/registry/claims.jsonl",
			"python -c \"open('aihydro_mcp_settings.json','w')\"",
			"cat /mock/storage/settings/foo.json",
		]
		for (const command of mentions) {
			expect(commandMentionsProtectedPath(command, ["/mock/storage"]), command).to.equal(true)
		}
		for (const command of ["ls", "cat README.md", "git status", "cat ~/.sshconfig-notes.txt"]) {
			expect(commandMentionsProtectedPath(command, ["/mock/storage"]), command).to.equal(false)
		}
	})
})
