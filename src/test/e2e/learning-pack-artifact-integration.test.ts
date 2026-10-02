import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"

const sourceArchive = process.env.AIHYDRO_PHASE1_PACK_PATH
const expectedBookModuleId = process.env.AIHYDRO_EXPECTED_BOOK_MODULE_ID ?? "hmfp.water-balance.01"
const courseEntryModuleId = "hmfp.orientation.00"

interface LifecycleSession {
	launch: () => Promise<{ app: ElectronApplication; page: Page }>
	close: () => Promise<number | null>
}

function processIsRunning(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

const artifactIntegrationE2E = e2e
	.extend<{ workspaceDir: string }>({
		workspaceDir: async ({}, use) => {
			if (!sourceArchive) throw new Error("AIHYDRO_PHASE1_PACK_PATH is required")
			const root = mkdtempSync(path.join(os.tmpdir(), "aihydro-phase1-artifact-workspace-"))
			const workspace = path.join(root, "workspace")
			cpSync(path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures", "workspace"), workspace, { recursive: true })
			cpSync(sourceArchive, path.join(workspace, "book-student.aihydropack"))
			const pythonInterpreter = process.env.AIHYDRO_E2E_PYTHON
			if (!pythonInterpreter) throw new Error("AIHYDRO_E2E_PYTHON is required")
			mkdirSync(path.join(workspace, ".vscode"), { recursive: true })
			writeFileSync(
				path.join(workspace, ".vscode", "settings.json"),
				JSON.stringify({
					"aihydro.htmlPreview.pythonExecution": "always",
					"aihydro.htmlPreview.pythonInterpreter": pythonInterpreter,
					"aihydro.htmlPreview.pythonTimeoutSeconds": 60,
				}),
			)
			try {
				await use(workspace)
			} finally {
				rmSync(root, { recursive: true, force: true })
			}
		},
	})
	.extend<{ lifecycle: LifecycleSession }>({
		lifecycle: async ({ openVSCode, workspaceDir, userDataDir, extensionsDir, homeDir }, use) => {
			let current: ElectronApplication | null = null
			const close = async () => {
				if (!current) return null
				const app = current
				current = null
				const pid = app.process().pid
				await E2ETestHelper.closeElectronApp(app)
				try {
					await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
				} catch {
					if (processIsRunning(pid)) app.process().kill()
					await E2ETestHelper.waitUntil(() => !processIsRunning(pid), 15_000)
				}
				return pid
			}
			let testFailure: unknown
			try {
				await use({
					launch: async () => {
						await close()
						current = await openVSCode(workspaceDir)
						const page = await current.firstWindow()
						await page.waitForLoadState("domcontentloaded")
						await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 20_000 })
						return { app: current, page }
					},
					close,
				})
			} catch (error) {
				testFailure = error
			}
			const cleanupFailures: unknown[] = []
			try {
				await close()
			} catch (error) {
				cleanupFailures.push(error)
			}
			const cleanupResults = await Promise.allSettled([
				E2ETestHelper.rmForRetries(userDataDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(extensionsDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(homeDir, { recursive: true, force: true }),
			])
			for (const result of cleanupResults) {
				if (result.status === "rejected") cleanupFailures.push(result.reason)
			}
			if (cleanupFailures.length > 0) {
				if (testFailure !== undefined) cleanupFailures.unshift(testFailure)
				throw new AggregateError(cleanupFailures, "Learning Pack real-panel teardown failed")
			}
			if (testFailure !== undefined) throw testFailure
		},
	})

artifactIntegrationE2E.setTimeout(420_000)
artifactIntegrationE2E.skip(!sourceArchive, "requires a pinned book-built Learning Pack artifact")

async function waitForFrame(page: Page, predicate: (frame: Frame) => Promise<boolean>): Promise<Frame> {
	let result: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (frame.isDetached()) continue
					try {
						if (await predicate(frame)) {
							result = frame
							return true
						}
					} catch {
						// VS Code replaces panel frames during registration and navigation.
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	return result as Frame
}

async function waitForCourseShell(page: Page): Promise<Frame> {
	return waitForFrame(
		page,
		async (frame) =>
			(await frame.title()) === "AI-Hydro HTML Preview" && (await frame.getByTitle("Course options").count()) === 1,
	)
}

async function waitForCellFrame(page: Page, cellId: string): Promise<Frame> {
	const selector = `[data-aihydro-cell-id="${cellId}"]`
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			if (frame.isDetached()) continue
			try {
				const count = await frame.locator(selector).count()
				if (count !== 1) continue
				let ancestor = frame.parentFrame()
				let belongsToActivePreview = false
				while (ancestor && !ancestor.isDetached()) {
					if (
						(await ancestor.title()) === "AI-Hydro HTML Preview" &&
						(await ancestor.getByTitle("Course options").count()) === 1
					) {
						belongsToActivePreview = true
						break
					}
					ancestor = ancestor.parentFrame()
				}
				if (belongsToActivePreview && !frame.isDetached() && (await frame.locator(selector).count()) === 1) {
					return frame
				}
			} catch {
				// VS Code may replace either the shell or srcdoc frame while navigation settles.
			}
		}
		await page.waitForTimeout(100)
	}
	throw new Error(`Timed out waiting for one active executable cell: ${cellId}`)
}

async function runCell(frame: Frame, cellId: string): Promise<Locator> {
	const cell = frame.locator(`[data-aihydro-cell-id="${cellId}"]`)
	const run = cell.locator(".aihydro-run")
	await expect(run).toHaveAttribute("data-aihydro-wired", "1", { timeout: 30_000 })
	await run.evaluate((element: HTMLElement) => element.click())
	return cell.locator(".aihydro-output")
}

async function expectPng(cell: Locator): Promise<void> {
	const image = cell.locator('.aihydro-output-images img[src^="data:image/png;base64,"]').first()
	await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/, { timeout: 60_000 })
	const source = await image.getAttribute("src")
	expect(source?.length ?? 0).toBeGreaterThan(1_000)
}

