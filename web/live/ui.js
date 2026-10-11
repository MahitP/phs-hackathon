// The live window's interface, set on the classroom wall beside the 3D window: the verdict, why,
// the crossover chart, the four sill instruments, the 48-hour ruler and the callouts.
// All data text goes in with textContent. Motion only ever shows a cause.
import { LABEL, WHY, STRETCH, RAISE, verdictKey } from "../shell/copy.js";
import { drawCrossover, drawSpark, drawRuler, hourLabel } from "./chart.js";
import { hourly, simulateRoom, verdictsFor } from "../model/timeline.js";
import { createLeaders } from "./leaders.js";
import { airflow } from "../model/ventilation.js";

const $ = (id) => document.getElementById(id);
const setText = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
const f = (c) => (c == null ? null : Math.round(c * 9 / 5 + 32));
const mph = (k) => (k == null ? null : Math.round(k * 0.621371));
const clockOf = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();

// sky-local.js declares `const LocalSky` in a classic script: a global binding, not a window property
const localSky = () => (typeof LocalSky !== "undefined" ? LocalSky : null); // eslint-disable-line no-undef

const AQI_WORD = (a) => (a == null ? "" : a <= 50 ? "Good" : a <= 100 ? "Moderate" : a <= 150 ? "Unhealthy for sensitive groups" : a <= 200 ? "Unhealthy" : a <= 300 ? "Very unhealthy" : "Hazardous");

