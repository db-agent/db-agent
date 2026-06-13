"""
conftest.py — Pytest bootstrap shared by every test in this folder.

The streamlit_app uses flat imports (e.g. `import db`, `from pipeline import …`)
so that Streamlit Community Cloud — which only puts the entry script's own
directory on sys.path — works without any path hacks at the top of the app.

Tests live one level up, so we add both the project root (for `core.*`) and
streamlit_app/ (for flat imports) to sys.path here.
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).parent.parent
_STREAMLIT_APP = _ROOT / "streamlit_app"
sys.path.insert(0, str(_ROOT))           # enables `from core.xxx import`
sys.path.insert(0, str(_STREAMLIT_APP))  # enables `import db`, `import pipeline`, …
