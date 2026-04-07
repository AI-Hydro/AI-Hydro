"""
NeuralHydrology LSTM / EA-LSTM
===============================

Data preparation and training wrapper for NeuralHydrology's generic
dataset mode.  Works with any gauge whose streamflow + forcing data
has been fetched via AI-Hydro tools (not just CAMELS).

References
----------
- Kratzert et al. (2019). Toward improved predictions in ungauged basins. WRR.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any

from ai_hydro.modelling.metrics import (
    _FORCING_MAP,
    _USEFUL_STATIC,
    _best_device,
    _hargreaves_pet,
    _load_forcing_arrays,
    _load_full_data,
    _q_cms_to_mm_day,
    fetch_camels_streamflow,
)

log = logging.getLogger("ai_hydro.modelling")


# ──────────────────────────────────────────────────────────────────────
# Data preparation
# ──────────────────────────────────────────────────────────────────────

def prepare_nh_data(gauge_id: str, session: Any, data_dir: Path) -> dict:
    """
    Write NeuralHydrology 'generic' dataset files from the AI-Hydro session.

    Output layout
    -------------
    data_dir/
      time_series/<gauge_id>.csv   — date, forcing columns, QObs(mm/d)
      attributes/attributes.csv   — one row per gauge, CAMELS attributes
      basins.txt                  — gauge_id list (single entry here)

    Returns
    -------
    dict with ts_file, attrs_file, basin_file, n_rows,
              dynamic_inputs (list), static_attributes (list)
    """
    area_km2 = session.watershed["data"]["area_km2"]

    # Streamflow: prefer CAMELS
    q_dict = fetch_camels_streamflow(gauge_id, area_km2)
    using_camels = bool(q_dict)
    if not using_camels:
        sf_data = _load_full_data(session, "streamflow", gauge_id)
        sf_idx  = {d[:10]: i for i, d in enumerate(sf_data["dates"])}
        for d, i in sf_idx.items():
            q_mm = _q_cms_to_mm_day(sf_data["q_cms"][i], area_km2)
            if q_mm is not None:
                q_dict[d] = q_mm

    frc_data = _load_full_data(session, "forcing", gauge_id)
    frc_dates, prcp, tmax, tmin, pet_list = _load_forcing_arrays(frc_data)
    frc_date_strs = [d[:10] for d in frc_dates]

    # Map session keys → NH column names (deduplicated)
    available: dict[str, str] = {}  # nh_col → session_key
    for sess_key, nh_col in _FORCING_MAP.items():
        if nh_col not in available and isinstance(frc_data.get(sess_key), list):
            available[nh_col] = sess_key

    rows: list[dict] = []
    fieldnames = ["date"] + list(available.keys()) + ["QObs(mm/d)"]

    frc_idx = {d[:10]: i for i, d in enumerate(frc_dates)}
    for d_str in sorted(set(list(frc_date_strs) + list(q_dict.keys()))):
        row: dict = {"date": d_str}
        if d_str in frc_idx:
            j = frc_idx[d_str]
            for nh_col, sess_key in available.items():
                vals = frc_data[sess_key]
                row[nh_col] = vals[j] if j < len(vals) else "nan"
            # Fallback Hargreaves PET
            if "pet(mm/day)" not in row:
                tx = float(row.get("tmax(C)") or 10.0)
                tn = float(row.get("tmin(C)") or  5.0)
                row["pet(mm/day)"] = _hargreaves_pet((tx+tn)/2.0, tx, tn)
        else:
            for nh_col in available:
                row[nh_col] = "nan"
        row["QObs(mm/d)"] = q_dict.get(d_str, "nan")
        rows.append(row)

    ts_dir = data_dir / "time_series"
    ts_dir.mkdir(parents=True, exist_ok=True)
    ts_path = ts_dir / f"{gauge_id}.csv"
    with open(ts_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)
    log.info("NH time-series: %d rows -> %s", len(rows), ts_path)

    camels_data: dict = (session.camels or {}).get("data", {}) if session.camels else {}
    ws_data: dict     = session.watershed["data"]
    static_keys = [k for k in _USEFUL_STATIC if k in camels_data]
    attr_row: dict = {"gauge_id": gauge_id}
    for k in static_keys:
        attr_row[k] = camels_data[k]
    for k, v in [("area_gages2", ws_data.get("area_km2")),
                 ("gauge_lat",   ws_data.get("gauge_lat")),
                 ("gauge_lon",   ws_data.get("gauge_lon"))]:
        if k not in attr_row and v is not None:
            attr_row[k] = v; static_keys.append(k)

    attrs_dir = data_dir / "attributes"
    attrs_dir.mkdir(parents=True, exist_ok=True)
    attrs_path = attrs_dir / "attributes.csv"
    with open(attrs_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(attr_row.keys()))
        writer.writeheader(); writer.writerow(attr_row)

    basin_path = data_dir / "basins.txt"
    basin_path.write_text(f"{gauge_id}\n")

    dynamic_inputs = list(available.keys())
    if "pet(mm/day)" not in dynamic_inputs:
        dynamic_inputs.append("pet(mm/day)")

    return {
        "ts_file":           str(ts_path),
        "attrs_file":        str(attrs_path),
        "basin_file":        str(basin_path),
        "n_rows":            len(rows),
        "dynamic_inputs":    dynamic_inputs,
        "static_attributes": static_keys,
        "data_source":       "CAMELS+GridMET" if using_camels else "USGS+GridMET",
    }


# ──────────────────────────────────────────────────────────────────────
# Training
# ──────────────────────────────────────────────────────────────────────

def train_neural_hydrology(
    gauge_id:   str,
    session:    Any,
    output_dir: Path,
    model:      str   = "cudalstm",
    train_start: str  = "1980-10-01",
    train_end:   str  = "2000-09-30",
    val_start:   str  = "2000-10-01",
    val_end:     str  = "2005-09-30",
    test_start:  str  = "2005-10-01",
    test_end:    str  = "2010-09-30",
    hidden_size: int  = 64,
    epochs:      int  = 30,
    seq_length:  int  = 365,
    batch_size:  int  = 256,
    learning_rate: float = 0.001,
) -> dict:
    """
    Train a NeuralHydrology LSTM for streamflow prediction.

    Parameters
    ----------
    model : str
        'cudalstm' (standard LSTM), 'ealstm' (entity-aware LSTM),
        'transformer', or 'mamba'
    hidden_size : int
        Number of LSTM hidden units (default 64; use 128-256 for accuracy)
    epochs : int
        Training epochs (30 is a good starting point)

    Returns
    -------
    dict with model_dir, config_file, nse, kge, rmse, predictions_file
    """
    try:
        from neuralhydrology.training import start_training
        from neuralhydrology.evaluation import start_evaluation
        from neuralhydrology.utils.config import Config
        import yaml
    except ImportError as e:
        raise ImportError(
            f"NeuralHydrology not installed ({e}). "
            "Install with: pip install neuralhydrology"
        ) from e

    device = _best_device()
    data_dir  = output_dir / f"nh_data_{gauge_id}"
    data_info = prepare_nh_data(gauge_id, session, data_dir)

    run_dir = output_dir / f"nh_{model}_{gauge_id}"
    run_dir.mkdir(parents=True, exist_ok=True)

    cfg_dict: dict = {
        "dataset":               "generic",
        "data_dir":              str(data_dir),
        "train_basin_file":      data_info["basin_file"],
        "validation_basin_file": data_info["basin_file"],
        "test_basin_file":       data_info["basin_file"],
        "train_start_date":      train_start,
        "train_end_date":        train_end,
        "validation_start_date": val_start,
        "validation_end_date":   val_end,
        "test_start_date":       test_start,
        "test_end_date":         test_end,
        "model":                 model,
        "hidden_size":           hidden_size,
        "target_variables":      ["QObs(mm/d)"],
        "dynamic_inputs":        data_info["dynamic_inputs"],
        "static_attributes":     data_info["static_attributes"],
        "seq_length":            seq_length,
        "predict_last_n":        1,
        "epochs":                epochs,
        "batch_size":            batch_size,
        "learning_rate":         learning_rate,
        "optimizer":             "Adam",
        "loss":                  "NSE",
        "clip_gradient_norm":    1.0,
        "metrics":               ["NSE", "KGE", "RMSE", "Bias"],
        "experiment_name":       f"aihydro_{gauge_id}",
        "run_dir":               str(run_dir),
        "device":                device,
        "seed":                  42,
        "log_interval":          1,
        "log_tensorboard":       False,
        "save_weights_every":    max(1, epochs // 5),
        "validate_every":        max(1, epochs // 5),
    }

    cfg_path = run_dir / "config.yml"
    with open(cfg_path, "w") as f:
        yaml.dump(cfg_dict, f, default_flow_style=False, sort_keys=False)

    log.info("NeuralHydrology: model=%s  epochs=%d  device=%s", model, epochs, device)
    cfg = Config(cfg_path)
    start_training(cfg)
    log.info("Evaluating on test period %s -> %s ...", test_start, test_end)
    start_evaluation(run_dir=run_dir, epoch=epochs)

    metrics = _read_nh_metrics(run_dir, epochs)
    return {
        "framework":         "neuralhydrology",
        "model_type":        model,
        "model_dir":         str(run_dir),
        "config_file":       str(cfg_path),
        "device":            device,
        "dynamic_inputs":    data_info["dynamic_inputs"],
        "static_attributes": data_info["static_attributes"],
        "train_period":      [train_start, train_end],
        "val_period":        [val_start,   val_end],
        "test_period":       [test_start,  test_end],
        "epochs_trained":    epochs,
        **metrics,
    }


def _read_nh_metrics(run_dir: Path, epoch: int) -> dict:
    """Parse NSE/KGE/RMSE from NeuralHydrology evaluation CSV output."""
    import glob
    patterns = [
        str(run_dir / f"model_epoch{epoch:03d}" / "test" / "*.csv"),
        str(run_dir / "model_epoch*" / "test" / "*.csv"),
    ]
    files: list[str] = []
    for pat in patterns:
        files = sorted(glob.glob(pat))
        if files:
            break
    if not files:
        log.warning("No evaluation metrics CSV found in %s", run_dir)
        return {"nse": None, "kge": None, "rmse": None, "bias": None}

    results: dict[str, float] = {}
    with open(files[-1]) as f:
        reader = csv.DictReader(f)
        for row in reader:
            for k, v in row.items():
                try:
                    results[k.strip().lower()] = float(v)
                except (ValueError, TypeError):
                    pass
    return {
        "nse":          results.get("nse_median",  results.get("nse")),
        "kge":          results.get("kge_median",  results.get("kge")),
        "rmse":         results.get("rmse_median", results.get("rmse")),
        "bias":         results.get("bias_median", results.get("bias")),
        "metrics_file": files[-1],
    }
