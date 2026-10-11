// Hand-drawn SVG charts for the live window: the crossover chart (outside air and the room, one lane
// each on a shared time axis, never two y-scales on one plot), sparklines and the 48-hour time ruler.
// Ink is graphite; colour is reserved for verdicts. Past is solid, forecast dashed, simulated dotted.
import { MARK } from "../shell/copy.js";

const NS = "http://www.w3.org/2000/svg";
export function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const text = (parent, x, y, str, attrs = {}) => { const t = el("text", { x, y, ...attrs }, parent); t.textContent = str; return t; };

export function hourLabel(d) {
  const h = d.getHours();
  return h === 0 ? "12 am" : h === 12 ? "noon" : h < 12 ? `${h} am` : `${h - 12} pm`;
}

/** Path through points [[x, y], ...] with nulls breaking the line. */
function pathOf(pts) {
  let d = "", pen = false;
  for (const p of pts) {
    if (!p || p[1] == null || !Number.isFinite(p[1])) { pen = false; continue; }
    d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    pen = true;
  }
  return d;
}

/**
 * The crossover chart.
 * data: { now: Date, hours: [{ t, past, aqi, room, roomKind: "measured"|"simulated", verdict }],
 *         whatIf: [{ t, room }] | null, roomNow, aqiNow }
 */
