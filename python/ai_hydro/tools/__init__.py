"""
ai_hydro.tools — DEPRECATED
============================

All tool modules have been moved to semantic packages:

    ai_hydro.data.*       — data retrieval (streamflow, forcing, landcover, soil)
    ai_hydro.analysis.*   — analysis (watershed, signatures, twi, geomorphic, curve_number)
    ai_hydro.modelling.*  — models (conceptual/hbv, neural/lstm, metrics)
    ai_hydro.session.*    — session management

Update imports accordingly. This package is kept as an empty namespace
to avoid ImportError in any lingering references.
"""
