// web/model/timeline.js: the hours behind the chart, the ruler and the verdict ribbon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { occupied, simulateRoom, hourly, verdictsFor } from "../../web/model/timeline.js";
import { loadGlobal } from "./load-classic.mjs";

const LocalSky = loadGlobal("sky-local.js", "LocalSky");
// local wall-clock times in New Jersey, written out so the test doesn't depend on the machine's zone
const at = (iso) => new Date(iso);

test("the room is occupied on school days during school hours only", () => {
  assert.equal(occupied(at("2026-10-12T09:00:00-04:00")), true, "Monday 9 am");
  assert.equal(occupied(at("2026-10-12T07:00:00-04:00")), false, "Monday 7 am");
  assert.equal(occupied(at("2026-10-12T15:30:00-04:00")), false, "Monday 3:30 pm");
  assert.equal(occupied(at("2026-10-10T10:00:00-04:00")), false, "Saturday");
});

test("the simulated room gets staler in class and clears overnight", () => {
  const morning = simulateRoom({ idx0: 10, start: at("2026-10-12T08:00:00-04:00"), hours: 5, ach: 0 });
  assert.ok(morning.at(-1) > 25, `shut through the morning: ${morning.at(-1)}`);
  const night = simulateRoom({ idx0: 50, start: at("2026-10-12T20:00:00-04:00"), hours: 8, ach: 0 });
  assert.ok(night.at(-1) < 10, `empty overnight: ${night.at(-1)}`);
  assert.equal(morning.length, 6, "one value per hour boundary, start included");
});

test("an open sash keeps a class fresher", () => {
  const shut = simulateRoom({ idx0: 30, start: at("2026-10-12T09:00:00-04:00"), hours: 3, ach: 0 });
  const open = simulateRoom({ idx0: 30, start: at("2026-10-12T09:00:00-04:00"), hours: 3, ach: 1.2 });
  assert.ok(open.at(-1) < shut.at(-1));
});

test("forecast arrays become dated hours, split at now", () => {
  const forecast = { time: ["2026-10-12T00:00", "2026-10-12T01:00", "2026-10-12T02:00"], us_aqi: [20, 30, 40], pm2_5: [5, 6, 7], aod: [0.1, 0.1, 0.2], cloud_cover: [0, 50, 100], temperature: [10, 9, 8] };
  const hrs = hourly(forecast, { now: at("2026-10-12T01:20:00-04:00"), utcOffsetMin: -240 });
  assert.equal(hrs.length, 3);
  assert.equal(hrs[1].aqi, 30);
  assert.equal(hrs[1].t.toISOString(), "2026-10-12T05:00:00.000Z");
  assert.deepEqual(hrs.map((h) => h.past), [true, true, false]);
  assert.equal(hrs[2].cloud, 1);
});

test("hourly verdicts use the same rules and do not flicker at a threshold", () => {
  const sky = (aqi) => ({ aqi, pm25: 10.5, aod: 0.2 });
  const hrs = [102, 99, 102, 99, 94].map((aqi) => ({ ...sky(aqi), room: 20 }));
  const keys = verdictsFor(hrs, LocalSky.decide).map((v) => v.key);
  assert.deepEqual(keys, ["shut", "shut", "shut", "shut", "either"], "99 stays bad after bad; 94 leaves it");
});

test("a clean sky with a stale room opens; a smoky one stays shut", () => {
  const keys = verdictsFor([{ aqi: 30, pm25: 5.5, aod: 0.1, room: 45 }, { aqi: 160, pm25: 70.5, aod: 1.2, room: 45 }], LocalSky.decide).map((v) => v.key);
  assert.deepEqual(keys, ["open", "shut"]);
});
