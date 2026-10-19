import { readArtifactTrust } from "@shared/artifactTrust"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ArtifactTrustBar } from "../ArtifactTrustBar"

describe("ArtifactTrustBar", () => {
	const noop = () => {}

	it("labels a plain document as static, with no allow control", () => {
		render(<ArtifactTrustBar onAllow={noop} onRevoke={noop} trust={readArtifactTrust({})} />)
		expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Static document")
		expect(screen.queryByTestId("artifact-trust-allow")).not.toBeInTheDocument()
		expect(screen.queryByTestId("artifact-trust-revoke")).not.toBeInTheDocument()
	})

	it("labels an unsigned module clearly and offers no allow control", () => {
		render(<ArtifactTrustBar onAllow={noop} onRevoke={noop} trust={readArtifactTrust({ trustSource: "unsigned-module" })} />)
		expect(screen.getByTestId("artifact-trust-badge")).toHaveTextContent("Unsigned module")
		expect(screen.queryByTestId("artifact-trust-allow")).not.toBeInTheDocument()
	})

	it("offers Allow for a trusted source and Revoke once allowed", () => {
		const onAllow = vi.fn()
		const onRevoke = vi.fn()
		const { rerender } = render(
			<ArtifactTrustBar onAllow={onAllow} onRevoke={onRevoke} trust={readArtifactTrust({ trustSource: "learning-pack" })} />,
		)
		fireEvent.click(screen.getByTestId("artifact-trust-allow"))
		expect(onAllow).toHaveBeenCalledTimes(1)
		rerender(
			<ArtifactTrustBar
				onAllow={onAllow}
				onRevoke={onRevoke}
				trust={readArtifactTrust({ trustSource: "learning-pack", executionAllowed: "true" })}
			/>,
		)
		expect(screen.getByTestId("artifact-trust-bar")).toHaveAttribute("data-trust-state", "allowed")
		fireEvent.click(screen.getByTestId("artifact-trust-revoke"))
		expect(onRevoke).toHaveBeenCalledTimes(1)
	})
})

describe("readArtifactTrust", () => {
	it("fails closed on missing, unknown or malformed metadata", () => {
		expect(readArtifactTrust(undefined)).toEqual({ source: "document", trusted: false, allowed: false, canExecute: false })
		expect(readArtifactTrust({ trustSource: "root", executionAllowed: "true" }).canExecute).toBe(false)
	})

	it("ignores an allowance on an untrusted source", () => {
		expect(readArtifactTrust({ trustSource: "unsigned-module", executionAllowed: "true" }).canExecute).toBe(false)
		expect(readArtifactTrust({ trustSource: "document", executionAllowed: "true" }).canExecute).toBe(false)
	})

	it("requires both a trusted source and the allowance", () => {
		expect(readArtifactTrust({ trustSource: "e2e-fixture" }).canExecute).toBe(false)
		expect(readArtifactTrust({ trustSource: "e2e-fixture", executionAllowed: "true" }).canExecute).toBe(true)
	})
})
