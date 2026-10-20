import { cn } from "@heroui/react"
import HeroTooltip from "@/components/common/HeroTooltip"

/** Labelled (not a bare icon) so it is never mistaken for a dismiss control: it closes the current task view. */
const NewTaskButton: React.FC<{
	onClick: () => void
	className?: string
}> = ({ className, onClick }) => {
	return (
		<HeroTooltip content="Close current task to start a new one" delay={1000} placement="bottom">
			<button
				className={cn(
					"flex items-center gap-0.5 border-0 text-xs bg-transparent opacity-70 hover:opacity-100 whitespace-nowrap",
					className,
					"hover:bg-muted/10 px-1 cursor-pointer",
				)}
				onClick={(e) => {
					e.preventDefault()
					e.stopPropagation()
					onClick()
				}}
				type="button">
				<span aria-hidden="true" className="codicon codicon-add text-[12px]" />
				<span>New task</span>
			</button>
		</HeroTooltip>
	)
}

export default NewTaskButton