interface BookModuleRuntimeContract {
	id: string
	title: string
	stateCellId: string
	stateOutput: (string | RegExp)[]
	setupCells?: readonly {
		id: string
		output: readonly (string | RegExp)[]
	}[]
	plotCellId: string
	plotOutput?: (string | RegExp)[]
	errorCellId: string
	errorOutput: (string | RegExp)[]
	recoveryCellId: string
	recoveryOutput: (string | RegExp)[]
}

const BOOK_MODULES: readonly BookModuleRuntimeContract[] = [
	{
		id: "hmfp.water-balance.01",
		title: "Close a Watershed Water Balance",
		stateCellId: "hmfp.water-balance.01.state-create",
		stateOutput: ["ending_storage=109.0 mm", "109"],
		plotCellId: "hmfp.water-balance.01.state-read-plot",
		errorCellId: "hmfp.water-balance.01.intentional-error",
		errorOutput: ["intentional unit-mismatch diagnostic"],
		recoveryCellId: "hmfp.water-balance.01.error-recovery",
		recoveryOutput: ["recovered_after_error=True"],
	},
	{
		id: "hmfp.depth-volume-discharge.02",
		title: "Convert Depth, Volume, and Discharge",
		stateCellId: "hmfp.depth-volume-discharge.02.state-create",
		stateOutput: ["volume=36000 m^3", "interval_mean_discharge=2.000 m^3/s", "recovered_depth=3.600 mm"],
		plotCellId: "hmfp.depth-volume-discharge.02.state-read-plot",
		errorCellId: "hmfp.depth-volume-discharge.02.intentional-error",
		errorOutput: ["intentional duration-unit diagnostic"],
		recoveryCellId: "hmfp.depth-volume-discharge.02.error-recovery",
		recoveryOutput: ["recovered_after_error=True", "interval_mean_discharge=2.000 m^3/s"],
	},
	{
		id: "hmfp.unit-hydrograph-convolution.03",
		title: "Build and Convolve a Unit Hydrograph",
		stateCellId: "hmfp.unit-hydrograph-convolution.03.state-create",
		stateOutput: [
			"unit_hydrograph=0.6944, 1.3889, 0.6944",
			"direct_runoff=1.3889, 3.4722, 2.7778, 0.6944",
			"expected_volume=30000 m^3",
			"routed_volume=30000 m^3",
		],
		plotCellId: "hmfp.unit-hydrograph-convolution.03.state-read-plot",
		errorCellId: "hmfp.unit-hydrograph-convolution.03.intentional-error",
		errorOutput: ["intentional convolution-tail diagnostic", "loses 2500 m^3"],
		recoveryCellId: "hmfp.unit-hydrograph-convolution.03.error-recovery",
		recoveryOutput: ["recovered_after_error=True", "causal_delayed_response=True", "volume_alone_detects_early_shift=False"],
	},
	{
		id: "hmfp.routing-method-comparison.04",
		title: "Compare Snyder, SCS, Clark, and ModClark Routing",
		stateCellId: "hmfp.routing-method-comparison.04.state-create",
		stateOutput: [
			"routing_methods=Snyder,SCS 484,Clark,ModClark-style",
			"storage_coefficient=1.00 h",
			"expected_volume=10000 m^3",
			"Clark: peak=1.2784 m^3/s; midpoint_centroid=2.000 h; volume=10000.0 m^3",
			"ModClark-style: peak=1.1711 m^3/s; midpoint_centroid=2.042 h; volume=10000.0 m^3",
		],
		plotCellId: "hmfp.routing-method-comparison.04.state-read-plot",
		errorCellId: "hmfp.routing-method-comparison.04.intentional-error",
		errorOutput: ["intentional cumulative-area diagnostic", "routes 45000 m^3 instead of 10000 m^3"],
		recoveryCellId: "hmfp.routing-method-comparison.04.error-recovery",
		recoveryOutput: [
			"recovered_after_error=True",
			"incremental_area_sum=1.000000",
			"all_methods_volume_conserving=True",
			"all_methods_nonnegative_on_nonnegative_time_grid=True",
		],
	},
	{
		id: "hmfp.curve-number-runoff.05",
		title: "Explore NRCS Curve Number Event Runoff",
		stateCellId: "hmfp.curve-number-runoff.05.state-create",
		stateOutput: [
			"curve_number=80",
			"storm_rainfall_mm=50.0",
			"direct_runoff_mm=13.802",
			"runoff_volume_m3=138024.802",
			"runoff_fraction=0.276050",
		],
		plotCellId: "hmfp.curve-number-runoff.05.state-read-plot",
		errorCellId: "hmfp.curve-number-runoff.05.intentional-error",
		errorOutput: ["intentional repeated-abstraction diagnostic", "0.833079 mm, not the cumulative-event result 13.802480 mm"],
		recoveryCellId: "hmfp.curve-number-runoff.05.error-recovery",
		recoveryOutput: [
			"recovered_after_error=True",
			"all_runoff_depths_bounded=True",
			"curve_number_monotonic=True",
			"cn100_runoff_equals_rainfall=True",
			"cumulative_increment_sum_matches_total=True",
		],
	},
	{
		id: "hmfp.hbv-style-stores.06",
		title: "Build an HBV-Style Store-and-Flux Model",
		stateCellId: "hmfp.hbv-style-stores.06.state-create",
		stateOutput: [
			"initial_soil_storage_mm=60.0",
			"day1_recharge_mm=3.600",
			"day1_total_runoff_mm=3.570",
			"final_soil_moisture_mm=68.506",
			"final_upper_zone_mm=4.663",
			"final_lower_zone_mm=19.735",
			"maximum_daily_mass_residual_mm=0.000000000000",
		],
		plotCellId: "hmfp.hbv-style-stores.06.state-read-plot",
		errorCellId: "hmfp.hbv-style-stores.06.intentional-error",
		errorOutput: [
			"intentional internal-transfer diagnostic",
			"combined residual is 1.000000 mm, exactly the omitted 1.000000 mm transfer",
		],
		recoveryCellId: "hmfp.hbv-style-stores.06.error-recovery",
		recoveryOutput: [
			"recovered_after_error=True",
			"internal_transfers_cancel=True",
			"maximum_store_residual_mm=0.000000000000",
			"maximum_daily_mass_residual_mm=0.000000000000",
			/cumulative_mass_residual_mm=-?0\.000000000000/,
		],
	},
	{
		id: "hmfp.norms-losses-gradients.07",
		title: "Understand Norms, Losses, and Gradients",
		stateCellId: "hmfp.norms-losses-gradients.07.state-create",
		stateOutput: [
			"runoff_scale=1.000000",
			"residuals_mm_per_day=[0.0, 0.0, 1.0]",
			"mse_mm2_per_day2=0.333333",
			"analytic_gradient=2.666667",
		],
		plotCellId: "hmfp.norms-losses-gradients.07.state-read-plot",
		plotOutput: ["optimal_scale=0.809524", "optimal_loss=0.079365"],
		errorCellId: "hmfp.norms-losses-gradients.07.intentional-error",
		errorOutput: ["intentional chain-rule diagnostic", "wrong_gradient=0.666667, correct_gradient=2.666667, gap=2.000000"],
		recoveryCellId: "hmfp.norms-losses-gradients.07.error-recovery",
		recoveryOutput: [
			"gradient_check_passed=True",
			"finite_difference_gradient=2.666667",
			"updated_scale=0.866667",
			"updated_loss=0.102222",
			"one_step_loss_decreased=True",
		],
	},
	{
		id: "hmfp.event-regime-residuals.08",
		title: "Diagnose Event, Regime, and Residual Patterns",
		stateCellId: "hmfp.event-regime-residuals.08.state-create",
		stateOutput: [
			"high_flow_threshold_mm_per_day=3.0",
			"residuals_mm_per_day=[0.0, 0.0, -2.0, 2.0, 0.0, 0.0, 0.0, -2.0, 2.0, 0.0, 0.0, 0.0]",
			"overall_mean_residual_mm_per_day=0.000000",
			"overall_mae_mm_per_day=0.666667",
			"overall_rmse_mm_per_day=1.154701",
			"event_A_volume_bias_mm=0.000000",
			"event_A_peak_timing_error_days=1.0",
			"event_B_volume_bias_mm=0.000000",
			"event_B_peak_timing_error_days=1.0",
			"below_threshold_count=9",
			"below_threshold_mean_residual_mm_per_day=0.222222",
			"below_threshold_rmse_mm_per_day=0.666667",
			"at_or_above_threshold_count=3",
			"at_or_above_threshold_mean_residual_mm_per_day=-0.666667",
			"at_or_above_threshold_rmse_mm_per_day=2.000000",
		],
		plotCellId: "hmfp.event-regime-residuals.08.state-read-plot",
		plotOutput: ["largest_residual_interval=D03"],
		errorCellId: "hmfp.event-regime-residuals.08.intentional-error",
		errorOutput: ["intentional alignment diagnostic", "false_sorted_mse=0.000000"],
		recoveryCellId: "hmfp.event-regime-residuals.08.error-recovery",
		recoveryOutput: [
			"alignment_restored=True",
			"false_sorted_mse=0.000000",
			"correct_chronological_mse=1.333333",
			"regime_recomposition_passed=True",
			"event_volume_identity_passed=True",
			"event_peak_timing_errors_days=[1.0, 1.0]",
		],
	},
	{
		id: "hmfp.basin-specific-lstm.09",
		title: "Build a Basin-Specific LSTM Without Future Leakage",
		stateCellId: "hmfp.basin-specific-lstm.09.state-create",
		stateOutput: [
			"scaler_fit_ids=['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']",
			"training_mean=[2.166667, 1.0]",
			"training_scale=[2.823512, 0.177951]",
			"train_shape=(9, 4, 2); validation_shape=(3, 4, 2); test_shape=(3, 4, 2)",
			"train_target_ids=['D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']",
			"validation_target_ids=['D16', 'D17', 'D18']",
			"test_target_ids=['D22', 'D23', 'D24']",
		],
		setupCells: [
			{
				id: "hmfp.basin-specific-lstm.09.state-encode",
				output: [
					"inspection_target_id=D08",
					"inspection_window_ids=['D05', 'D06', 'D07', 'D08']",
					"inspection_input_gate=[0.461467, 0.486913]",
					"inspection_forget_gate=[0.773701, 0.76003]",
					"inspection_candidate=[-0.020196, 0.411314]",
					"inspection_output_gate=[0.627937, 0.65897]",
					"inspection_hidden_dimensionless=[0.191348, 0.209111]",
					"inspection_memory_dimensionless=[0.31472, 0.328675]",
					"train_hidden_shape=(9, 2); words=samples by hidden features",
				],
			},
			{
				id: "hmfp.basin-specific-lstm.09.state-fit",
				output: [
					"model_contract=fixed-weight LSTM encoder plus train-only fitted ridge readout",
					"end_to_end_lstm_training=False",
					"readout_coefficients=[1.095217, 4.410821, -2.329272]",
					"train_rmse_mm_per_day=0.142380",
					"validation_rmse_mm_per_day=0.223108",
					"test_rmse_mm_per_day=0.521080",
					"chronological_split_passed=True",
					"train_only_scaler_passed=True",
					"future_target_excluded=True",
				],
			},
		],
		plotCellId: "hmfp.basin-specific-lstm.09.state-read-plot",
		plotOutput: [
			"test_prediction_table=id,reference,prediction,residual_mm_per_day",
			"D22,2.603725,1.839639,-0.764086",
			"D23,2.079082,1.652615,-0.426467",
			"D24,1.510939,1.289866,-0.221073",
		],
		errorCellId: "hmfp.basin-specific-lstm.09.intentional-error",
		errorOutput: [
			"intentional leakage diagnostic",
			"overlap=['D22', 'D23', 'D24']",
			"leaked_test_rmse_mm_per_day=0.000000000000",
		],
		recoveryCellId: "hmfp.basin-specific-lstm.09.error-recovery",
		recoveryOutput: [
			"fit_test_overlap=[]",
			"heldout_target_perturbation_invariant=True",
			"chronological_split_passed=True",
			"train_only_scaler_passed=True",
			"future_target_excluded=True",
			"held_out_recomputation_passed=True",
			"clean_test_rmse_mm_per_day=0.521080",
		],
	},
	{
		id: "hmfp.differentiable-state-space.10",
		title: "Differentiate a Mass-Closing State-Space Reservoir",
		stateCellId: "hmfp.differentiable-state-space.10.state-create",
		stateOutput: [
			"fit_target_ids=['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08']",
			"validation_target_ids=['D09', 'D10', 'D11', 'D12']",
			"precipitation_shape=(12,); words=daily interval depths",
			"target_contract=synthetic generator trace plus disclosed deterministic adjustments",
		],
		setupCells: [
			{
				id: "hmfp.differentiable-state-space.10.state-simulate",
				output: [
					"initial_release_fraction=0.200000",
					"D01_runoff_mm=0.200000",
					"D02_runoff_mm=0.960000",
					"D02_next_storage_mm=3.840000",
					"D02_runoff_sensitivity_mm=0.736000",
					"initial_training_mse_mm2=0.384374",
					"initial_training_gradient_mm2=-0.975490",
				],
			},
			{
				id: "hmfp.differentiable-state-space.10.state-fit",
				output: [
					"model_contract=mass-closing one-store state transition plus exact forward sensitivity",
					"automatic_differentiation_framework=False",
					"fit_validation_overlap=[]",
					"fitted_release_fraction=0.353099",
					"training_rmse_mm=0.020817",
					"validation_rmse_mm=0.030870",
					"heldout_targets_excluded=True",
					"training_loss_decreased=True",
				],
			},
		],
		plotCellId: "hmfp.differentiable-state-space.10.state-read-plot",
		plotOutput: [
			"validation_table=id,reference,prediction,residual_mm",
			"D09,1.921903,1.959509,+0.037606",
			"D10,1.645237,1.620708,-0.024529",
			"D11,4.256404,4.226325,-0.030079",
			"D12,2.704163,2.734016,+0.029853",
		],
		errorCellId: "hmfp.differentiable-state-space.10.intentional-error",
		errorOutput: [
			"intentional stopped-state diagnostic",
			"local_only=-1.363850 mm2",
			"finite_difference=-0.975490 mm2",
			"absolute_error=0.388361 mm2",
		],
		recoveryCellId: "hmfp.differentiable-state-space.10.error-recovery",
		recoveryOutput: [
			"gradient_check_passed=True",
			"heldout_target_perturbation_invariant=True",
			"mass_closure_passed=True",
			"derivative_closure_passed=True",
			"fitted_release_fraction=0.353099",
			"validation_rmse_mm=0.030870",
		],
	},
	{
		id: "hmfp.metrics-fdc-signatures-uncertainty.11",
		title: "Evaluate Metrics, Flow-Duration Curves, Signatures, and Spread",
		stateCellId: "hmfp.metrics-fdc-signatures-uncertainty.11.state-create",
		stateOutput: [
			"interval_ids=['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']",
			"alignment_contract=simulated minus reference on identical daily interval IDs",
			"delta_time_days=1.0",
			"reference_total_depth_mm=23.000000",
			"simulated_total_depth_mm=23.000000",
			"residuals_mm_per_day=[0.0, 0.0, -2.0, 2.0, 0.0, 0.0, 0.0, -2.0, 2.0, 0.0, 0.0, 0.0]",
		],
		setupCells: [
			{
				id: "hmfp.metrics-fdc-signatures-uncertainty.11.state-metrics",
				output: [
					"rmse_mm_per_day=1.154701",
					"nse=0.235060",
					"kge_2009=0.617530",
					"kge_correlation=0.617530",
					"kge_variability_ratio=1.000000",
					"kge_mean_ratio=1.000000",
					"volume_bias_fraction=0.000000",
				],
			},
			{
				id: "hmfp.metrics-fdc-signatures-uncertainty.11.state-fdc-signatures",
				output: [
					"fdc_values_identical=True",
					"reference_Q10_mm_per_day=4.700000",
					"reference_Q50_mm_per_day=1.000000",
					"reference_Q90_mm_per_day=1.000000",
				],
			},
			{
				id: "hmfp.metrics-fdc-signatures-uncertainty.11.state-envelope",
				output: [
					"scenario_spread_fraction=0.25",
					"scenario_factors=[0.75, 0.875, 1.0, 1.125, 1.25]",
					"scenario_coverage_fraction=0.666667",
					"scenario_mean_width_mm_per_day=0.958333",
					"scenario_contract=deterministic sensitivity members, not probability samples",
				],
			},
		],
		plotCellId: "hmfp.metrics-fdc-signatures-uncertainty.11.state-read-plot",
		plotOutput: ["covered_interval_ids=['D01', 'D02', 'D05', 'D06', 'D07', 'D10', 'D11', 'D12']"],
		errorCellId: "hmfp.metrics-fdc-signatures-uncertainty.11.intentional-error",
		errorOutput: ["intentional sorted-metric diagnostic", "false_sorted_nse=1.000000"],
		recoveryCellId: "hmfp.metrics-fdc-signatures-uncertainty.11.error-recovery",
		recoveryOutput: [
			"false_sorted_nse=1.000000",
			"chronological_nse=0.235060",
			"chronology_guard_passed=True",
			"fdc_identity_passed=True",
			"kge_component_diagnostic_passed=True",
			"scenario_coverage_fraction=0.666667",
			"scenario_mean_width_mm_per_day=0.958333",
			"comparison_spread_fraction=0.35",
			"comparison_coverage_fraction=0.666667",
			"comparison_mean_width_mm_per_day=1.341667",
			"scenario_tradeoff_passed=True",
		],
	},
	{
		id: "hmfp.hydro-atoms-interpretation-audit.12",
		title: "Interpret and Audit Static HYDRO-ATOMS Behavior",
		stateCellId: "hmfp.hydro-atoms-interpretation-audit.12.state-create",
		stateOutput: [
			"provenance=authored synthetic logits; not learned and not checkpoint-derived",
			"representative_parameter_bounds=",
			"'f_cn': (0.5, 1.5, 'dimensionless')",
			"'alpha_gw': (0.001, 0.5, 'day^-1')",
		],
		setupCells: [
			{
				id: "hmfp.hydro-atoms-interpretation-audit.12.state-compose",
				output: [
					"forest_sandy_gentle: total_logit=-0.750000, synthetic_f_cn=0.820821",
					"crop_sandy_gentle: total_logit=0.450000, synthetic_f_cn=1.110639",
					"composition_contract=six dimensionless terms summed before bounded mapping",
				],
			},
			{
				id: "hmfp.hydro-atoms-interpretation-audit.12.state-manipulate",
				output: [
					"selected_land_use_logit=0.40",
					"selected_total_logit=0.450000",
					"selected_f_cn=1.110639",
					"monotonic_parameter_mapping_passed=True",
					"interpretation=parameter direction only; basin runoff direction is untested",
				],
			},
			{
				id: "hmfp.hydro-atoms-interpretation-audit.12.state-unknown-type",
				output: [
					"known_type_atom_residual_logit=0.200000",
					"unknown_type_atom_residual_logit=0.000000",
					"unknown_type_total_logit=0.250000",
					"unknown_type_synthetic_f_cn=1.062177",
					"fallback_contract=only the exact-combination residual is zeroed",
					"claim_boundary=computable output does not prove transfer",
				],
			},
		],
		plotCellId: "hmfp.hydro-atoms-interpretation-audit.12.state-aggregate-plot",
		plotOutput: [
			"area_fractions=[0.7, 0.3]",
			"area_fraction_sum=1.000000",
			"authored_hru_runoff_mm_per_day=[2.0, 5.0]",
			"basin_runoff_depth_mm_per_day=2.900000",
			"Figure text alternative:",
		],
		errorCellId: "hmfp.hydro-atoms-interpretation-audit.12.intentional-error",
		errorOutput: ["intentional area-weight diagnostic", "invalid_sum=1.200000", "Do not silently normalize"],
		recoveryCellId: "hmfp.hydro-atoms-interpretation-audit.12.error-recovery",
		recoveryOutput: [
			"authored_component_sum_passed=True",
			"bounded_parameter_passed=True",
			"unknown_type_residual_only_passed=True",
			"monotonic_parameter_mapping_passed=True",
			"area_weight_contract_passed=True",
			"recovered_basin_runoff_mm_per_day=2.900000",
			"claim_status=code behavior verified on authored synthetic values only",
		],
	},
] as const

