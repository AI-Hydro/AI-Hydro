/**
 * Starter investigations shown on the chat home. Prompts ask for a procedure, never for an outcome:
 * they promise no result, name no value, and tell the agent to stop and ask when a gauge is ambiguous.
 * Each entry states what will be fetched and that the network is needed, so the user can decide.
 */
export interface StarterInvestigation {
	id: string
	title: string
	description: string
	/** What the agent will fetch or read, shown on the card. */
	fetches: string
	/** Always true today: every starter reaches external data services. */
	needsNetwork: boolean
	/** Sent as the first task message. */
	prompt: string
}

export const starterInvestigations: StarterInvestigation[] = [
	{
		id: "camels-basin-to-claim",
		title: "Gauged basin to a recorded claim",
		description:
			"Delineate a CAMELS-US basin, compute its hydrologic signatures, and record what the evidence supports as a claim.",
		fetches:
			"Gauge metadata, basin geometry and the streamflow record from the AI-Hydro data sources (for example USGS water data services, as configured).",
		needsNetwork: true,
		prompt: "Investigate one gauged CAMELS-US basin with my AI-Hydro tools. Ask me for the gauge_id if I have not given one, and stop and ask if the gauge is ambiguous or not found. Delineate the watershed, compute hydrologic signatures, and record any conclusion as a claim that cites the runs it rests on. Report which tools and data sources you used, and say plainly when something could not be checked.",
	},
	{
		id: "usgs-hydrograph-quality",
		title: "USGS hydrograph with quality flags",
		description:
			"Retrieve a gauge's daily streamflow record and describe its length, gaps, provisional data and qualifier codes.",
		fetches: "Daily streamflow values and their approval/qualifier codes from USGS water data services (as configured).",
		needsNetwork: true,
		prompt: "Retrieve the daily streamflow record for a USGS gauge. Ask me for the gauge_id if I have not given one, and stop and ask if it is ambiguous or not found. Describe the record length, gaps, how much of it is provisional rather than approved, and which qualifier codes appear. Do not fill gaps. Plot the hydrograph and state the units shown by the data.",
	},
	{
		id: "model-vs-observed",
		title: "Modelled vs observed streamflow",
		description: "Compare a model's streamflow with the gauge record, keeping observed and modelled series clearly separate.",
		fetches: "The observed record from USGS water data services (as configured) and the modelled series from the model run you choose.",
		needsNetwork: true,
		prompt: "Compare modelled and observed streamflow for a gauge. Ask me for the gauge_id and which model run to use if I have not said, and stop and ask if either is unclear. Label which series is observed and which is modelled, report agreement metrics with uncertainty intervals where the tools provide them, and say when a metric cannot be computed instead of estimating it.",
	},
]
