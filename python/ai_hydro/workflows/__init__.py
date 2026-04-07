"""
AI-Hydro Workflows Module
==========================

Automated hydrological analysis workflows.

Available Workflows:
- fetch_hydrological_data: Download streamflow and climate data
- compute_signatures: Extract CAMELS-like catchment attributes
- auto_modeling: Automated model calibration
"""

from .fetch_data import fetch_hydrological_data
from .compute_signatures import compute_signatures
from .modeling import auto_modeling

__all__ = [
    "fetch_hydrological_data",
    "compute_signatures",
    "auto_modeling",
]