const expectedModuleIndex = BOOK_MODULES.findIndex(({ id }) => id === expectedBookModuleId)
if (expectedModuleIndex < 0) {
	throw new Error(`No real-panel contract is registered for ${expectedBookModuleId}`)
}

async function completeCurrentAndOpenNext(page: Page, nextTitle: string): Promise<void> {
	const shell = await waitForCourseShell(page)
	const complete = shell.getByTitle("Mark complete & continue to next module")
	await expect(complete).toBeVisible({ timeout: 30_000 })
	await complete.evaluate((element: HTMLElement) => element.click())
	const next = shell.getByTitle(`Next: ${nextTitle}`)
	await expect(next).toBeEnabled({ timeout: 30_000 })
	await next.evaluate((element: HTMLElement) => element.click())
}

async function executeBookModule(
	page: Page,
	contract: BookModuleRuntimeContract,
): Promise<{ artifact: Frame; plotCell: Locator }> {
	const artifact = await waitForCellFrame(page, contract.stateCellId)
	const stateOutput = await runCell(artifact, contract.stateCellId)
	for (const expected of contract.stateOutput) {
		await expect(stateOutput).toContainText(expected, { timeout: 60_000 })
	}
	await executeSetupCells(artifact, contract)

	const plotOutput = await runCell(artifact, contract.plotCellId)
	for (const expected of contract.plotOutput ?? []) {
		await expect(plotOutput).toContainText(expected, { timeout: 60_000 })
	}
	const plotCell = artifact.locator(`[data-aihydro-cell-id="${contract.plotCellId}"]`)
	await expectPng(plotCell)

	const errorOutput = await runCell(artifact, contract.errorCellId)
	for (const expected of contract.errorOutput) {
		await expect(errorOutput).toContainText(expected, { timeout: 30_000 })
	}
	const recoveryOutput = await runCell(artifact, contract.recoveryCellId)
	for (const expected of contract.recoveryOutput) {
		await expect(recoveryOutput).toContainText(expected, { timeout: 30_000 })
	}
	return { artifact, plotCell }
}