export function drawCrossover(svg, data, { width = 480, height = 200 } = {}) {
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const L = 0, R = width - 44, laneH = 62, gap = 34, top1 = 18, top2 = top1 + laneH + gap, axisY = top2 + laneH + 16;
  const hrs = data.hours;
  if (!hrs.length) { text(svg, 0, 40, "No forecast yet.", { class: "c-empty" }); return null; }
  const t0 = hrs[0].t.getTime(), t1 = hrs[hrs.length - 1].t.getTime();
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (R - L);
  const maxAqi = Math.max(100, ...hrs.map((h) => h.aqi ?? 0)) * 1.08;
  const yA = (v) => top1 + laneH - (Math.min(v, maxAqi) / maxAqi) * laneH;
  const yR = (v) => top2 + laneH - (Math.min(v, 100) / 100) * laneH;
  const step = (R - L) / Math.max(1, hrs.length - 1);

  // the hours when opening the window helps: shaded behind both lanes
  const shade = el("g", { class: "c-open" }, svg);
  hrs.forEach((h) => {
    if (h.verdict !== "open") return;
    el("rect", { x: x(h.t.getTime()) - step / 2, y: top1 - 6, width: step, height: top2 + laneH - top1 + 6, fill: MARK.open, opacity: 0.1 }, shade);
  });

  // lanes: thresholds as recessive hairlines with their meaning written on them
  const grid = el("g", { class: "c-grid" }, svg);
  const rule = (y, label) => { el("line", { x1: L, x2: R, y1: y, y2: y }, grid); text(grid, R + 6, y + 4, label, { class: "c-tick" }); };
  el("line", { x1: L, x2: R, y1: top1 + laneH, y2: top1 + laneH, class: "c-base" }, grid);
  el("line", { x1: L, x2: R, y1: top2 + laneH, y2: top2 + laneH, class: "c-base" }, grid);
  rule(yA(50), "50"); rule(yA(100), "100");
  rule(yR(40), "40"); rule(yR(70), "70");
  text(svg, L, top1 - 8, "Outside, US AQI", { class: "c-lane" });
  text(svg, L, top2 - 8, data.roomKind === "measured" ? "Room, stale index" : "Room, stale index (simulated)", { class: "c-lane" });

  // outside: model analysis up to now (solid), forecast after (dashed)
  const nowT = data.now.getTime();
  const past = hrs.filter((h) => h.t.getTime() <= nowT + 1), next = hrs.filter((h) => h.t.getTime() >= nowT - 3600e3);
  const ptsA = (list) => list.map((h) => [x(h.t.getTime()), h.aqi != null ? yA(h.aqi) : null]);
  const aNow = data.aqiNow != null ? [[x(nowT), yA(data.aqiNow)]] : [];
  el("path", { d: pathOf([...ptsA(past), ...aNow]), class: "c-line" }, svg);
  el("path", { d: pathOf([...aNow, ...ptsA(next.filter((h) => h.t.getTime() > nowT))]), class: "c-line c-dash" }, svg);

  // room: measured or simulated before now, projected after (with the sash where SkyWindow says)
  const ptsR = (list, key = "room") => list.map((h) => [x(h.t.getTime()), h[key] != null ? yR(h[key]) : null]);
  const rNow = data.roomNow != null ? [[x(nowT), yR(data.roomNow)]] : [];
  el("path", { d: pathOf([...ptsR(past), ...rNow]), class: "c-line" + (data.roomKind === "measured" ? "" : " c-dot") }, svg);
  el("path", { d: pathOf([...rNow, ...ptsR(next.filter((h) => h.t.getTime() > nowT))]), class: "c-line c-dash" }, svg);
  const whatIf = el("path", { d: "", class: "c-whatif" }, svg);
  const whatIfLabel = text(svg, R, 0, "", { class: "c-whatif-label", "text-anchor": "end", visibility: "hidden" });

  // now
  el("line", { x1: x(nowT), x2: x(nowT), y1: top1 - 12, y2: top2 + laneH + 4, class: "c-now" }, svg);
  if (data.aqiNow != null) { el("circle", { cx: x(nowT), cy: yA(data.aqiNow), r: 4.5, class: "c-dotmark" }, svg); text(svg, x(nowT) + 9, yA(data.aqiNow) - 7, String(Math.round(data.aqiNow)), { class: "c-val" }); }
  if (data.roomNow != null) { el("circle", { cx: x(nowT), cy: yR(data.roomNow), r: 4.5, class: "c-dotmark" }, svg); text(svg, x(nowT) + 9, yR(data.roomNow) - 7, String(Math.round(data.roomNow)), { class: "c-val" }); }

  // time axis: clock hours every 3 h, "now" written at the line
  const ax = el("g", { class: "c-axis" }, svg);
  hrs.forEach((h) => {
    const hr = h.t.getHours();
    if (hr % 3 !== 0) return;
    const xx = x(h.t.getTime());
    if (Math.abs(xx - x(nowT)) < 36) return; // room for "6 am" beside "now"
    text(ax, xx, axisY, hourLabel(h.t), { "text-anchor": "middle" });
  });
  text(ax, x(nowT), axisY, "now", { "text-anchor": "middle", class: "c-now-label" });

  // crosshair + readout on hover
  const hover = el("g", { class: "c-hover", visibility: "hidden" }, svg);
  const hl = el("line", { y1: top1 - 6, y2: top2 + laneH, class: "c-cross" }, hover);
  const ha = el("circle", { r: 4, class: "c-dotmark" }, hover), hr2 = el("circle", { r: 4, class: "c-dotmark" }, hover);
  const hit = el("rect", { x: L, y: 0, width: R - L, height: axisY, fill: "transparent", class: "c-hit" }, svg);

  return {
    x, yR, nowX: x(nowT),
    /** the room with the sash where you've put it: dotted (modelled), ending at the chart's edge, labelled */
    setWhatIf(points, label = "") {
      const pts = (points || []).filter((p) => p.t.getTime() <= t1 + 1);
      whatIf.setAttribute("d", pts.length > 1 ? pathOf(pts.map((p) => [x(p.t.getTime()), yR(p.room)])) : "");
      if (pts.length < 2 || !label) { whatIfLabel.setAttribute("visibility", "hidden"); return; }
      const end = pts[pts.length - 1], y = yR(end.room);
      // a line above it, clear of the value written beside the now mark; below it if that would leave the lane
      whatIfLabel.setAttribute("y", (y - 24 < top2 + 12 ? y + 18 : y - 24).toFixed(1));
      whatIfLabel.textContent = label;
      whatIfLabel.setAttribute("visibility", "visible");
    },
    hover: { group: hover, line: hl, a: ha, r: hr2, hit, hours: hrs, x, yA, yR },
  };
}

