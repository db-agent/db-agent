"""
conftest.py — Pytest bootstrap shared by every test in this folder.

The streamlit_app uses flat imports (e.g. `import db`, `from models import …`)
so that Streamlit Community Cloud — which only puts the entry script's own
directory on sys.path — works without any path hacks at the top of the app.

Tests live one level up, so we add streamlit_app/ to sys.path here. Pytest
discovers and runs conftest.py before collecting any tests.
"""

import sys
from pathlib import Path

_STREAMLIT_APP = Path(__file__).parent.parent / "streamlit_app"
sys.path.insert(0, str(_STREAMLIT_APP))
