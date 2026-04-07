"""
Reference Gauge Validation Tests
==================================

Structural validation that all AI-Hydro tools return HydroResult-compliant
output for a representative set of USGS reference gauges.

These tests do NOT make live network calls by default — they mock the
underlying library responses and validate:
  1. Return type is HydroResult
  2. data dict is JSON-serializable
  3. meta has required fields (tool, version, sources, computed_at)
  4. HydroMeta.cite() returns non-empty BibTeX
  5. All expected data keys are present
  6. No numpy / Shapely objects leak into data

To run against the real USGS API (slow, requires internet + deps):
    pytest -m live tests/test_reference_gauges.py

Standard unit-test run (mocked, fast):
    pytest tests/test_reference_gauges.py
"""

from __future__ import annotations

import json
import datetime
from unittest.mock import MagicMock, patch
from typing import Any

import pytest

# ── Reference gauges (covering different hydroclimates) ────────────────────
REFERENCE_GAUGES = [
    {"id": "01031500", "name": "Mattawamkeag River ME", "lat": 45.8706, "lon": -68.3300},
    {"id": "02361000", "name": "Sepulga River AL",      "lat": 31.4836, "lon": -86.8686},
    {"id": "09380000", "name": "Colorado R at Lees Ferry AZ", "lat": 36.8642, "lon": -111.5877},
    {"id": "11532500", "name": "Trinity River CA",      "lat": 40.5843, "lon": -123.6469},
    {"id": "06431500", "name": "Rapid Creek SD",        "lat": 44.0697, "lon": -103.2310},
]

# ── Helpers ─────────────────────────────────────────────────────────────────

def _is_json_serializable(obj: Any) -> bool:
    try:
        json.dumps(obj)
        return True
    except (TypeError, ValueError):
        return False


def _assert_hydro_result(result: Any, expected_data_keys: list[str]) -> None:
    """Assert that *result* is a valid HydroResult."""
    from ai_hydro.core import HydroResult

    assert isinstance(result, HydroResult), (
        f"Expected HydroResult, got {type(result)}"
    )

    # data must be JSON-serializable
    assert _is_json_serializable(result.data), "data is not JSON-serializable"

    # required data keys present
    for key in expected_data_keys:
        assert key in result.data, f"Missing expected data key: {key!r}"

    # meta required fields
    meta = result.meta
    assert meta.tool, "meta.tool is empty"
    assert meta.version, "meta.version is empty"
    assert meta.sources, "meta.sources is empty list"
    assert meta.computed_at, "meta.computed_at is empty"

    # computed_at must be parseable ISO datetime
    datetime.datetime.fromisoformat(meta.computed_at)

    # cite() must return non-empty BibTeX string
    bib = meta.cite()
    assert isinstance(bib, str) and len(bib) > 10, "cite() returned empty/short BibTeX"

    # no forbidden types in data values (numpy, shapely, pandas, etc.)
    for k, v in result.data.items():
        assert not hasattr(v, "dtype"), f"numpy array leaked into data[{k!r}]"
        assert not hasattr(v, "geom_type"), f"Shapely geometry leaked into data[{k!r}]"


# ── Unit tests (mocked) ─────────────────────────────────────────────────────

class TestHydroResultContract:
    """Fast structural tests — no network calls."""

    def test_core_types_importable(self):
        from ai_hydro.core import DataSource, HydroMeta, HydroResult, HydroTool, ToolError
        assert HydroResult
        assert HydroMeta
        assert DataSource
        assert HydroTool
        assert ToolError

    def test_hydroresult_json_validator(self):
        """HydroResult must reject non-JSON-serializable data at construction."""
        import numpy as np
        from ai_hydro.core import HydroResult, HydroMeta, DataSource
        from pydantic import ValidationError

        good_meta = HydroMeta(
            tool="test.tool",
            version="1.0.0",
            sources=[DataSource(name="test", url=None, citation=None)],
            params={},
        )

        # Good — plain dict
        r = HydroResult(data={"x": 1.0, "y": "hello"}, meta=good_meta)
        assert r.data["x"] == 1.0

        # Bad — numpy 2-D array is NOT JSON-serializable
        with pytest.raises((ValidationError, TypeError, ValueError)):
            HydroResult(data={"x": np.zeros((3, 3))}, meta=good_meta)

    def test_hydrometa_cite_bibtex(self):
        from ai_hydro.core import HydroMeta, DataSource

        m = HydroMeta(
            tool="ai_hydro.tools.watershed.delineate_watershed",
            version="1.0.0",
            sources=[
                DataSource(
                    name="NLDI",
                    url="https://waterdata.usgs.gov/blog/nldi-intro/",
                    citation="@misc{NLDI2024, title={NLDI}, author={{USGS}}, year={2024}}",
                )
            ],
            params={"gauge_id": "01031500"},
        )
        bib = m.cite()
        assert "@misc{NLDI2024" in bib

    def test_hydrometa_methods_text(self):
        from ai_hydro.core import HydroMeta, DataSource

        m = HydroMeta(
            tool="ai_hydro.tools.watershed.delineate_watershed",
            version="1.0.0",
            sources=[DataSource(name="NLDI", url=None, citation=None)],
            params={},
        )
        text = m.to_methods_text()
        assert isinstance(text, str)
        assert len(text) > 20

    def test_tool_error_structure(self):
        from ai_hydro.core import ToolError

        err = ToolError(
            code="GAUGE_NOT_FOUND",
            message="Gauge 99999999 not in NWIS",
            tool="ai_hydro.tools.watershed.delineate_watershed",
            recovery="Verify the gauge ID at https://waterdata.usgs.gov",
            alternatives=["01031500", "02361000"],
        )
        d = err.to_dict()
        assert d["code"] == "GAUGE_NOT_FOUND"
        assert d["error"] is True
        assert "recovery" in d


