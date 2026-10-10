const $ = (id) => document.getElementById(id);
const fmt = (v, d = 0, unit = "") => (v === null || v === undefined ? "–" : Number(v).toFixed(d) + unit);
let latest = null;

async function api(path, body) {
  const opts = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}

// ---- sky background: blue when clean, orange-grey when smoky, navy at night ----
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
function paintSky(sky) {
  const root = document.documentElement.style;
  if (!sky) return;
  const haze = Math.max(0, Math.min(1, Math.max(((sky.aod ?? 0.1) - 0.1) / 0.9, ((sky.us_aqi ?? 0) - 50) / 100)));
  let top = mix("#3b82f6", "#8a5a3c", haze), bottom = mix("#bae6fd", "#f0a050", haze);
  if (sky.is_day === 0) { top = mix("#0b1026", "#3b2a1a", haze); bottom = mix("#312e81", "#6b4426", haze); }
  root.setProperty("--sky-top", top);
  root.setProperty("--sky-bottom", bottom);
  root.setProperty("--sun", mix("#fde047", "#ff5a1f", haze));
  $("sun").style.opacity = sky.is_day === 0 ? 0 : 1 - (sky.cloud_cover ?? 0) / 160;
  document.querySelectorAll(".cloud").forEach((c) => (c.style.opacity = 0.25 + (sky.cloud_cover ?? 30) / 130));
}

function render(s) {
  latest = s;
  const v = s.verdict, sky = s.sky || {}, ind = s.indoor || {}, cl = s.clarity || {};
  document.documentElement.style.setProperty("--verdict", v.color);
  $("verdict-label").textContent = v.label;
  $("reasons").innerHTML = v.reasons.map((r) => `<li>${r}</li>`).join("");
  $("event").textContent = s.event ? `AI event classifier: ${s.event}` : "";

  $("aqi").textContent = fmt(sky.us_aqi);
  $("pm25").textContent = fmt(sky.pm2_5, 1, " µg/m³");
  $("aod").textContent = sky.aod == null ? "–" : `${sky.aod.toFixed(2)} ${sky.aod > 0.7 ? "(smoky!)" : sky.aod > 0.3 ? "(hazy)" : "(clear)"}`;
  $("ozone").textContent = fmt(sky.ozone, 0, " µg/m³");
  $("clouds").textContent = fmt(sky.cloud_cover, 0, "%");
  $("uv").textContent = fmt(sky.uv_index, 1);
  $("haze").textContent = cl.haze_transmission == null ? "night" : fmt(cl.haze_transmission, 0, "%");
  // wind_dir is where wind comes FROM; arrow points where the air is going
  $("wind-arrow").style.transform = `rotate(${((sky.wind_dir ?? 0) + 180) % 360}deg)`;
  $("wind-text").textContent = sky.wind_dir == null ? "–" : `${fmt(sky.wind_speed, 0)} km/h from the ${s.wind_compass}`;

  $("stale").textContent = ind.warming_up ? "…" : fmt(ind.stale_index);
  $("stale-bar").style.width = (ind.stale_index || 0) + "%";
  $("air").textContent = `${fmt(ind.air, 0)} (baseline ${fmt(ind.baseline, 0)})`;
  $("rate").textContent = `${ind.rate_per_min > 0 ? "▲" : ind.rate_per_min < 0 ? "▼" : "•"} ${fmt(Math.abs(ind.rate_per_min), 0)}/min`;
  const clar = cl.sensor_clarity ?? cl.model_clarity;
  $("clarity").textContent = cl.daylight ? `${fmt(clar, 0, "%")} ${cl.sensor_clarity != null ? "(sensor)" : "(satellite/model)"}` : "night";
  $("sun-el").textContent = fmt(cl.sun_elevation, 0, "°");

  const badges = [];
  if (s.replay) badges.push(`<span class="badge replay">REPLAY · ${s.replay.label} · ${s.replay.clock}</span>`);
  if (s.mock) badges.push(`<span class="badge warn">MOCK SENSORS</span>`);
  if (sky.stale) badges.push(`<span class="badge warn">offline · sky data ${fmt(s.sky_age_min, 0)} min old</span>`);
  if (!s.sky) badges.push(`<span class="badge warn">no sky data yet</span>`);
  $("badges").innerHTML = badges.join("");
  $("btn-replay").textContent = s.replay ? "Stop replay" : "Start replay";
  document.querySelectorAll(".mock-only").forEach((e) => (e.hidden = !s.mock));
  $("btn-speak").hidden = !s.voice_enabled;

  if (s.last_report && s.last_report.at !== render.lastReportAt) {
    render.lastReportAt = s.last_report.at;
    showReport(s.last_report, false);
  }
  paintSky(s.sky);
  renderForecast(s.sky);
}