async function executeSetupCells(artifact: Frame, contract: BookModuleRuntimeContract): Promise<void> {
	for (const setup of contract.setupCells ?? []) {
		const output = await runCell(artifact, setup.id)
		for (const expected of setup.output) {
			await expect(output).toContainText(expected, { timeout: 60_000 })
		}
	}
}

async function blockExternalNetwork(page: Page): Promise<void> {
	await page.route(/^https?:\/\//, async (route) => {
		const host = new URL(route.request().url()).hostname
		if (host === "127.0.0.1" || host === "localhost") await route.continue()
		else await route.abort("blockedbyclient")
	})
}

async function installBookPack(workspaceDir: string): Promise<string | undefined> {
	let response: Response | undefined
	await expect
		.poll(
			async () => {
				try {
					response = await fetch("http://127.0.0.1:9876/learning-pack-command", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							command: "aihydro.learningPacks.install",
							options: {
								archivePath: path.join(workspaceDir, "book-student.aihydropack"),
								approval: "install-once",
								prereleaseOptIn: true,
							},
						}),
					})
					return response.status
				} catch {
					return 0
				}
			},
			{ timeout: 30_000 },
		)
		.toBe(200)
	const commandResult = (await response!.json()) as { result?: { status?: string } }
	return commandResult.result?.status
}

