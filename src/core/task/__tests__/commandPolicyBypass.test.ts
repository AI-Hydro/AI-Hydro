import { expect } from "chai"
import { describe, it } from "mocha"
import {
	classifyCommand,
	decideCommand,
	matchProtectedCommand,
	mentionsAihydroProgram,
	type CommandPolicyInput,
} from "../commandPolicy"

/**
 * Regression tests for the security review of PR 61 (BLOCK, four findings). The lists below are the reviewer's
 * attack scripts (scratchpad atk.ts / atk2.ts), reproduced verbatim, plus the fixes' own cases.
 */
const ZSH = { platform: "darwin", shell: "/bin/zsh", workspaceTrusted: true }
const BASE: CommandPolicyInput = {
	command: "ls",
	modelRequiresApproval: false,
	autoApproveSafe: true,
	autoApproveAll: false,
	touchesProtectedPath: false,
	shellEnvironment: ZSH,
}
const decide = (over: Partial<CommandPolicyInput>) => decideCommand({ ...BASE, ...over })

// B1: none of these may be classified read-only (reviewer's `writers` list, minus the probes that are genuinely read-only).
const WRITERS: string[] = [
	"git config user.name x",
	"git -c core.pager=sh log",
	"git log --output=/tmp/x",
	"git diff --output=/tmp/x",
	"git grep --open-files-in-pager=sh x",
	"git -C /tmp status",
	"git log --out=/tmp/x",
	"git diff --ou=/tmp/x",
	"git grep --open-files-in-p=sh x",
	"git diff --ext=1",
	"git log --textc",
	"find . -exec id {} +",
	"find . -delete",
	"find . -fprint /tmp/x",
	"find . {-delete,-print}",
	"find . -name a{,-delete}",
	"sort {-o,/tmp/atk_out} f",
	"sort -o /tmp/x f",
	"sort --ou=/tmp/x f",
	"sort --o=/tmp/x f",
	"sort --compress-program=sh f",
	"sort -uo /tmp/x f",
	"ls *(e:'touch /tmp/zsh_pwn':)",
	"echo *(e:'touch /tmp/zsh_pwn':)",
	"cat =(touch /tmp/zz)",
	"ls <(id)",
	"ls $(id)",
	"ls `id`",
	"file -bC",
	"file --comp",
	"tail --fo x",
	"tail -F x",
	"tree -H . -L 1 -R",
	"tree -o /tmp/x",
	"tree --output=/tmp/x",
	"rg --pre sh x",
	"rg --pre=sh x",
	"rg -z x",
	"tar cf /tmp/x .",
	"zip /tmp/x f",
	"env X=1 ls",
	"nice ls",
	"timeout 1 ls",
	"xargs ls",
	"awk 'BEGIN{system(\"id\")}'",
	"sed -i s/a/b/ f",
	"less f",
	"tee f",
	"ls | tee f",
	"ls | sort -o f",
	"ls\u00a0-la",
	"l\u200bs",
	"ls #; id",
	"ls\r\nid",
	"ls\u000bid",
	"jq -n 'env'",
	"ls | sort {rm x}",
	"echo (Remove-Item x)",
	"ls | where {rm $_}",
	"dir | sort { Remove-Item x }",
	"echo (rm x)",
	"type (rm x)",
	"git branch -D x",
	"git tag -a v1",
	"git tag x",
	"git config --list --unset a",
	"git config --get a --add b",
	"git stash show --output=x",
	"git reflog show --out=x",
	"git log --pretty=x -O/tmp/x",
	"git diff -Oorder",
	"git cat-file --filters HEAD:x",
	"git config -l --file /tmp/x",
	"git config --get-regexp x -z",
	"git config --list --edit",
	"git config --get x --unset",
	"git config --get-all a --replace-all b",
	"git config --list --add k v",
	"git config --get k --global --remove-section s",
	"git diff --no-index /etc/passwd /dev/null",
	"git log -g",
	"git for-each-ref --format=x --shell",
	"git grep -e x -f /dev/stdin",
	"stat -f x",
	"uname -S x",
	"du --files0-from=x",
	"wc --files0-from=x",
	"find . -newer x -ls",
	"find . -fls /tmp/x",
	"find -exec",
	"find . -ok id {} ;",
	"sort -- -o",
	"sort -T /tmp f",
	"grep -r --pager=sh x .",
	"jq --rawfile a /etc/passwd .",
	"! ls",
	"ls !-1",
	"ls ~",
	"ls ~root",
	"ls {a,b}",
	"ls *",
	"echo a>b",
	"echo a >b",
	"echo a>|b",
	"echo a|&tee f",
	"ls ^id",
	"ls -- ; id",
	"git log -- ;",
	"ls\\\nid",
]