// ---- charts ----
let chart, fchart;
function lineChart(el, datasets, labels) {
  return new Chart(el, {
    type: "line",
    data: { labels, datasets },
    options: { animation: false, responsive: true, interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0 } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  });
}
async function refreshHistory() {
  const h = await api("/api/history?minutes=60");
  const labels = h.map((r) => new Date(r.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const ds = [
    { label: "Room stale index", data: h.map((r) => r.stale_index), borderColor: "#9333ea", tension: 0.3 },
    { label: "Sky AQI", data: h.map((r) => r.us_aqi), borderColor: "#0ea5e9", tension: 0.3 },
  ];
  if (!chart) chart = lineChart($("chart"), ds, labels);
  else { chart.data.labels = labels; chart.data.datasets.forEach((d, i) => (d.data = ds[i].data)); chart.update(); }
}
function renderForecast(sky) {
  if (!sky || !sky.forecast) return;
  const f = sky.forecast, nowKey = (sky.time || "").slice(0, 13);
  let i0 = f.time.findIndex((t) => t.slice(0, 13) >= nowKey); if (i0 < 0) i0 = 0;
  const sl = (a) => a.slice(i0, i0 + 24);
  const key = sl(f.time).join();
  if (renderForecast.key === key) return;
  renderForecast.key = key;
  const labels = sl(f.time).map((t) => t.slice(11, 16));
  const ds = [
    { label: "AQI", data: sl(f.us_aqi), borderColor: "#0ea5e9", tension: 0.3, yAxisID: "y" },
    { label: "Smoke haze (AOD ×100)", data: sl(f.aod).map((x) => (x == null ? null : x * 100)), borderColor: "#ea580c", tension: 0.3, yAxisID: "y" },
    { label: "Clouds %", data: sl(f.cloud_cover), borderColor: "#94a3b8", borderDash: [4, 4], tension: 0.3, yAxisID: "y" },
  ];
  if (fchart) fchart.destroy();
  fchart = lineChart($("forecast"), ds, labels);
}

// ---- report / voice ----
function showReport(rep, autoplay) {
  $("report").textContent = rep.text;
  $("report-engine").textContent = `Written by ${rep.engine}${rep.audio_url ? " · voiced by ElevenLabs" : ""}`;
  const a = $("audio");
  if (rep.audio_url) {
    a.src = rep.audio_url; a.hidden = false;
    if (autoplay) a.play().catch(() => {});
  } else if (autoplay && "speechSynthesis" in window) {
    speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(rep.text)); // fallback voice
  }
}
async function brief(speak) {
  const b = speak ? $("btn-speak") : $("btn-report");
  b.disabled = true;
  try {
    const rep = await api("/api/report", { speak });
    render.lastReportAt = rep.at;
    showReport(rep, !speak);
  } catch (e) { $("report").textContent = "Couldn't get a briefing: " + e.message; }
  b.disabled = false;
}
$("btn-report").onclick = () => brief(false);
$("btn-speak").onclick = () => brief(true);

$("btn-replay").onclick = async () => {
  try { await api("/api/replay", { on: !(latest && latest.replay) }); poll(); }
  catch (e) { alert(e.message); }
};
document.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = async () => {
  try { const r = await api("/api/calibrate", { what: b.dataset.cal }); b.textContent = "✓ " + JSON.stringify(r); }
  catch (e) { alert(e.message); }
}));
document.querySelectorAll("[data-label]").forEach((b) => (b.onclick = async () => {
  await api("/api/label", { label: b.dataset.label });
  b.dataset.n = (+b.dataset.n || 0) + 1; b.textContent = `${b.dataset.label} (${b.dataset.n})`;
}));
document.querySelectorAll("[data-mock]").forEach((b) => (b.onclick = () => api("/api/mock/" + b.dataset.mock, {})));

async function poll() {
  try { render(await api("/api/now")); } catch (e) { $("verdict-label").textContent = "Connecting…"; }
}
poll(); setInterval(poll, 2000);
refreshHistory().catch(() => {}); setInterval(() => refreshHistory().catch(() => {}), 30000);
