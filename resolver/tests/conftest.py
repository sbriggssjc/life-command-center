import os
import sys

# Make `app` importable when tests run from the resolver/ dir or the repo root.
_HERE = os.path.dirname(os.path.abspath(__file__))
_RESOLVER = os.path.dirname(_HERE)
if _RESOLVER not in sys.path:
    sys.path.insert(0, _RESOLVER)
