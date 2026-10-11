"""server/decide.py against the shared verdict cases that web/sky-local.js is also tested on
(tests/js/verdict.test.mjs), so the Pi and the showcase page can't drift apart."""
import json
from pathlib import Path

import pytest

from server import decide

CASES = json.loads((Path(__file__).parent / "fixtures" / "verdict_cases.json").read_text())["cases"]
BASELINE = 200.0
UNITS_PER_INDEX = decide.INDOOR_SPAN / 100  # the fixtures speak in stale-index points


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_reference_verdict(case):
    v = decide.decide(BASELINE + case["idx"] * UNITS_PER_INDEX, BASELINE, case["rate"] * UNITS_PER_INDEX,
                      case["sky"], fires=case.get("fires"), prev=case.get("prev"))
    want = case["expect"]
    assert (v["key"], v["outdoor_level"], v["stale_index"]) == (want["key"], want["outdoor_level"], case["idx"])
    assert v["reasons"] == want["reasons"]
