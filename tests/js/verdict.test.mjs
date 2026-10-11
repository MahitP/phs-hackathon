// web/sky-local.js against the shared verdict cases that server/decide.py is also tested on
// (tests/test_verdict_parity.py), so the showcase page and the Pi can't drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGlobal, fixture } from "./load-classic.mjs";

const LocalSky = loadGlobal("sky-local.js", "LocalSky");
const { cases } = fixture("verdict_cases.json");

test("LocalSky exposes decide", () => assert.equal(typeof LocalSky.decide, "function"));

for (const c of cases) {
  test(`matches the reference: ${c.name}`, () => {
    const v = LocalSky.decide(c.idx, c.rate, c.sky, { fires: c.fires, prev: c.prev });
    assert.deepEqual([v.key, v.outdoor_level, v.stale_index], [c.expect.key, c.expect.outdoor_level, c.idx]);
    assert.deepEqual([...v.reasons], c.expect.reasons); // copy: the VM realm has its own Array
  });
}