interface PersistedCourseProgress {
	currentModuleId: string | null
	completed: Record<string, unknown>
}

function readOnlyCourseProgress(homeDir: string): PersistedCourseProgress {
	const directory = path.join(homeDir, ".aihydro", "course_progress")
	const files = readdirSync(directory).filter((entry) => entry.endsWith(".json"))
	expect(files).toHaveLength(1)
	return JSON.parse(readFileSync(path.join(directory, files[0]), "utf8")) as PersistedCourseProgress
}

async function interruptInstalledModule(page: Page, contract: BookModuleRuntimeContract, workspaceDir: string): Promise<void> {
	const artifact = await waitForCellFrame(page, contract.recoveryCellId)
	const cell = artifact.locator(`[data-aihydro-cell-id="${contract.recoveryCellId}"]`)
	const source = cell.locator(".aihydro-source")
	const original = await source.textContent()
	const originalTemplate = await cell.getAttribute("data-source-template")
	const startedPath = path.join(workspaceDir, ".aihydro-installed-pack-interrupt-started")
	rmSync(startedPath, { force: true })
	const slowCode = [
		"import time",
		"from pathlib import Path",
		`Path(${JSON.stringify(startedPath)}).write_text("started", encoding="utf-8")`,
		'print("installed_pack_interrupt_started", flush=True)',
		"time.sleep(30)",
		'print("installed_pack_interrupt_finished", flush=True)',
	].join("\n")
	// The deterministic slow source exists only in this live artifact frame. The
	// signed archive and installed files remain untouched, and the authored source
	// is restored before the recovery assertion below.
	try {
		await cell.evaluate((element, code) => {
			const sourceElement = element.querySelector(".aihydro-source")
			if (!sourceElement) throw new Error("Installed module cell source is missing")
			sourceElement.textContent = code
			element.setAttribute("data-source-template", code)
		}, slowCode)

		const output = await runCell(artifact, contract.recoveryCellId)
		await expect.poll(() => existsSync(startedPath), { timeout: 30_000 }).toBe(true)
		const runningShell = await waitForFrame(
			page,
			async (frame) => (await frame.getByTitle("Interrupt execution").count()) === 1,
		)
		const stop = runningShell.getByTitle("Interrupt execution")
		await expect(stop).toBeEnabled({ timeout: 30_000 })
		await stop.evaluate((element: HTMLElement) => element.click())
		await expect(output).toContainText("Interrupted by user", { timeout: 30_000 })
		await expect(output).not.toContainText("installed_pack_interrupt_finished")
		await expect.poll(() => runningShell.getByTitle("Interrupt execution").count(), { timeout: 20_000 }).toBe(0)
	} finally {
		rmSync(startedPath, { force: true })
		await cell.evaluate(
			(element, values) => {
				const sourceElement = element.querySelector(".aihydro-source")
				if (!sourceElement) throw new Error("Installed module cell source is missing")
				sourceElement.textContent = values.source
				if (values.template === null) element.removeAttribute("data-source-template")
				else element.setAttribute("data-source-template", values.template)
			},
			{ source: original ?? "", template: originalTemplate },
		)
	}
	await expect(cell.locator(".aihydro-run")).toBeEnabled({ timeout: 30_000 })
	const diagnostic = await runCell(artifact, contract.errorCellId)
	for (const expected of contract.errorOutput) {
		await expect(diagnostic).toContainText(expected, { timeout: 60_000 })
	}
	const recovered = await runCell(artifact, contract.recoveryCellId)
	for (const expected of contract.recoveryOutput) {
		await expect(recovered).toContainText(expected, { timeout: 60_000 })
	}
}

