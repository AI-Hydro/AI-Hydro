import { NewTaskRequest } from "@shared/proto/cline/task"
import { Badge, Button, KeyValue, Text } from "@/design"
import { TaskServiceClient } from "@/services/grpc-client"
import "./welcome.css"
import { type StarterInvestigation, starterInvestigations } from "./starterPrompts"

const startInvestigation = (starter: StarterInvestigation) =>
	TaskServiceClient.newTask(NewTaskRequest.create({ text: starter.prompt, images: [] })).catch((error) =>
		console.error("Failed to start investigation:", error),
	)

/** Three hydrology starters. Each says what it will fetch and that the network is needed; none promises a result. */
export function StarterInvestigations() {
	return (
		<section aria-labelledby="starter-investigations-title" className="starter-list">
			<Text as="h2" id="starter-investigations-title" muted variant="label">
				Start an investigation
			</Text>
			{starterInvestigations.map((starter) => (
				<article aria-labelledby={`starter-${starter.id}`} className="starter-card" key={starter.id}>
					<Text as="h3" id={`starter-${starter.id}`} strong variant="body">
						{starter.title}
					</Text>
					<Text as="p" muted variant="label">
						{starter.description}
					</Text>
					<KeyValue items={[{ label: "Fetches", value: starter.fetches }]} />
					<div className="starter-card__footer">
						{starter.needsNetwork && <Badge icon="globe">Network needed</Badge>}
						<Button icon="play" onClick={() => void startInvestigation(starter)} variant="primary">
							{`Start: ${starter.title}`}
						</Button>
					</div>
				</article>
			))}
		</section>
	)
}