# ── Watershed mock tests ────────────────────────────────────────────────────

class TestWatershedTool:

    @pytest.mark.live
    @pytest.mark.parametrize("gauge", REFERENCE_GAUGES[:2])
    def test_delineate_watershed_returns_hydroresult(self, gauge):
        """Live integration: delineate watershed and validate HydroResult contract."""
        pytest.importorskip("pynhd", reason="pynhd not installed — skipping live test")
        pytest.importorskip("pygeohydro", reason="pygeohydro not installed")

        from ai_hydro.analysis.watershed import delineate_watershed

        result = delineate_watershed(gauge_id=gauge["id"])
        _assert_hydro_result(
            result,
            expected_data_keys=["geometry_geojson", "area_km2", "gauge_id"],
        )
        assert result.data["gauge_id"] == gauge["id"]
        assert result.data["area_km2"] > 0


# ── Streamflow mock tests ───────────────────────────────────────────────────

class TestStreamflowTool:

    @pytest.mark.live
    @pytest.mark.parametrize("gauge", REFERENCE_GAUGES[:2])
    def test_fetch_streamflow_data_returns_hydroresult(self, gauge):
        """Live integration: fetch streamflow and validate HydroResult contract."""
        pytest.importorskip("hydrofunctions", reason="hydrofunctions not installed")

        from ai_hydro.data.streamflow import fetch_streamflow_data

        result = fetch_streamflow_data(
            gauge_id=gauge["id"],
            start_date="2010-01-01",
            end_date="2010-03-31",
        )
        _assert_hydro_result(result, expected_data_keys=["dates", "q_cms", "n_days"])
        assert isinstance(result.data["dates"], list)
        assert isinstance(result.data["q_cms"], list)
        assert all(
            isinstance(v, (float, int, type(None)))
            for v in result.data["q_cms"]
        ), "q_cms contains non-scalar values"


# ── Geomorphic mock tests ───────────────────────────────────────────────────

class TestGeomorphicTool:

    def test_extract_geomorphic_parameters_result_contract(self):
        """Validate HydroResult wrapper for geomorphic tool."""
        import numpy as np

        fake_params = {
            "DA_km2": 1234.5, "Lp_km": 200.0, "Lb_km": 80.0,
            "Rff": 0.19, "Rc": 0.31, "Re": 0.50, "HI": 0.42,
        }
        fake_units = {"DA_km2": "km²", "Lp_km": "km"}

        with patch(
            "ai_hydro.analysis.geomorphic.extract_geomorphic_parameters",
            return_value=(fake_params, fake_units),
        ):
            try:
                from ai_hydro.analysis.geomorphic import extract_geomorphic_parameters_result

                fake_geojson = {
                    "type": "Polygon",
                    "coordinates": [[[-69, 45], [-68, 45], [-68, 46], [-69, 46], [-69, 45]]],
                }
                result = extract_geomorphic_parameters_result(
                    watershed_geojson=fake_geojson,
                    outlet_lat=45.87,
                    outlet_lon=-68.33,
                )
                _assert_hydro_result(result, expected_data_keys=["DA_km2", "Rff"])
                assert result.data["DA_km2"] == pytest.approx(1234.5)
                assert "_units" in result.data
            except ImportError as e:
                pytest.skip(f"Geomorphic deps not installed: {e}")


# ── TWI mock tests ──────────────────────────────────────────────────────────