artifactIntegrationE2E(
	"executes a pinned book artifact, resumes after restart, and interrupts synthetic slow code @phase1-cross-repo",
	async ({ lifecycle, workspaceDir, homeDir }) => {
		let { app, page } = await lifecycle.launch()
		await blockExternalNetwork(page)
		await E2ETestHelper.openAiHydroSidebar(page)
		await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
		expect(await installBookPack(workspaceDir)).toBe("installed")

		for (const [index, contract] of BOOK_MODULES.slice(0, expectedModuleIndex + 1).entries()) {
			await completeCurrentAndOpenNext(page, contract.title)
			const { artifact, plotCell } = await executeBookModule(page, contract)
			if (index === 0) {
				const shell = await waitForCourseShell(page)
				await shell.getByTitle("More actions").evaluate((element: HTMLElement) => element.click())
				const restart = shell.locator('[role="menu"] button').filter({ hasText: "Restart kernel" })
				await expect(restart).toBeVisible()
				await restart.evaluate((element: HTMLElement) => element.click())
				const clearedOutput = await runCell(artifact, contract.plotCellId)
				await expect(clearedOutput).toContainText(/residual|not defined/, { timeout: 30_000 })

				const recreatedOutput = await runCell(artifact, contract.stateCellId)
				for (const expected of contract.stateOutput) {
					await expect(recreatedOutput).toContainText(expected, { timeout: 60_000 })
				}
				await runCell(artifact, contract.plotCellId)
				await expectPng(plotCell)
			}
		}

		const expectedProgress = {
			currentModuleId: BOOK_MODULES[expectedModuleIndex].id,
			completed: [courseEntryModuleId, ...BOOK_MODULES.slice(0, expectedModuleIndex).map(({ id }) => id)].sort(),
		}
		await expect
			.poll(
				() => {
					const progress = readOnlyCourseProgress(homeDir)
					return {
						currentModuleId: progress.currentModuleId,
						completed: Object.keys(progress.completed).sort(),
					}
				},
				{ timeout: 30_000 },
			)
			.toEqual(expectedProgress)

		const firstPid = app.process().pid
		expect(await lifecycle.close()).toBe(firstPid)
		;({ app, page } = await lifecycle.launch())
		expect(app.process().pid).not.toBe(firstPid)
		await blockExternalNetwork(page)
		const restartedProgress = readOnlyCourseProgress(homeDir)
		expect(restartedProgress.currentModuleId).toBe(expectedProgress.currentModuleId)
		expect(Object.keys(restartedProgress.completed).sort()).toEqual(expectedProgress.completed)

		await E2ETestHelper.openAiHydroSidebar(page)
		await waitForFrame(page, async (frame) => (await frame.title()).startsWith("AI-Hydro"))
		expect(await installBookPack(workspaceDir)).toBe("noop")
		const resumedShell = await waitForCourseShell(page)
		await expect(
			resumedShell.getByTitle(`${expectedProgress.completed.length} of ${BOOK_MODULES.length + 1} modules completed`),
		).toBeVisible({ timeout: 30_000 })
		const resumedContract = BOOK_MODULES[expectedModuleIndex]
		const resumedArtifact = await waitForCellFrame(page, resumedContract.stateCellId)
		const clearedAfterRestart = await runCell(resumedArtifact, resumedContract.plotCellId)
		await expect(clearedAfterRestart).toContainText(/not defined/, { timeout: 30_000 })
		const recreatedAfterRestart = await runCell(resumedArtifact, resumedContract.stateCellId)
		for (const expected of resumedContract.stateOutput) {
			await expect(recreatedAfterRestart).toContainText(expected, { timeout: 60_000 })
		}
		await executeSetupCells(resumedArtifact, resumedContract)
		await runCell(resumedArtifact, resumedContract.plotCellId)
		await expectPng(resumedArtifact.locator(`[data-aihydro-cell-id="${resumedContract.plotCellId}"]`))
		await interruptInstalledModule(page, resumedContract, workspaceDir)
	},
)
