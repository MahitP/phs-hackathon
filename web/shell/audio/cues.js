// The mix as a function of where you are: story time T (the cue sheet below) or, in the live window,
// the real weather over PHS. Pure functions, so node --test checks them; engine.js turns the targets
// into gains and filters. Bed gains are linear, relative to each bed's normalised level (-28 LUFS).
//
//   T 0-1      orbit           Penumbra; Earth's chorus very low; the satellite passes
//   T 1-2.25   the 2023 plume  a rumble grows with the plume; the chorus thins; the score is muffled
//   T 2.25-2.95 cloud 1        whoosh; Penumbra -> Cirrus under the cloud; wind rush as we drop
//   T 3-4.86   Princeton       birds, park, wind in the trees (live wind), distant traffic
//   T 4.22-4.74 the haze rises the town muffles from 8 kHz to 900 Hz and the birds drop out
//   T 4.86-5.36 cloud 2        whoosh; Cirrus -> Hymn to the Dawn
//   T 5.15-5.6 outside the wall close birds and breeze; the sash rises (5.3)
//   T 5.6-8.5  the classroom   room tone, hum, the wall clock; outside heard through the window
//   T 8-8.5    Right now       the live soundscape fades in; the Hymn's last phrase
import { occupied } from "../../model/timeline.js";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const range = (x, a, b) => clamp((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;
const bump = (x, a, m, b) => (x <= a || x >= b ? 0 : x < m ? smooth(range(x, a, m)) : 1 - smooth(range(x, m, b)));
const dbToGain = (db) => 10 ** (db / 20);

/** beds heard outdoors (through the window once we're inside) */
export const OUTDOOR = ["birds", "park", "trees", "breeze", "traffic", "crickets", "rain"];
/** beds that play in the room or in space, never through the window */
export const INDOOR = ["room", "hum", "chorus", "rumble"];
export const BEDS = [...OUTDOOR, ...INDOOR];

/** the cloud curtains' swap points, where the score changes act under cover */
export const SWAPS = [2.656, 5.15];
/** the score for story time T */
export const actAt = (T) => (T >= 8 ? "dawn-end" : T < SWAPS[0] ? "penumbra" : T < SWAPS[1] ? "cirrus" : "dawn");

/** one-shots on the story's timeline: [T, cue, where it sounds from] */
export const STORY_SHOTS = [
  [0.47, "sat-beep", "satellite"], [0.6, "sat-beep", "satellite"],
  [1.05, "boom", null],
  [2.25, "whoosh", null], [4.86, "whoosh", null],
  [5.3, "sash-up", "window"],
  [5.88, "sash-down", "window"], [5.95, "latch", "window"],
  [5.98, "relay", "device"], [6.94, "snap", "device"],
];

/**
 * The marks passed between two story times, forward only and only at reading speed: scrolling back,
 * or flinging through (Watch again glides back to the start), fires nothing.
 */
export function crossings(prevT, T, dt, marks) {
  if (!(T > prevT) || dt <= 0) return [];
  if ((T - prevT) / dt > 3) return []; // faster than 3 chapters a second is a fling, not reading
  return marks.filter((m) => prevT < m && T >= m);
}

/** A shut window cuts the outside by 18 dB and most of its highs; open (≥ 0.45 m) lets it all in. */
export function throughWindow(raise) {
  const k = clamp(raise / 0.45);
  return { gain: dbToGain(lerp(-18, 0, smooth(k))), lowpass: lerp(700, 14000, k ** 0.7) };
}

function windBeds(wind) {
  const w = clamp((wind ?? 8) / 30);
  return { trees: 0.25 + 0.75 * w, breeze: clamp(((wind ?? 8) - 6) / 30) };
}

/**
 * The story at time T. opts: raise (the sash, m), wind (km/h), beat (the verdict on screen, 7-8).
 * Returns bed targets, how much of the outside is heard through the window (inside 0..1), filters,
 * and whether the wall clock ticks.
 */
export function storyMix(T, { raise = 0, wind = 8, beat = null } = {}) {
  const beds = Object.fromEntries(BEDS.map((k) => [k, 0]));
  let musicLowpass = 20000, outsideLowpass = 20000, inside = 0, clock = false;

  // act 1: space, then the plume
  const plume = smooth(range(T, 1.0, 2.1));
  if (T < SWAPS[0]) {
    beds.chorus = 0.45 * (1 - 0.75 * plume);
    beds.rumble = 0.9 * plume;
    musicLowpass = lerp(20000, 1800, plume);
  }
  // cloud 1: a wind rush as we fall through it
  beds.breeze = Math.max(beds.breeze, 1.2 * bump(T, 2.3, 2.7, 3.2));
  beds.trees = Math.max(beds.trees, 0.6 * bump(T, 2.5, 2.95, 3.3));

  // act 2: Princeton, all around us
  if (T >= 2.6 && T < 5.15) {
    const town = range(T, 2.6, 3.0), haze = smooth(range(T, 4.22, 4.74));
    const w = windBeds(wind);
    beds.birds = 0.85 * town * (1 - haze);
    beds.park = 0.5 * town;
    beds.trees = Math.max(beds.trees, w.trees * town);
    beds.breeze = Math.max(beds.breeze, w.breeze * town);
    beds.traffic = 0.45 * town;
    outsideLowpass = haze > 0 ? lerp(8000, 900, haze) : 20000;
  }
  // outside the brick wall: close birds and breeze
  if (T >= 5.15 && T < 5.6) {
    const w = windBeds(wind);
    beds.birds = 1.0; beds.park = 0.3; beds.breeze = Math.max(0.6, w.breeze); beds.trees = 0.3 * w.trees; beds.traffic = 0.25;
  }
  // the classroom: room tone and clock; the outside through the window, set by the sash
  if (T >= 5.5) {
    inside = smooth(range(T, 5.5, 5.7));
    clock = T >= 5.6;
    beds.room = 1.0 * inside;
    beds.hum = 0.45 * inside;
    if (T >= 5.6) {
      const w = windBeds(wind);
      beds.birds = 0.8; beds.park = 0.35; beds.trees = w.trees; beds.breeze = w.breeze; beds.traffic = 0.3;
    }
    if (beat === "shut" && T >= 7 && T < 8) beds.rumble = 0.55;
  }
  const win = throughWindow(raise);
  const outsideGain = lerp(1, win.gain, inside);
  if (inside > 0) outsideLowpass = Math.min(outsideLowpass, lerp(20000, win.lowpass, inside));
  return { music: actAt(T), beds, musicLowpass, outsideLowpass, outsideGain, inside, clock, satellite: bump(T, 0.25, 0.56, 0.9) };
}

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });
const nyHour = (d) => +NY.format(d);
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