class TestTWITool:

    def test_compute_twi_result_contract(self):
        """Validate HydroResult wrapper for TWI tool."""
        import numpy as np

        fake_raw = {
            "twi_mean": 7.4, "twi_median": 7.1, "twi_min": 2.3, "twi_max": 18.5,
            "twi_std": 2.1, "twi_p10": 4.8, "twi_p25": 5.9, "twi_p75": 9.1,
            "twi_p90": 11.2, "percent_low_twi": 22.1, "percent_medium_twi": 54.3,
            "percent_high_twi": 23.6, "resolution_m": 30.0,
            "bounds": [-69.0, 45.0, -68.0, 46.0],
            "crs": "EPSG:4326",
            # twi_array should be stripped
            "twi_array": np.zeros((10, 10)),
        }

        with patch("ai_hydro.analysis.twi.compute_twi", return_value=fake_raw):
            try:
                from ai_hydro.analysis.twi import compute_twi_result

                fake_geojson = {
                    "type": "Polygon",
                    "coordinates": [[[-69, 45], [-68, 45], [-68, 46], [-69, 46], [-69, 45]]],
                }
                result = compute_twi_result(watershed_geojson=fake_geojson)
                _assert_hydro_result(
                    result,
                    expected_data_keys=["twi_mean", "twi_std", "percent_high_twi"],
                )
                # numpy array must NOT appear in data
                assert "twi_array" not in result.data
                assert isinstance(result.data["bounds"], list)
            except ImportError as e:
                pytest.skip(f"TWI deps not installed: {e}")


# ── Forcing mock tests ──────────────────────────────────────────────────────

class TestForcingTool:

    def test_fetch_forcing_data_result_contract(self):
        """Validate HydroResult wrapper for forcing tool."""
        import pandas as pd
        import numpy as np

        n = 365
        dates = pd.date_range("2010-01-01", periods=n, freq="D")
        fake_df = pd.DataFrame({
            "date": dates,
            "pr": np.abs(np.random.normal(2, 1, n)),
            "tmmx": np.random.normal(290, 10, n),
            "tmmn": np.random.normal(280, 10, n),
            "pet": np.abs(np.random.normal(3, 0.5, n)),
        })

        with patch("ai_hydro.data.forcing.fetch_forcing_data", return_value=fake_df):
            try:
                from ai_hydro.data.forcing import fetch_forcing_data_result

                fake_geojson = {
                    "type": "Polygon",
                    "coordinates": [[[-69, 45], [-68, 45], [-68, 46], [-69, 46], [-69, 45]]],
                }
                result = fetch_forcing_data_result(
                    watershed_geojson=fake_geojson,
                    start_date="2010-01-01",
                    end_date="2010-12-31",
                )
                _assert_hydro_result(
                    result,
                    expected_data_keys=["dates", "pr", "n_days"],
                )
                assert isinstance(result.data["dates"], list)
                assert isinstance(result.data["pr"], list)
                assert all(
                    isinstance(v, (float, int, type(None)))
                    for v in result.data["pr"]
                ), "pr column contains non-scalar values"
                # water balance summary stats
                assert "mean_annual_precip_mm" in result.data
            except ImportError as e:
                pytest.skip(f"Forcing deps not installed: {e}")


# ── Live integration tests (skipped by default) ─────────────────────────────

@pytest.mark.live
class TestLiveIntegration:
    """
    End-to-end tests against real USGS APIs.
    Requires internet + full deps.  Run with:
        pytest -m live tests/test_reference_gauges.py
    """

    @pytest.mark.parametrize("gauge", REFERENCE_GAUGES[:2])
    def test_live_delineate_watershed(self, gauge):
        try:
            from ai_hydro.analysis.watershed import delineate_watershed
        except ImportError as e:
            pytest.skip(str(e))

        result = delineate_watershed(gauge_id=gauge["id"])
        _assert_hydro_result(
            result,
            expected_data_keys=["geometry_geojson", "area_km2", "gauge_id"],
        )
        assert result.data["area_km2"] > 0

    @pytest.mark.parametrize("gauge", REFERENCE_GAUGES[:1])
    def test_live_fetch_streamflow(self, gauge):
        try:
            from ai_hydro.data.streamflow import fetch_streamflow_data
        except ImportError as e:
            pytest.skip(str(e))

        result = fetch_streamflow_data(
            gauge_id=gauge["id"],
            start_date="2015-01-01",
            end_date="2015-03-31",
        )
        _assert_hydro_result(result, expected_data_keys=["dates", "q_cms"])
        assert result.data["n_days"] > 0