/** A small trend line: 2px ink, end dot, no axes. */
export function drawSpark(svg, values, { width = 96, height = 24, minSpan = 10 } = {}) {
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const v = values.filter((n) => n != null);
  if (v.length < 2) return;
  // scaled to its own range, so the shape of the day shows; a minimum span keeps noise from looking like a trend
  const mid = (Math.max(...v) + Math.min(...v)) / 2, half = Math.max(minSpan, Math.max(...v) - Math.min(...v)) / 2;
  const hi = mid + half, lo = mid - half;
  const x = (i) => 3 + (i / (values.length - 1)) * (width - 8), y = (n) => height - 3 - ((n - lo) / Math.max(1e-6, hi - lo)) * (height - 6);
  el("path", { d: pathOf(values.map((n, i) => [x(i), n != null ? y(n) : null])), class: "s-line" }, svg);
  const last = values.length - 1 - [...values].reverse().findIndex((n) => n != null);
  el("circle", { cx: x(last), cy: y(values[last]), r: 2.5, class: "s-end" }, svg);
}

/**
 * The 48-hour time ruler along the bottom edge: hour ticks like a tape measure, a label every 3 hours,
 * a verdict ribbon whose cell height is how far the sash would be open that hour, and the now mark.
 * hours: [{ t, past, verdict, raise }]
 */
export function drawRuler(svg, hours, now, { width, height = 64, raiseMax = 0.64 } = {}) {
  svg.textContent = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width); svg.setAttribute("height", height);
  if (!hours.length) return null;
  const L = 12, R = width - 12, t0 = hours[0].t.getTime(), span = 3600e3 * hours.length;
  const x = (t) => L + ((t - t0) / span) * (R - L);
  const cw = (R - L) / hours.length;
  const ribbonY = 8, ribbonH = 14;

  // ribbon: one cell per hour; colour = verdict, height = sash opening (shut is a hairline)
  const rib = el("g", { class: "r-ribbon" }, svg);
  hours.forEach((h) => {
    if (!h.verdict) return;
    const k = Math.max(0.1, (h.raise ?? 0) / raiseMax), hh = Math.max(2, ribbonH * Math.min(1, k));
    el("rect", { x: x(h.t.getTime()) + 1, y: ribbonY + ribbonH - hh, width: Math.max(1, cw - 2), height: hh, fill: MARK[h.verdict], rx: 1, opacity: h.past ? 0.55 : 1 }, rib);
  });

  // the tape: a baseline, a tick each hour, longer every 3 h, longest at midnight
  const tape = el("g", { class: "r-tape" }, svg);
  const baseY = ribbonY + ribbonH + 6;
  el("line", { x1: L, x2: R, y1: baseY, y2: baseY, class: "r-base" }, tape);
  hours.forEach((h) => {
    const xx = x(h.t.getTime()), hr = h.t.getHours(), len = hr === 0 ? 14 : hr % 3 === 0 ? 9 : 5;
    el("line", { x1: xx, x2: xx, y1: baseY, y2: baseY + len, class: h.past ? "r-tick" : "r-tick r-fut" }, tape);
    // a label every 3 hours; every 12 on a phone, where 48 hours share 360 px
    if (hr % (width < 700 ? 12 : 3) === 0) {
      const t = text(tape, xx + 3, baseY + 22, hr === 0 ? dayName(h.t, now) : hourLabel(h.t), { class: hr === 0 ? "r-day" : "r-hour" });
      if (xx + 60 > R) t.setAttribute("text-anchor", "end");
    }
  });

  // now: a playhead with a flag
  const nx = x(now.getTime());
  const g = el("g", { class: "r-now" }, svg);
  el("line", { x1: nx, x2: nx, y1: 2, y2: baseY + 10 }, g); // stops above the hour labels
  el("path", { d: `M${nx - 5} 0h10l-5 6z` }, g);
  return { x, nowX: nx, baseY };
}

function dayName(d, now) {
  const a = new Date(d), b = new Date(now); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 864e5);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : d.toLocaleDateString([], { weekday: "long" });
}