/**
 * The live window: the real weather outside, heard through the window, and the room.
 * state: { live (store's reading or null), now (Date), raise (the sash, m) }
 */
export function liveMix({ live, now = new Date(), raise = 0 }) {
  const beds = Object.fromEntries(BEDS.map((k) => [k, 0]));
  beds.room = 1.0;
  beds.hum = occupied(now) ? 0.45 : 0; // fluorescent lights and projectors in school hours
  const win = throughWindow(raise);
  if (!live) return { beds, outsideGain: win.gain, outsideLowpass: win.lowpass, inside: 1, clock: true };

  const el = live.sunElevation ?? 0;
  const day = smooth(range(el, -6, 4)); // birds start in the dawn chorus, before sunrise
  const haze = smooth(range(live.aod ?? 0, 0.5, 1.2)); // smoke quiets the birds and the world
  const raining = (live.precip ?? 0) > 0.1 || RAIN_CODES.has(live.weatherCode);
  const w = windBeds(live.wind);
  const h = nyHour(now);
  beds.birds = 0.8 * day * (1 - haze) * (raining ? 0.3 : 1);
  beds.park = 0.3 * day;
  beds.trees = w.trees;
  beds.breeze = w.breeze;
  beds.crickets = (1 - day) * ((live.temp ?? 0) > 10 ? 0.7 : 0) * (raining ? 0.2 : 1);
  beds.rain = raining ? 0.9 : 0;
  beds.traffic = (h >= 7 && h < 9) || (h >= 14 && h < 16) ? 0.6 : 0.12;
  return { beds, outsideGain: win.gain, outsideLowpass: win.lowpass * lerp(1, 0.35, haze), inside: 1, clock: true };
}

/** the app (a view over Princeton): the same live weather, heard outdoors all around; no room, no clock */
export function appMix({ live, now = new Date() }) {
  const m = liveMix({ live, now, raise: 1 });
  const haze = smooth(range(live?.aod ?? 0, 0.5, 1.2));
  return { ...m, beds: { ...m.beds, room: 0, hum: 0 }, outsideGain: 0.7, outsideLowpass: 20000 * lerp(1, 0.35, haze), inside: 0, clock: false };
}