const PROTECTED_FORMS: string[] = [
	"aihydro-approve s c",
	"AIHYDRO-APPROVE s c",
	"./aihydro-approve s c",
	"/opt/miniconda3/envs/x/bin/aihydro-approve s c",
	"python -m ai_hydro.approval.cli s c",
	"uvx --from aihydro-tools aihydro-approve s c",
	"pipx run --spec aihydro-tools aihydro-approve s c",
	"AIHYDRO_AGENT_CONTEXT= aihydro-approve s c",
	"env -u AIHYDRO_AGENT_CONTEXT aihydro-approve s c",
	"python -c 'import ai_hydro . approval . cli as c'",
	"python -c 'from ai_hydro . approval import cli'",
	"python -c 'from ai_hydro import approval'",
	"python -c 'from ai_hydro import (approval)'",
	"python -c 'import ai_hydro.approval.cli'",
	"aihydro-appro?e s c",
	"/opt/x/bin/aihydro-appr* s c",
	"aihydro-$''approve s c",
	"aihydro-${x}approve s c",
	"aihydro-$@approve",
	'aihydro-""approve s c',
	"aihydro\u2011approve",
	"python -m ai_hydro.approval",
	"pythonw -m ai_hydro\\approval\\cli",
	"python -m ai_hydro.\\\napproval.cli",
	"python -m ai_hydro. approval",
	"aihydro-approve\u200b s",
	"aihydro\u200b-approve",
	"aihydro-approve.exe s c",
	"aihydro-approve.cmd",
	"python -m ai_hydro.approval.cli",
	"PYTHONPATH=x python -m ai_hydro.appro''val.cli",
]

