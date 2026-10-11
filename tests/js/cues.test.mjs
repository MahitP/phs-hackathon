import test from "node:test";
import assert from "node:assert/strict";
import { actAt, storyMix, liveMix, throughWindow, crossings, OUTDOOR } from "../../web/shell/audio/cues.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const live = (o = {}) => ({ wind: 8, temp: 14, precip: 0, weatherCode: 3, sunElevation: 30, aod: 0.15, cloud: 40, ...o });
// Wednesday 15 Oct 2026, 10:00 and 22:00 in Princeton (EDT, UTC-4)
const SCHOOL = new Date("2026-10-15T14:00:00Z"), NIGHT = new Date("2026-10-16T02:00:00Z"), RUSH = new Date("2026-10-15T12:30:00Z");

test("one score per act, swapped at the cloud curtains; the last phrase from Right now", () => {
  assert.equal(actAt(0.2), "penumbra");
  assert.equal(actAt(2.6), "penumbra");
  assert.equal(actAt(2.7), "cirrus");
  assert.equal(actAt(5.1), "cirrus");
  assert.equal(actAt(5.2), "dawn");
  assert.equal(actAt(7.9), "dawn");
  assert.equal(actAt(8.0), "dawn-end");
});

test("orbit: Earth's chorus, very low; the plume brings the rumble and muffles the score", () => {
  const orbit = storyMix(0.4), plume = storyMix(2.0);
  assert.ok(orbit.beds.chorus > 0 && orbit.beds.chorus < 0.6);
  assert.equal(orbit.beds.rumble, 0);
  assert.ok(plume.beds.rumble > 0.5);
  assert.ok(plume.beds.chorus < orbit.beds.chorus, "the chorus thins");
  assert.ok(plume.musicLowpass < 5000 && orbit.musicLowpass >= 18000);
});

test("Princeton: birds and trees all around; the haze muffles the town and the birds drop out", () => {
  const town = storyMix(3.5, { wind: 8 }), hazy = storyMix(4.8, { wind: 8 });
  assert.ok(town.beds.birds > 0.5 && town.beds.trees > 0);
  assert.equal(town.inside, 0);
  assert.ok(town.outsideLowpass >= 18000);
  near(hazy.beds.birds, 0, 0.05);
  assert.ok(hazy.outsideLowpass <= 1000);
});

test("trees follow the live wind", () => {
  assert.ok(storyMix(3.5, { wind: 30 }).beds.trees > storyMix(3.5, { wind: 2 }).beds.trees);
});

test("in the classroom the outside comes through the window: -18 dB and muffled shut, full when open", () => {
  const shut = throughWindow(0), open = throughWindow(0.6);
  near(20 * Math.log10(shut.gain), -18, 0.01);
  assert.ok(shut.lowpass < 1000);
  near(open.gain, 1);
  assert.ok(open.lowpass > 10000);
  assert.ok(throughWindow(0.2).gain > shut.gain && throughWindow(0.2).gain < 1);
  const room = storyMix(6.5, { raise: 0 });
  assert.equal(room.inside, 1);
  assert.ok(room.beds.room > 0.5 && room.clock);
  near(room.outsideGain, shut.gain);
});

test("the shut verdict's smoke brings the rumble back", () => {
  assert.equal(storyMix(7.3).beds.rumble, 0);
  assert.ok(storyMix(7.6, { beat: "shut" }).beds.rumble > 0.3);
});

test("live: birds by day, crickets on a warm night, rain when it rains", () => {
  const day = liveMix({ live: live(), now: SCHOOL, raise: 0 });
  assert.ok(day.beds.birds > 0.4);
  assert.equal(day.beds.crickets, 0);
  const night = liveMix({ live: live({ sunElevation: -20, temp: 15 }), now: NIGHT, raise: 0 });
  assert.equal(night.beds.birds, 0);
  assert.ok(night.beds.crickets > 0.4);
  assert.equal(liveMix({ live: live({ sunElevation: -20, temp: 6 }), now: NIGHT, raise: 0 }).beds.crickets, 0, "too cold for crickets");
  assert.ok(liveMix({ live: live({ precip: 1.2, weatherCode: 63 }), now: SCHOOL, raise: 0 }).beds.rain > 0.5);
  assert.equal(day.beds.rain, 0);
});

test("live: heavy haze muffles the window further and silences the birds", () => {
  const clear = liveMix({ live: live({ aod: 0.1 }), now: SCHOOL, raise: 0.5 });
  const smoke = liveMix({ live: live({ aod: 1.6 }), now: SCHOOL, raise: 0.5 });
  assert.ok(smoke.outsideLowpass < clear.outsideLowpass * 0.6);
  assert.ok(smoke.beds.birds < 0.05);
});

test("live: traffic at rush hour, the hum only in school hours", () => {
  assert.ok(liveMix({ live: live(), now: RUSH, raise: 0 }).beds.traffic > liveMix({ live: live(), now: NIGHT, raise: 0 }).beds.traffic);
  assert.ok(liveMix({ live: live(), now: SCHOOL, raise: 0 }).beds.hum > 0);
  assert.equal(liveMix({ live: live(), now: NIGHT, raise: 0 }).beds.hum, 0);
});

test("live without data: room tone only, nothing invented outside", () => {
  const m = liveMix({ live: null, now: SCHOOL, raise: 0 });
  for (const k of OUTDOOR) assert.equal(m.beds[k], 0, k);
  assert.ok(m.beds.room > 0);
});

test("one-shots fire on forward crossings at reading speed, never backwards or when flung through", () => {
  const marks = [5.3, 5.88];
  assert.deepEqual(crossings(5.26, 5.32, 0.05, marks), [5.3]); // 1.2 chapters a second
  assert.deepEqual(crossings(5.32, 5.26, 0.05, marks), [], "backwards");
  assert.deepEqual(crossings(5.2, 5.95, 0.016, marks), [], "a fling (or Watch again) skips them");
  assert.deepEqual(crossings(5.29, 5.29, 0.016, marks), []);
});

test("the app hears the live weather outdoors: no room tone, no clock, birds by day", async () => {
  const { appMix } = await import("../../web/shell/audio/cues.js");
  const day = { sunElevation: 30, aod: 0.1, wind: 12, temp: 18, precip: 0, weatherCode: 1 };
  const m = appMix({ live: day, now: new Date("2026-10-12T11:00:00-04:00") });
  assert.equal(m.beds.room, 0);
  assert.equal(m.beds.hum, 0);
  assert.equal(m.clock, false);
  assert.equal(m.inside, 0);
  assert.ok(m.beds.birds > 0.3, `birds ${m.beds.birds}`);
  const smoky = appMix({ live: { ...day, aod: 1.4 }, now: new Date("2026-10-12T11:00:00-04:00") });
  assert.ok(smoky.outsideLowpass < m.outsideLowpass, "smoke muffles the world");
  assert.equal(appMix({ live: null }).clock, false);
});