export function createLiveUI({ store, sound, router, reduced }) {
  const root = document.documentElement, live = $("live");
  const els = {
    status: $("lv-status"), statusText: $("lv-status-text"), when: $("lv-when"), verdict: $("live-verdict"), reason: $("lv-reason"),
    chart: $("lv-chart-svg"), chartCap: $("lv-chart-cap"), whatif: $("lv-whatif"), reset: $("lv-reset"), read: $("lv-read"), said: $("lv-said"),
    why: $("lv-why"), sheet: $("lv-sheet"), path: $("lv-path"), sheetNote: $("lv-sheet-note"), ruler: $("lv-ruler-svg"), rulerCap: $("lv-ruler-cap"),
    sr: $("sr-announce"),
  };
  let data = null, shownKey = null, chart = null, ruler = null, whatIf = null, roomHistory = null, historyAt = 0;
  let leaders = null, lastSec = -1, lastDraw = 0;

  // ---------- status: where the numbers come from and how old they are ----------
  function statusLine(s) {
    const l = s.live, age = s.age != null ? Math.round(s.age / 1000) : null;
    const ago = age == null ? "" : age < 5 ? "just now" : age < 90 ? `${age} s ago` : `${Math.round(age / 60)} min ago`;
    switch (s.status) {
      case "ok":
        if (s.source === "pi") return l?.mock ? `Pi server, simulated sensors, ${ago}` : `Live from the Pi, ${ago}`;
        return "Live sky, simulated room";
      case "warming": return "The Pi is warming up its air sensor";
      case "stale": return `As of ${clockOf(new Date(s.at))}, reconnecting`;
      case "offline": return l?.at ? `Offline. Last reading ${new Date(l.at).toLocaleDateString([], { month: "short", day: "numeric" })}, ${clockOf(new Date(l.at))}` : "Offline";
      case "error": return "No reading yet. Retrying";
      default: return "Checking the air at PHS";
    }
  }

  // ---------- the verdict: the sash moves first, then the word, then the reason ----------
  function showVerdict(key, l, s) {
    const changed = key !== shownKey;
    const apply = () => {
      setText(els.verdict, LABEL[key]);
      els.verdict.dataset.v = key;
      if (!reduced && changed && shownKey && window.gsap) gsap.to(els.verdict, { fontStretch: STRETCH[key] + "%", duration: 0.6, ease: "power3.inOut" });
      else els.verdict.style.fontStretch = STRETCH[key] + "%";
    };
    const reason = () => setText(els.reason, reasonFor(key, l, s));
    if (!changed) { reason(); return; }
    const first = shownKey === null;
    shownKey = key;
    if (first || reduced) { apply(); reason(); }
    else { sound.verdict?.(key); setTimeout(apply, 150); setTimeout(reason, 300); setText(els.sr, `${LABEL[key]} ${WHY[key]}`); }
  }

  function reasonFor(key, l) {
    if (!l) return WHY[key];
    const out = l.aqi != null ? `outside AQI ${Math.round(l.aqi)}` : "outside";
    const room = l.stale != null ? `the room ${Math.round(l.stale)} of 100` : "the room";
    if (key === "open") return l.stale >= 25 ? `The room (${Math.round(l.stale)}) is staler than the sky (AQI ${Math.round(l.aqi)}). Let it in.` : `Clean air on both sides: ${out}, ${room}. Fresh air is a bonus.`;
    if (key === "either") return `About the same inside and out: ${out}, ${room}.`;
    if (key === "shut") return l.aod > 0.7 && !(l.aqi > 100) ? `Heavy haze overhead (AOD ${l.aod.toFixed(2)}). Keep the windows shut.` : `The air outside is worse: ${out}. Keep the windows shut.`;
    return `The room just spiked to ${Math.round(l.stale)} of 100. Open up until it clears.`;
  }

  // ---------- hours for the chart and the ruler ----------
  function timelineHours(l, now) {
    const hrs = hourly(l.forecast, { now });
    if (!hrs.length) return [];
    // the room: measured history on the Pi, otherwise simulated with the ventilation model
    const nowIdx = l.stale ?? 20;
    const i0 = Math.max(0, hrs.findIndex((h) => h.t > now) - 1);
    const recommendedRaise = RAISE[verdictKey(l.verdict)] ?? 0;
    const ach = airflow({ raise: recommendedRaise, windKmh: l.wind ?? 0, tOutC: l.temp }).ach;
    const fwd = simulateRoom({ idx0: nowIdx, start: hrs[i0].t, hours: hrs.length - i0 - 1, ach });
    for (let i = i0; i < hrs.length; i++) hrs[i].room = fwd[i - i0];
    if (roomHistory && roomHistory.length) {
      for (const h of hrs) if (h.past) {
        const near = roomHistory.filter((r) => Math.abs(r.ts * 1000 - h.t.getTime()) < 1800e3);
        h.room = near.length ? near.reduce((a, r) => a + r.stale_index, 0) / near.length : null;
        h.roomKind = "measured";
      }
    } else {
      // back-cast: a shut room with a normal school timetable, from a clean start a day ago,
      // eased over its last few hours onto today's reading (solving for the start instead blows up)
      const sim = simulateRoom({ idx0: 5, start: hrs[0].t, hours: i0, ach: 0 });
      const miss = nowIdx - sim[i0];
      for (let i = 0; i <= i0; i++) {
        hrs[i].room = Math.max(0, Math.min(100, sim[i] + miss * Math.exp(-(i0 - i) / 2.5)));
        hrs[i].roomKind = "simulated";
      }
    }
    const decide = localSky()?.decide;
    if (decide) verdictsFor(hrs, decide).forEach((v, i) => { hrs[i].verdict = v.key; hrs[i].raise = RAISE[v.key]; });
    return hrs;
  }

  async function loadHistory(s) {
    if (s.source !== "pi" || Date.now() - historyAt < 5 * 60e3) return;
    historyAt = Date.now();
    try { const r = await fetch("api/history?minutes=1440", { cache: "no-store" }); if (r.ok) { roomHistory = await r.json(); draw(true); } } catch { /* keep the simulation */ }
  }

  function draw(force = false) {
    const l = data?.live;
    if (!l) return;
    if (!force && performance.now() - lastDraw < 30000 && chart) return;
    lastDraw = performance.now();
    const now = new Date();
    const hrs = timelineHours(l, now);
    // chart: 6 h either side of now
    const win = hrs.filter((h) => Math.abs(h.t - now) <= 6 * 3600e3 + 1);
    const kind = roomHistory?.length ? "measured" : "simulated";
    const box = els.chart.parentElement.getBoundingClientRect();
    chart = drawCrossover(els.chart, { now, hours: win, roomKind: kind, roomNow: l.stale, aqiNow: l.aqi }, { width: Math.max(320, Math.round(box.width) || 480), height: 196 });
    if (chart) wireHover(chart);
    if (whatIf) chart?.setWhatIf(whatIfPoints(now), whatIfLabel());
    const open = win.filter((h) => !h.past && h.verdict === "open");
    setText(els.chartCap, open.length ? `Shaded: hours when opening the window helps. Next: ${hourLabel(open[0].t)}.` : "No hours in the next six when opening the window would help.");
    // sparklines: the last 24 hours we have
    const past = hrs.filter((h) => h.past).slice(-24);
    drawSpark($("lv-aqi-spark"), past.map((h) => h.aqi), { width: 64, minSpan: 12 });
    drawSpark($("lv-room-spark"), past.map((h) => h.room), { width: 64, minSpan: 12 });
    // ruler: today and tomorrow
    const rw = Math.round(els.ruler.parentElement.getBoundingClientRect().width) || innerWidth;
    ruler = drawRuler(els.ruler, hrs, now, { width: rw });
    const next = hrs.find((h) => !h.past && h.verdict === "open");
    setText(els.rulerCap, `Verdict for each hour of today and tomorrow. ${next ? "Next good hour to open: " + hourLabel(next.t) + "." : "No good hour to open in the forecast."}`);
  }

  const whatIfLabel = () => (whatIf ? (whatIf.raise < 0.005 ? "Room with it shut" : `Room if you open it ${Math.round(whatIf.raise * 100)} cm now`) : "");

  function whatIfPoints(now) {
    if (!whatIf) return null;
    return whatIf.projection.map((room, i) => ({ t: new Date(now.getTime() + i * 1800e3), room }));
  }

  function wireHover(c) {
    const h = c.hover, svg = els.chart;
    let tip = $("lv-tip");
    if (!tip) { tip = document.createElement("div"); tip.id = "lv-tip"; tip.className = "lv-tip"; tip.hidden = true; els.chart.parentElement.appendChild(tip); }
    const move = (e) => {
      const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, px = ((e.clientX - r.left) / r.width) * vb.width;
      let best = h.hours[0];
      for (const hh of h.hours) if (Math.abs(h.x(hh.t.getTime()) - px) < Math.abs(h.x(best.t.getTime()) - px)) best = hh;
      const xx = h.x(best.t.getTime());
      h.line.setAttribute("x1", xx); h.line.setAttribute("x2", xx);
      if (best.aqi != null) { h.a.setAttribute("cx", xx); h.a.setAttribute("cy", h.yA(best.aqi)); }
      if (best.room != null) { h.r.setAttribute("cx", xx); h.r.setAttribute("cy", h.yR(best.room)); }
      h.group.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.textContent = `${hourLabel(best.t)}: AQI ${best.aqi ?? "?"}, room ${best.room != null ? Math.round(best.room) : "?"}${best.verdict ? ". " + LABEL[best.verdict] : ""}`;
      tip.style.left = `${(xx / vb.width) * r.width}px`;
    };
    h.hit.addEventListener("pointermove", move);
    h.hit.addEventListener("pointerleave", () => { h.group.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  // ---------- instruments ----------
  function instruments(l) {
    setText($("lv-aqi"), l.aqi != null ? String(Math.round(l.aqi)) : "–");
    setText($("lv-aqi-cat"), l.pm25 != null ? `${AQI_WORD(l.aqi)}, PM2.5 ${l.pm25.toFixed(1)} µg/m³` : AQI_WORD(l.aqi));
    setText($("lv-room"), l.stale != null ? String(Math.round(l.stale)) : "–");
    setText($("lv-room-k"), l.mode === "device" && !l.mock ? "Room air" : "Room air, simulated");
    setText($("lv-room-s"), l.stale == null ? "" : (l.stale >= 70 ? "Spiking" : l.stale >= 40 ? "Stale" : l.stale >= 25 ? "Getting stale" : "Fresh") + " on the stale index");
    const t = l.transmission;
    setText($("lv-sun"), t != null ? String(t) : l.sunElevation != null && l.sunElevation < 3 ? "Night" : "–");
    setText($("lv-sun-unit"), t != null ? "%" : "");
    setText($("lv-sun-s"), l.aod != null ? `Haze ${l.aod.toFixed(2)} AOD${l.sunElevation >= 3 ? `, sun ${Math.round(l.sunElevation)}° up` : ", sun below the horizon"}` : "");
    setText($("lv-temp"), l.temp != null ? String(f(l.temp)) : "–");
    const w = mph(l.wind);
    setText($("lv-wind"), w != null ? `Wind ${w} mph${l.windFrom ? " from the " + l.windFrom : ""}` : "");
    const arrow = $("lv-wind-arrow");
    // the arrow points where the wind is going (from 225° = blowing toward 45°)
    if (arrow && l.windDir != null) arrow.style.transform = `rotate(${(l.windDir + 180) % 360}deg)`;
  }

  // ---------- why sheet ----------
  function fillWhy(l) {
    els.path.textContent = "";
    const add = (txt, on) => { const li = document.createElement("li"); li.textContent = txt; if (on) li.dataset.fired = "true"; els.path.appendChild(li); };
    const key = verdictKey(l?.verdict);
    const lvl = l?.outdoorLevel;
    add(`Outside is ${lvl === "bad" ? "bad (AQI over 100, PM2.5 over 35.4 or haze over 0.7)" : lvl === "moderate" ? "moderate (AQI 51 to 100)" : lvl === "good" ? "good (AQI 50 or less)" : "unknown"}: AQI ${l?.aqi ?? "?"}, PM2.5 ${l?.pm25 ?? "?"}, haze ${l?.aod ?? "?"}.`, false);
    add("If outside is bad, keep it shut, whatever the room says.", key === "shut");
    add("Otherwise, if the room is spiking (70 or more, or rising fast), ventilate now.", key === "ventilate");
    add("Otherwise, if outside is good, open the window.", key === "open" && lvl === "good");
    add("If outside is moderate and the room is stale (40 or more), open it for a few minutes.", key === "open" && lvl === "moderate");
    add("Anything else: either way.", key === "either");
    setText(els.sheetNote, (l?.reasons || []).length ? `On the device right now: ${l.reasons.join("; ")}.` : "");
  }
  function openSheet(on) {
    els.sheet.hidden = !on;
    els.why.setAttribute("aria-expanded", String(on));
    if (on) { fillWhy(data?.live); $("lv-sheet-close").focus(); } else els.why.focus();
  }
  els.why.addEventListener("click", () => openSheet(els.sheet.hidden));
  $("lv-sheet-close").addEventListener("click", () => openSheet(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.sheet.hidden) openSheet(false); });

  // ---------- read it aloud ----------
  els.read.addEventListener("click", async () => {
    const label = els.read.querySelector(".btn-text");
    let finished = false;
    const done = () => { if (finished) return; finished = true; els.read.disabled = false; label.textContent = "Read it aloud"; sound.readAloud?.(false); };
    els.read.disabled = true; label.textContent = "Reading aloud";
    sound.readAloud?.(true); // the room quiets while the device speaks
    try {
      let rep;
      if (data?.source === "pi") {
        let token = null; try { token = new URLSearchParams(location.search).get("token") || localStorage.getItem("skywindow-token"); } catch { /* */ }
        const r = await fetch("api/report", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-SkyWindow-Token": token } : {}) }, body: "{}" });
        if (!r.ok) throw new Error(r.status === 401 ? "this Pi needs its token" : `the Pi answered ${r.status}`);
        rep = await r.json();
      } else rep = localSky().report(data.raw);
      els.said.hidden = false; setText(els.said, `“${rep.text}”`);
      if (rep.audio_url) { const a = $("lv-audio"); sound.speaker?.(a); a.onended = a.onerror = done; a.src = rep.audio_url; await a.play().catch(done); }
      else if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(rep.text); u.onend = u.onerror = done; speechSynthesis.speak(u); setTimeout(done, 30000);
      } else done();
    } catch (e) { els.said.hidden = false; setText(els.said, `Couldn't read it aloud: ${e.message}.`); done(); }
  });

  els.reset.addEventListener("click", () => document.dispatchEvent(new CustomEvent("skywindow:sash-reset")));

  return {
    attach(c) {
      leaders = createLeaders({ room: c.room, svg: $("lv-leaders"), reduced });
      addEventListener("resize", () => draw(true));
    },
    render(s) {
      data = s;
      root.dataset.liveStatus = s.status;
      els.status.dataset.status = s.status;
      setText(els.statusText, statusLine(s));
      const l = s.live;
      if (!l) {
        delete els.verdict.dataset.v;
        setText(els.verdict, s.status === "error" ? "No reading yet." : "Checking the air.");
        setText(els.reason, s.status === "error" ? "SkyWindow can't reach the Pi or the weather service. It keeps trying." : "Reading the sky over Princeton High School.");
        return;
      }
      const key = verdictKey(l.verdict);
      setText(els.when, l.replay ? `Replaying ${l.replay.label}, ${l.replay.clock}` : `Right now at PHS, ${clockOf(new Date(l.at))}`);
      showVerdict(key, l, s);
      instruments(l);
      leaders?.setData(l, s);
      loadHistory(s);
      draw();
    },
    setWhatIf(w, on) {
      whatIf = on ? w : null;
      els.reset.hidden = !on;
      root.classList.toggle("what-if", !!on);
      if (!w || !on) { setText(els.whatif, ""); chart?.setWhatIf(null); leaders?.setSash(null); return; }
      const cm = Math.round(w.raise * 100);
      let line;
      if (cm === 0) line = "Shut: only the air that leaks in, about 0.3 changes an hour.";
      else if (w.smoky) line = `Open ${cm} cm now and smoke gets in: indoor PM2.5 would reach about ${Math.round(w.pmIn)} µg/m³ in an hour, against ${Math.round(w.pmShut)} shut.`;
      else if (w.minutes === 0) line = `Open ${cm} cm: about ${w.ach.toFixed(1)} air changes an hour. The room is already fresh.`;
      else if (w.minutes == null) line = `Open ${cm} cm: about ${w.ach.toFixed(1)} air changes an hour. Not enough to freshen a full class.`;
      else line = `Open ${cm} cm now and the room is fresh in about ${w.minutes < 90 ? Math.round(w.minutes / 5) * 5 + " minutes" : (w.minutes / 60).toFixed(1).replace(/\.0$/, "") + " hours"}.`;
      setText(els.whatif, line + " Estimate, assuming 21 °C inside.");
      chart?.setWhatIf(whatIfPoints(new Date()), whatIfLabel());
      leaders?.setSash(cm);
    },
    setAssembled(on) { root.dataset.liveAssembled = on ? "true" : "false"; },
    setActive(on) {
      live.inert = !on;
      $("story")?.toggleAttribute("inert", on);
      // drawn already (it lays out while hidden); redrawing here would cost the hand-off's last frame a layout pass
      if (on && !chart) draw(true);
    },
    focusVerdict() { els.verdict.focus({ preventScroll: true }); setText(els.sr, `Live window. ${els.verdict.textContent} ${els.reason.textContent}`); },
    afterRender(dt, time) {
      leaders?.update(dt, time);
      if (data?.status === "ok" && Math.floor(time) !== lastSec) { lastSec = Math.floor(time); setText(els.statusText, statusLine(store.get())); }
    },
    get chart() { return chart; }, get ruler() { return ruler; }, get leaders() { return leaders; },
    els,
  };
}