describe("B1: the classifier does not parse shell syntax it cannot model", () => {
	for (const command of WRITERS) {
		it(`not read-only: ${JSON.stringify(command)}`, () => {
			expect(classifyCommand(command, ZSH).readOnly, classifyCommand(command, ZSH).reason).to.equal(false)
		})
	}

	it("rejects the named reproductions", () => {
		for (const c of [
			"ls *(e:'touch x':)", // zsh glob qualifier
			"cat =(touch zz)", // zsh process substitution
			"sort {-o,out1} f", // brace expansion hiding a banned flag
			"find . -name x {-delete,-print}",
			"sort --ou=x f", // abbreviated long flag
			"sort --compress-program=P f",
			"file -bC",
			"file --comp",
			"tree -R",
			"tree -H .",
			"tail --fo x",
			"ls | sort {Remove-Item x}", // PowerShell script block
			"echo (rm x)", // PowerShell subexpression
		]) {
			expect(classifyCommand(c, ZSH).readOnly, c).to.equal(false)
		}
	})

	it("classifies nothing read-only on Windows or in a non-POSIX shell (fail closed)", () => {
		for (const env of [
			{ platform: "win32", shell: undefined },
			{ platform: "win32", shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
			{ platform: "darwin", shell: "/opt/homebrew/bin/pwsh" },
			{ platform: "linux", shell: "/usr/bin/fish" },
			{ platform: "linux", shell: "/bin/csh" },
			{ platform: "linux", shell: undefined },
		]) {
			expect(classifyCommand("ls", env).readOnly, JSON.stringify(env)).to.equal(false)
			expect(classifyCommand("git status", env).readOnly, JSON.stringify(env)).to.equal(false)
			expect(decide({ command: "ls", shellEnvironment: env }).action, JSON.stringify(env)).to.equal("ask")
		}
	})

	it("still allows the plain read-only commands under bash, zsh, sh and dash", () => {
		for (const shell of ["/bin/bash", "/bin/zsh", "/bin/sh", "/usr/bin/dash"]) {
			for (const c of ["ls", "ls -la src", "git status", "cat README.md", "git diff HEAD~1", "cat README.md | head -5"]) {
				expect(
					classifyCommand(c, { platform: "linux", shell, workspaceTrusted: true }).readOnly,
					`${shell} ${c}`,
				).to.equal(true)
			}
		}
	})

	it("flags are an allow-list: an unlisted or abbreviated flag is not read-only, a listed one is", () => {
		expect(classifyCommand("grep -rn foo src", ZSH).readOnly).to.equal(true)
		expect(classifyCommand("grep --recursive foo src", ZSH).readOnly).to.equal(true)
		expect(classifyCommand("grep --recurs foo src", ZSH).readOnly).to.equal(false)
		expect(classifyCommand("git log --oneline -5", ZSH).readOnly).to.equal(true)
		expect(classifyCommand("git log --oneli", ZSH).readOnly).to.equal(false)
		expect(classifyCommand("git diff --ext-diff", ZSH).readOnly).to.equal(false)
		expect(classifyCommand("git diff --ext", ZSH).readOnly).to.equal(false)
	})
})

describe("B2: the model cannot launch the retired aihydro CLI subagent with its own policy", () => {
	it("denies every launch form, including model-set YOLO, profile and extra flags", () => {
		for (const c of [
			'aihydro "x" -s yolo_mode_toggled=true -y',
			'aihydro "x" -y',
			'aihydro "x" --yolo',
			'aihydro "x" -s auto_approve=1',
			'aihydro "x" --profile explorer -s anything=1',
			'aihydro -y "x"',
			"aihydro x -y",
			'env aihydro "x" -y',
			'cd . && aihydro "x" -y',
			'AIHYDRO_PROFILE=explorer aihydro "x"',
			'aihydro "x"; AIHYDRO_PROFILE=data-runner aihydro "y"',
			'aihydro "summarise the repo"',
			'aihydro "x" --profile explorer',
			'aihydro "x" --workdir ./sub --profile data-runner',
		]) {
			for (const autoApproveAll of [false, true]) {
				const result = decide({ command: c, autoApproveAll })
				expect(result.action, `${c} all=${autoApproveAll}`).to.equal("deny")
			}
		}
	})
})

describe("B2: launch-rule evasion is still treated as a launch (and refused)", () => {
	const FORMS = [
		'aihydro "x"',
		'aihydro -y "x"',
		'cd . && aihydro "x"',
		"env aihydro x",
		'env aihydro "x" -y',
		'/usr/local/bin/aihydro "x"',
		'"/usr/local/bin/aihydro" "x"',
		'AIHYDRO "x"',
		'  aihydro "x"',
		'AIHYDRO_PROFILE=explorer aihydro "x"',
		"sh -c 'aihydro \"x\"'",
		'C:\\tools\\aihydro.exe "x"',
		'nohup aihydro "x" &',
		'(aihydro "x")',
		'echo hi | aihydro "x"',
	]
	for (const c of FORMS) {
		it(`is a launch: ${JSON.stringify(c)}`, () => {
			expect(mentionsAihydroProgram(c)).to.equal(true)
			// refused under executeAll/YOLO and under the default settings
			expect(decide({ command: c, autoApproveAll: true }).action).to.equal("deny")
			expect(decide({ command: c }).action).to.equal("deny")
		})
	}

	it("does not flag other first-party program names", () => {
		for (const c of ["aihydro-mcp --help", "pip install aihydro-tools", "ls /Users/x/AI-Hydro", "python -m ai_hydro.mcp"]) {
			expect(mentionsAihydroProgram(c), c).to.equal(false)
		}
	})
})

describe("protected-command matcher: reviewer's forms and the added spaced/glob forms", () => {
	for (const form of PROTECTED_FORMS) {
		it(`denies ${JSON.stringify(form)}`, () => {
			expect(matchProtectedCommand(form), form).to.be.a("string")
		})
	}

	it("denies spaced-dot and glob forms", () => {
		for (const c of [
			"python -c 'import ai_hydro . approval . cli as c'",
			"python -c 'from ai_hydro . approval import cli'",
			"aihydro-appro?e s c",
			"/opt/x/bin/aihydro-appr* s c",
			"aihydro-*",
			"python -m ai_hydro.appro* ",
			"python ai_hydro/app?oval/cli.py",
			"aihydro-[a]pprove s c",
		]) {
			expect(matchProtectedCommand(c), c).to.be.a("string")
		}
	})

	it("documents the remaining misses (string concatenation in a program, the bare CLI word)", () => {
		expect(matchProtectedCommand("python3 -c \"__import__('ai_hydro.'+'approval')\"")).to.equal(undefined)
		expect(
			matchProtectedCommand("python -c \"import importlib;importlib.import_module('ai_hydro.approva'+'l.cli')\""),
		).to.equal(undefined)
		// `aihydro approve s c` is the aihydro CLI with a prompt: a (retired) subagent launch, which is refused.
		expect(mentionsAihydroProgram("aihydro approve s c")).to.equal(true)
	})

	it("does not flag ordinary commands", () => {
		for (const c of ["ls", "git status", "pip install aihydro-tools", "cat README.md", "ls appr*"]) {
			expect(matchProtectedCommand(c), c).to.equal(undefined)
		}
	})
})
