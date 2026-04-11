---
description: Calibrate differentiable HBV-light or train NeuralHydrology LSTM models via AI-Hydro. Full parameter reference and performance metrics.
---

# Modelling Tools

Tools for hydrological model calibration and result retrieval.

---

## `train_hydro_model`

Calibrate a hydrological model using the cached streamflow and forcing data.

**Requires:** `fetch_streamflow_data` and `fetch_forcing_data` to have been called first.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `model_type` | str | No | `"hbv"` or `"lstm"` (default: `"hbv"`) |
| `train_ratio` | float | No | Fraction of record used for training (default: 0.7) |
| `epochs` | int | No | Training epochs — LSTM only (default: 30) |
| `warmup_days` | int | No | Warm-up period excluded from loss (default: 365) |

---

### HBV-light (Differentiable)

A differentiable implementation of the HBV-light conceptual rainfall-runoff model in PyTorch. Parameters are calibrated via gradient descent (Adam optimiser) rather than traditional Monte Carlo or SCE-UA methods.

**Model structure:**

```
Precipitation (P)
    → Snow routine (TT, CFMAX, CFR, CWH)
    → Soil moisture routine (FC, LP, BETA)
    → Response routine (K0, K1, K2, UZL, PERC)
    → Routing (MAXBAS)
    → Simulated discharge (Q_sim)
```

**Typical performance (CAMELS-US):**

| Metric | Median | Top quartile |
|--------|--------|-------------|
| NSE | 0.68 | > 0.78 |
| KGE | 0.71 | > 0.80 |

**Advantages over traditional calibration:**
- Gradient-based — faster convergence than Monte Carlo
- Differentiable — can be embedded in larger ML pipelines
- PyTorch — runs on GPU if available

---

### LSTM (NeuralHydrology)

A Long Short-Term Memory network trained via the [NeuralHydrology](https://neuralhydrology.readthedocs.io/) framework. Requires more data (~10+ years) and compute than HBV-light but captures complex non-linear rainfall-runoff dynamics.

**Architecture:** Single-layer LSTM with static attribute embedding (uses CAMELS attributes as static inputs if available).

!!! warning "Data requirement"
    LSTM training requires `extract_camels_attributes` to have been called for the gauge. Use HBV-light for non-CAMELS gauges.

---

## `get_model_results`

Retrieve cached model performance metrics and parameter sets.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gauge_id` | str | Yes | USGS gauge ID |
| `model_type` | str | No | `"hbv"` or `"lstm"` |

**Returns:**

| Field | Description |
|-------|-------------|
| `nse_train` / `nse_val` | Nash-Sutcliffe Efficiency |
| `kge_train` / `kge_val` | Kling-Gupta Efficiency |
| `rmse_train` / `rmse_val` | Root Mean Square Error (m³/s) |
| `parameters` | Calibrated parameter set (HBV) or architecture (LSTM) |
| `trained_at` | Timestamp |
| `train_period` / `val_period` | Date ranges used |

**Example:**
```
What were the model results for gauge 01031500?
```

```
Compare model performance across all gauges in my project.
```
