import type { ReactNode } from "react"
import "./primitives.css"

export interface KeyValueItem {
	label: string
	value: ReactNode | null | undefined
}

export const NOT_REPORTED = "not reported"

const isMissing = (value: ReactNode | null | undefined) =>
	value === null || value === undefined || (typeof value === "string" && value.trim() === "")

/** Definition list. A missing value renders "not reported", never blank and never inferred. */
export function KeyValue({ items }: { items: KeyValueItem[] }) {
	return (
		<dl className="aih-kv">
			{items.map((item) => (
				<div key={item.label} style={{ display: "contents" }}>
					<dt>{item.label}</dt>
					<dd>{isMissing(item.value) ? <span className="aih-kv__missing">{NOT_REPORTED}</span> : item.value}</dd>
				</div>
			))}
		</dl>
	)
}
