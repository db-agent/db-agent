"""
conftest.py — Pytest bootstrap shared by every test in this folder.

App modules (config, db, pipeline, …) now live at the repo root alongside
core/ and tests/. Adding the root to sys.path is all that's needed for both
flat imports (import db, import pipeline) and package imports (from core.xxx).
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))
