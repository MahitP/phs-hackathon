// The hours behind the crossover chart, the time ruler and the verdict ribbon: the outdoor
// forecast (CAMS via Open-Meteo), a room simulated with the ventilation model, and a verdict per hour
// computed in order with the same hysteresis as the Pi, so the ribbon doesn't flicker.
import { INFILTRATION, SOURCE } from "./ventilation.js";

const NY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

function nyParts(d) {
  const p = Object.fromEntries(NY.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: p.weekday, minutes: +p.hour * 60 + +p.minute };
}

/** PHS school day: Monday to Friday, 7:30 am to 2:45 pm in Princeton. */
export function occupied(d) {
  const { day, minutes } = nyParts(d);
  return !["Sat", "Sun"].includes(day) && minutes >= 7 * 60 + 30 && minutes < 14 * 60 + 45;
}

/** Minutes east of UTC for New York at that instant (-240 in summer, -300 in winter). */
export function nyOffsetMin(d) {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local - utc) / 60000);
}

/** Stale index at each hour boundary from `start`, with `ach` extra air changes from the window. */
export function simulateRoom({ idx0, start, hours, ach = 0, stepMin = 10 }) {
  const out = [idx0], l = INFILTRATION + Math.max(0, ach);
  let idx = idx0, t = start.getTime();
  const steps = 60 / stepMin, k = Math.exp(-l * stepMin / 60);
  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < steps; s++) {
      const ss = occupied(new Date(t)) ? SOURCE / l : 0;
      idx = ss + (idx - ss) * k;
      t += stepMin * 60000;
    }
    out.push(idx);
  }
  return out;
}

/** Open-Meteo hourly arrays (local wall-clock times) as dated hours, marked past or future. */
export function hourly(f, { now = new Date(), utcOffsetMin } = {}) {
  if (!f || !Array.isArray(f.time)) return [];
  return f.time.map((s, i) => {
    const [d, hm] = s.split("T"), [y, m, dd] = d.split("-").map(Number), [hh, mm] = hm.split(":").map(Number);
    const naive = Date.UTC(y, m - 1, dd, hh, mm || 0);
    const off = utcOffsetMin ?? nyOffsetMin(new Date(naive));
    const t = new Date(naive - off * 60000);
    const pick = (k) => (f[k] && f[k][i] != null ? f[k][i] : null);
    const cloud = pick("cloud_cover");
    return { t, past: t <= now, aqi: pick("us_aqi"), pm25: pick("pm2_5"), aod: pick("aod"), cloud: cloud != null ? cloud / 100 : null,
      temp: pick("temperature"), windDir: pick("wind_dir"), precip: pick("precip_prob") };
  });
}

/** One verdict per hour, in order, each knowing the one before (hysteresis). */
export function verdictsFor(hours, decide) {
  let prev = null;
  return hours.map((h) => {
    const sky = h.aqi == null && h.pm25 == null && h.aod == null ? null : { us_aqi: h.aqi, pm2_5: h.pm25, aod: h.aod };
    const v = decide(Math.round(h.room ?? 0), 0, sky, { prev });
    prev = v;
    return v;
  });
}
