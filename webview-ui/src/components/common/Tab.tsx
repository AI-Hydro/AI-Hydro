import React, { HTMLAttributes, useCallback } from "react"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={`fixed inset-0 flex flex-col ${className}`} {...props}>
		{children}
	</div>
)

export const TabContent = ({ className, children, ...props }: TabProps) => {
	const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement

		// Prevent scrolling if the target is a listbox or option
		// (e.g. selects, dropdowns, etc).
		if (target.role === "listbox" || target.role === "option") {
			return
		}

		e.currentTarget.scrollTop += e.deltaY
	}, [])

	return (
		<div className={`flex-1 overflow-auto ${className}`} onWheel={onWheel} {...props}>
			{children}
		</div>
	)
}
