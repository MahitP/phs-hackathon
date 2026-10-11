// SkyWindow dashboard, "The Window". The page is a classroom sash window: the panes show what is
// outside (a sky rendered from live data, the campus map or the globe), the meeting rail holds the
// verdict, and the verdict sets how far the lower sash is raised and how wide the word is set.
// Data comes from the Raspberry Pi's API when the device serves this page, or straight from
// Open-Meteo in showcase mode (sky-local.js), in the same shape.
const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const NO_DATA = "No data";
const fmt = (v, d = 0, unit = "") => (v === null || v === undefined || Number.isNaN(v) ? NO_DATA : Number(v).toFixed(d) + unit);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const isPhone = () => innerWidth <= 640;
let latest = null, serverMode = false, activeTab = "now", replayData = null, explored = null;

// Optional write token (SKYWINDOW_TOKEN on the server): open the dashboard once as /app.html?token=..., it's remembered.
let TOKEN = new URLSearchParams(location.search).get("token");
try { if (TOKEN) localStorage.setItem("skywindow-token", TOKEN); else TOKEN = localStorage.getItem("skywindow-token"); } catch (e) {}

// ---------- data source: the Pi's API, or showcase mode straight from Open-Meteo ----------
async function api(path, body) {
  const headers = { "Content-Type": "application/json", ...(TOKEN ? { "X-SkyWindow-Token": TOKEN } : {}) };
  const opts = body === undefined ? {} : { method: "POST", headers, body: JSON.stringify(body) };
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
}
async function detectServer() {
  try { const r = await fetch("api/now"); serverMode = r.ok || r.status === 503; } catch { serverMode = false; }
}
async function getState() { return serverMode ? api("api/now") : LocalSky.state(); }

function hazeOf(sky) {
  if (!sky) return 0;
  return Math.max(0, Math.min(1, Math.max(((sky.aod ?? 0.1) - 0.1) / 0.9, ((sky.us_aqi ?? 0) - 50) / 100)));
}

// ---------- words, colors and times ----------
// Verdict labels for the page (the server and the LCD keep their own all-caps strings).
const VERDICT = {
  open: { label: "Open the window.", color: "#0B7643", stretch: 125, weight: 720, gap: 84, gapPhone: 48 },
  either: { label: "Either way.", color: "#825B0C", stretch: 94, weight: 720, gap: 30, gapPhone: 22 },
  shut: { label: "Keep it shut.", color: "#AC3227", stretch: 62, weight: 760, gap: 0, gapPhone: 0 },
  ventilate: { label: "Ventilate now.", color: "#7D45A2", stretch: 112, weight: 720, gap: 120, gapPhone: 70 },
  warmup: { label: "Warming up.", color: "#5B636B", stretch: 100, weight: 680, gap: 0, gapPhone: 0 },
};
const verdictOf = (key) => VERDICT[key] || VERDICT.either;
const EPA_NAMES = ["Good", "Moderate", "Unhealthy for sensitive groups", "Unhealthy", "Very unhealthy", "Hazardous"];
const EPA_FILL = ["#4AA969", "#E5C14A", "#E48233", "#C44134", "#733893", "#6A1D30"]; // data bars and dots
const EPA_TEXT = ["#0B7643", "#825B0C", "#9B4805", "#AC3227", "#7D45A2", "#6A1D30"]; // text, 5:1 on the frame
function catOf(aqi) {
  const lvl = LocalSky.aqiCategory(aqi).level;
  return { level: lvl, name: lvl >= 0 ? EPA_NAMES[lvl] : NO_DATA, lower: lvl >= 0 ? EPA_NAMES[lvl].toLowerCase() : "no data",
    fill: EPA_FILL[lvl] || "#5B636B", text: EPA_TEXT[lvl] || "#5B636B" };
}
const CAUSES = { "DESERT DUST": "desert dust", "SMOKE / HAZE": "smoke or haze", "FINE PARTICLES": "fine particles", "OZONE SMOG": "ozone smog" };
const causeOf = (s) => CAUSES[LocalSky.likelyCause(s || {})] || null;
const WIND_WORDS = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest" };
const windPhrase = (speed, code) => (speed == null ? NO_DATA : `${Math.round(speed)} km/h${WIND_WORDS[code] ? " from the " + WIND_WORDS[code] : ""}`);
const aodWord = (a) => (a > 0.7 ? "smoky" : a > 0.3 ? "hazy" : "clear");
const sunPhrase = (el) => (el == null ? "position unknown" : el >= 0 ? `${Math.round(el)}° up` : `${Math.round(-el)}° below the horizon`);
const PHS_TZ = "America/New_York";
const ampm = (s) => s.replace(/\s?([AP])M$/, (_, x) => " " + x.toLowerCase() + "m");
const clockText = (d = new Date()) => ampm(d.toLocaleTimeString("en-US", { timeZone: PHS_TZ, hour: "numeric", minute: "2-digit" }));
function hourLabel(hhmm, minutes = false) { // "17:00" -> "5 pm"
  const [h, m] = hhmm.split(":").map(Number);
  if (!minutes && !m && h === 12) return "noon";
  if (!minutes && !m && h === 0) return "midnight";
  return `${h % 12 || 12}${minutes || m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
}
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function weatherText(code) { const t = LocalSky.describeWeather(code).text; return t === "–" ? NO_DATA : t; }
// Times in the data are PHS local times ("2026-10-10T22:00"); this turns one into a real Date.
function tzOffsetMin(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: PHS_TZ, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - date.getTime()) / 60000;
}
function phsDate(localIso) { const guess = new Date(localIso.slice(0, 16) + "Z"); return new Date(guess.getTime() - tzOffsetMin(guess) * 60000); }
const phsDay = (d) => d.toLocaleDateString("en-CA", { timeZone: PHS_TZ }); // "2026-10-10"
const weekday = (isoDate) => new Date(isoDate + "T12:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
const ICON = {
  fire: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M10 2.75c.5 3-3.75 4.5-3.75 8.5a3.75 3.75 0 0 0 7.5 0c0-1.75-1-2.75-1.5-3.75-.25 1.5-1 2-1.75 2.25.5-2.5-.25-5-.5-7z"/></svg>',
  play: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M6 4.5v11l9-5.5z"/></svg>',
  stop: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5.5" y="5.5" width="9" height="9"/></svg>',
};

// ---------- the sky in the panes, rendered from real data ----------
// Four inputs: where the sun is over PHS, how much smoke and haze is in the air (aerosol optical
// depth), cloud cover and time of day. A clean noon comes out blue, haze washes it pale, thick smoke
// turns it orange, night is dark.
const PAL = {
  clear: ["#2A5CAB", "#3F74C0", "#6F9BD3", "#B6CEE8"],
  hazy: ["#7D93AE", "#9DAFC2", "#C5CFD6", "#D9DCDA"],
  overcast: ["#858D96", "#9EA4AA", "#B6BABC", "#C2C4C4"],
  twilight: ["#1E2D4E", "#3D5684", "#9A8FA2", "#D9A27E"],
  dusk: ["#3B4453", "#545D6C", "#7A7F87", "#8D8C8C"],
  night: ["#0F131A", "#171C25", "#262729", "#3A342F"],
  smokeHigh: ["#8C7550", "#A88A5A", "#C9A46A", "#D9B57C"],
  smokeLow: ["#5A3720", "#87502A", "#BD7134", "#DC9D5A"],
  smokeDawn: ["#3D2A20", "#6A3E25", "#A3582B", "#C4703A"],
  smokeDusk: ["#1E1612", "#3A2418", "#6B3A20", "#82441F"],
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const palMix = (p, q, t) => { t = clamp(t); return p.map((c, i) => { const a = rgb(c), b = rgb(q[i]); return hexOf(a.map((v, k) => v + (b[k] - v) * t)); }); };
const luminance = (h) => { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function skyLook({ el, aod, cloud, smoke = false, hour = 12 }) {
  el = el ?? -20; aod = aod ?? 0.1;
  const c = clamp((cloud ?? 0) / 100), sinEl = Math.sin(Math.max(el, 1) * Math.PI / 180);
  const tau = aod / sinEl; // slant optical depth: how much haze the sunlight crosses on its way here
  let pal;
  if (smoke) {
    if (el > 2) pal = tau <= 1.25 ? PAL.smokeHigh : tau <= 2.4 ? palMix(PAL.smokeHigh, PAL.smokeLow, (tau - 1.25) / 1.15)
      : tau <= 4 ? palMix(PAL.smokeLow, PAL.smokeDawn, (tau - 2.4) / 1.6) : palMix(PAL.smokeDawn, PAL.smokeDusk, (tau - 4) / 8);
    else pal = palMix(PAL.night, PAL.smokeDusk, (el + 8) / 10);
  } else {
    let day = palMix(PAL.clear, PAL.hazy, (aod - 0.12) / 0.55);
    day = palMix(day, PAL.overcast, c * 0.9);
    const twi = palMix(PAL.twilight, PAL.dusk, c);
    pal = el >= 8 ? day : el >= 0 ? palMix(twi, day, el / 8) : el >= -8 ? palMix(PAL.night, twi, (el + 8) / 8) : PAL.night;
  }
  let glow = null;
  if (el > -1.5 && c < 0.85) { // the sun: low and to the east in the morning, west in the afternoon
    const x = (clamp(0.5 + (hour - 12.8) / 7 * 0.42, 0.08, 0.92) * 100).toFixed(1);
    const y = (14 + (1 - clamp(el, 0, 70) / 70) * 30).toFixed(1), k = (1 - c).toFixed(2);
    if (smoke && tau > 1.6) glow = `radial-gradient(circle at ${x}% ${y}%, rgba(255,196,136,${k}) 0, rgba(255,182,118,${k}) 1.15%, rgba(255,160,90,${(0.35 * k).toFixed(2)}) 1.6%, rgba(255,150,80,${(0.12 * k).toFixed(2)}) 5%, rgba(255,150,80,0) 12%)`;
    else if (smoke) glow = `radial-gradient(circle at ${x}% ${y}%, rgba(255,240,194,${k}) 0, rgba(255,230,168,${k}) 1.2%, rgba(255,222,150,${(0.45 * k).toFixed(2)}) 2.6%, rgba(255,222,150,0) 14%)`;
    else if (el < 8) glow = `radial-gradient(circle at ${x}% ${y}%, rgba(255,236,200,${k}) 0, rgba(255,226,180,${k}) 1%, rgba(255,214,160,${(0.4 * k).toFixed(2)}) 3%, rgba(255,214,160,0) 16%)`;
    else glow = `radial-gradient(circle at ${x}% ${y}%, rgba(255,253,244,${k}) 0, rgba(255,251,234,${k}) .9%, rgba(255,248,226,${(0.55 * k).toFixed(2)}) 2.6%, rgba(255,248,226,0) 13%)`;
  }
  const ground = el < 2 ? "radial-gradient(120% 60% at 50% 115%, rgba(150,118,86,.30) 0%, rgba(150,118,86,0) 62%)" : null;
  return { pal, glow, ground, el, light: luminance(palMix([pal[2]], [pal[3]], 0.5)[0]) > 0.42 };
}
const skyGradient = (look) => `linear-gradient(180deg, ${look.pal[0]} 0%, ${look.pal[1]} 30%, ${look.pal[2]} 62%, ${look.pal[3]} 100%)`;
const skyBackground = (look, extra = []) => [...extra, look.glow, look.ground, skyGradient(look)].filter(Boolean).join(", ");

let skyFront = 0, skyShown = "";
function setSky(look) { // cross-fades the full-viewport sky behind the frame
  const bg = skyBackground(look);
  $("hud").style.setProperty("--gap-ink", look.light ? "#1C2024" : "rgba(255,255,255,.9)");
  if (bg === skyShown) return;
  skyShown = bg;
  const layers = [$("sky-a"), $("sky-b")], next = layers[1 - skyFront];
  next.style.backgroundImage = bg;
  next.classList.add("on"); layers[skyFront].classList.remove("on");
  skyFront = 1 - skyFront;
}
function liveLook(s) {
  const sky = s.sky || {}, cl = s.clarity || {};
  const hour = s.replay ? +s.replay.clock.slice(0, 2) : sky.time ? +sky.time.slice(11, 13) + (+sky.time.slice(14, 16) || 0) / 60 : 12;
  const el = cl.sun_elevation ?? (sky.is_day === 0 ? -20 : 30);
  return skyLook({ el: Math.round(el), aod: sky.aod, cloud: sky.cloud_cover, smoke: !!s.replay || (sky.aod ?? 0) > 0.7, hour });
}
function skyWords(sky) {
  let t = weatherText(sky.weather_code);
  t = t === NO_DATA ? (sky.cloud_cover > 85 ? "overcast" : sky.cloud_cover > 40 ? "partly cloudy" : "clear") : t === "Clear sky" ? "clear" : t.toLowerCase();
  if (sky.aod > 0.7) t += ", heavy haze"; else if (sky.aod > 0.3) t += ", hazy";
  return t;
}

// ---------- captions on frame-white plates over the panes ----------
const caps = {};
function paintCaps() {
  const list = caps[activeTab] || [];
  [$("cap-0"), $("cap-1"), $("cap-2")].forEach((el, i) => setText(el, list[i] || ""));
}
function setCaps(view, list) { caps[view] = list; if (activeTab === view) paintCaps(); }

// ---------- the verdict and the sash ----------
let shownKey = null, sashKey = null;
function setVerdict(key) {
  const st = verdictOf(key), el = $("verdict-label");
  document.body.dataset.verdict = key;
  document.documentElement.style.setProperty("--verdict", st.color);
  if (key === shownKey) return;
  const from = shownKey ? verdictOf(shownKey) : { stretch: 100, weight: 680 };
  shownKey = key;
  el.setAttribute("aria-label", st.label);
  // letter by letter, so the word can widen or narrow one character at a time; words never break inside
  const chars = [], span = (cls, text) => { const x = document.createElement("span"); x.className = cls; if (text) x.textContent = text; return x; };
  el.replaceChildren();
  st.label.split(" ").forEach((word, i) => {
    if (i) { const gap = span("ch", " "); gap.setAttribute("aria-hidden", "true"); chars.push(gap); el.append(gap); }
    const w = span("w");
    w.setAttribute("aria-hidden", "true");
    for (const c of word) { const ch = span("ch", c); chars.push(ch); w.append(ch); }
    el.append(w);
  });
  if (reduceMotion) chars.forEach((c) => { c.style.setProperty("--w", st.stretch); c.style.setProperty("--wt", st.weight); });
  else gsap.fromTo(chars, { "--w": from.stretch, "--wt": from.weight }, { "--w": st.stretch, "--wt": st.weight, duration: 0.9, stagger: 0.02, ease: "power3.out" });
}
function moveSash(key, instant = false) {
  const st = verdictOf(key), h = isPhone() ? st.gapPhone : st.gap, gap = $("sash-gap");
  if (key === sashKey && !instant) return;
  sashKey = key;
  $("hud").style.setProperty("--wind-o", h ? 0.85 : 0);
  if (instant || reduceMotion) { gsap.killTweensOf(gap); gap.style.height = h + "px"; }
  else gsap.to(gap, { height: h, duration: 1.1, ease: "power2.inOut", overwrite: true });
}
function windStreaks(speed, dir) {
  const hud = $("hud").style;
  hud.setProperty("--wind-s", clamp(36 / ((speed || 0) + 3), 2.5, 12).toFixed(1) + "s");
  hud.setProperty("--wind-dx", (dir != null && dir < 180 ? -1 : 1) * 30 + "px"); // air from the east moves west
  $("wind-pattern").setAttribute("patternTransform", `rotate(${((dir ?? 90) - 90).toFixed(0)})`);
}

// ---------- tabs: two rulers, distance and time, acting as one tab list ----------
const DIST_POS = { now: "now", local: "local", explore: "explore", replay: "now", sky: "now" };
const TIME_POS = { now: "now", local: "now", explore: "now", replay: "replay", sky: "sky" };
const HASH = { now: "now", local: "campus", explore: "earth", sky: "forecast", replay: "2023", system: "how" };
document.querySelectorAll("[role=tab]").forEach((b) => (b.onclick = () => selectTab(b.dataset.tab)));
function updateRulers(name) {
  document.querySelectorAll(".ruler").forEach((r) => {
    const pos = (r.dataset.ruler === "distance" ? DIST_POS : TIME_POS)[name];
    r.querySelectorAll("[role=tab]").forEach((b) => { const at = b.dataset.tab === pos; b.classList.toggle("at", at); b.tabIndex = at ? 0 : -1; });
    if (!pos) r.querySelector("[role=tab]").tabIndex = 0;
  });
}
document.querySelectorAll(".ruler-tabs").forEach((group) => group.addEventListener("keydown", (e) => {
  const list = [...group.querySelectorAll("[role=tab]")], i = list.indexOf(document.activeElement);
  if (i < 0) return;
  let j = null;
  if (e.key === "ArrowRight") j = (i + 1) % list.length;
  else if (e.key === "ArrowLeft") j = (i - 1 + list.length) % list.length;
  else if (e.key === "Home") j = 0;
  else if (e.key === "End") j = list.length - 1;
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") { // hop to the other ruler
    const other = [...document.querySelectorAll(".ruler-tabs")].find((g) => g !== group);
    const t = other && (other.querySelector(".at") || other.querySelector("[role=tab]"));
    if (t) { e.preventDefault(); t.focus(); }
    return;
  }
  if (j === null) return;
  e.preventDefault();
  list[j].focus();
  selectTab(list[j].dataset.tab);
}));

function selectTab(name, first = false) {
  const prev = activeTab;
  activeTab = name;
  document.body.dataset.screen = name;
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  updateRulers(name);
  let shown = null;
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; if (!p.hidden) shown = p; });
  if (shown && !first && !reduceMotion) gsap.fromTo(shown, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out", clearProps: "opacity,transform" });
  if (prev === "sky" && name !== "sky") clearPaneSkies();
  if (!selectTab.keepView) showScene(name);
  selectTab.keepView = false;
  if (name === "replay") loadReplay();
  if (name !== "explore" && explored) { explored = null; if (globeState === "ready") { Globe.hidePin(); Globe.flyTo(Globe.HOME.lat, Globe.HOME.lon); } }
  if (name === "sky") { renderForecast.key = null; renderForecast(latest && latest.sky); refreshHistory(); }
  if (name !== "replay" && name !== "explore" && latest) { applySky(latest); moveSash(latest.verdict.key); }
  updateStoryBanner();
  paintCaps();
  if (!first && history.replaceState) history.replaceState(null, "", "#" + HASH[name]);
  if (name === "system" && !first) scrollTo({ top: 0 });
}

// ---------- what the panes show: the live sky, the campus map or the globe ----------
const SCENES = { now: "sky", local: "map", explore: "globe", sky: "none", replay: "sky", system: "none" };
let mapView = "school";
function showScene(name) {
  const scene = SCENES[name] || "sky";
  document.body.dataset.scene = scene;
  $("sky").classList.toggle("on", scene === "sky");
  $("localmap").classList.toggle("on", scene === "map");
  $("globe").classList.toggle("on", scene === "globe");
  paneBox = boxKey();
  if (scene === "map") {
    LocalMap.init($("localmap"));
    layoutScene();
    LocalMap.invalidate();
    LocalMap.view(mapView, !reduceMotion);
    loadFires();
  }
  if (globeState === "ready") Globe.setActive(scene === "globe");
  if (scene === "globe" && ensureGlobe()) { frameGlobe(2.6); if (!explored) Globe.flyTo(Globe.HOME.lat, Globe.HOME.lon, reduceMotion ? 0 : 2.6); }
}

// The globe is built once, after the first reading, so the Earth view opens instantly later.
let globeState = "off", worldList = null;
function ensureGlobe() {
  if (globeState !== "off") return globeState === "ready";
  try {
    if (typeof THREE === "undefined") throw new Error("three.js did not load");
    Globe.init($("globe"));
    globeState = "ready";
    Globe.setActive(activeTab === "explore");
    if (worldList) Globe.setCities(worldList);
    if (latest) applySky(latest);
  } catch (e) {
    globeState = "failed";
    console.warn("Globe unavailable:", e.message);
  }
  setCaps("explore", [earthCaption()]);
  return globeState === "ready";
}
const earthCaption = () => (globeState === "failed" ? "The 3D globe needs WebGL, which this browser has turned off. The city numbers still work."
  : "Drag to turn the globe. Tap anywhere to compare it with PHS.");

// Where the panes are, so the map and the globe line up with them (measured at the top of the page).
function layoutScene() {
  const host = $("upper-panes"), box = host.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const top = box.top + scrollY, bottom = top + box.height, W = innerWidth, H = innerHeight;
  const panes = [...host.children].filter((p) => p.classList.contains("pane") && p.offsetWidth);
  const f = (panes[1] || host).getBoundingClientRect(); // the middle pane, or the right one on phones
  const focus = { left: f.left, right: f.right, width: f.width, top: f.top + scrollY, height: f.height };
  const m = $("localmap").style;
  m.setProperty("--map-t", top + "px"); m.setProperty("--map-l", box.left + "px");
  m.setProperty("--map-r", Math.max(0, W - box.right) + "px"); m.setProperty("--map-b", Math.max(0, H - bottom) + "px");
  // phones: one pane is the focus, and PHS sits low in it so the marker's label fits above it
  const area = panes.length >= 3 ? { left: box.left, right: box.right, top, bottom } : { ...focus, top: focus.top + focus.height * 0.4, bottom: focus.top + focus.height };
  LocalMap.setPadding([area.left, area.top], [Math.max(0, W - area.right), Math.max(0, H - area.bottom)]);
  return { box, top, focus };
}
function frameGlobe(duration = 0) {
  if (globeState !== "ready") return;
  const L = layoutScene();
  if (!L) return;
  const r = clamp(Math.min(L.box.height * 1.05, innerWidth * (innerWidth < 700 ? 0.55 : 0.3)), 120, 420);
  Globe.frameAt(L.focus.left + L.focus.width / 2, L.top + L.box.height * 0.78, r, duration);
}
// Re-fit only when the panes really moved (a banner came or went, the window was resized), so a
// layout pass never cuts short the sash, the globe flight or the map's fly-in.
let resizeTimer = null, paneBox = "", phoneLayout = isPhone();
function boxKey() { const b = $("upper-panes").getBoundingClientRect(); return [b.left, b.top + scrollY, b.width, b.height].map(Math.round).join(); }
function onLayoutChange() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (isPhone() !== phoneLayout) { phoneLayout = isPhone(); if (sashKey) moveSash(sashKey, true); }
    const key = boxKey();
    if (key === paneBox) return;
    paneBox = key;
    layoutScene();
    if (activeTab === "explore") frameGlobe(0);
    if (activeTab === "local") LocalMap.view(mapView, false);
  }, 150);
}
addEventListener("resize", onLayoutChange);
if ("ResizeObserver" in window) {
  new ResizeObserver(() => document.documentElement.style.setProperty("--banner-h", $("banners").offsetHeight + "px")).observe($("banners"));
  new ResizeObserver(onLayoutChange).observe($("upper-panes"));
}

// ---------- live render ----------
function applySky(s) {
  const sky = s.sky || {}, haze = hazeOf(sky);
  setSky(liveLook(s));
  windStreaks(sky.wind_speed, sky.wind_dir);
  if (globeState === "ready") {
    Globe.setSky({ haze, wind: sky.wind_speed, night: sky.is_day === 0, cloud: sky.cloud_cover });
    // EARTH is global context, so the PHS beacon shows its AQI category there, not the classroom verdict
    Globe.setVerdictColor(activeTab === "explore" ? catOf(sky.us_aqi).fill : verdictOf(s.verdict.key).color);
  }
  SkyAudio.setSky({ wind: sky.wind_speed, haze });
}

function reasonFor(s, key, cat) {
  const sky = s.sky || {}, ind = s.indoor || {}, idx = ind.stale_index ?? 0, level = s.verdict.outdoor_level;
  const purifier = "If it gets stuffy, run a purifier or a fan instead of opening the window.";
  switch (key) {
    case "open":
      if (level === "moderate") return "The room is staler than the moderate air outside. Air it out for a few minutes.";
      return idx >= 25 ? "The sky is cleaner than the room. Let it in." : "The sky is clean and fresher than the room. Let it in.";
    case "either":
      if (s.fires && s.fires.smoke_risk && level === "good") return "The air is clean right now, but fires upwind could send smoke this way. Watch the verdict before opening.";
      if (level === "moderate") return "The air outside is moderate and the room is fresh, so opening the window makes little difference right now.";
      return "There is no reading of the sky yet, and the room is fine as it is.";
    case "shut": {
      const spike = (s.verdict.reasons || []).some((r) => /spike/i.test(r)); // the engine's own call
      const smoky = (sky.aod ?? 0) > 0.7 && !(sky.us_aqi > 100);
      const what = s.replay ? "Wildfire smoke is overhead and the air outside is worse than the room."
        : smoky ? "Thick smoke or haze is overhead, so the air outside is worse than the room."
        : `The air outside is ${cat.lower} (AQI ${sky.us_aqi}), worse than the room.`;
      return what + " " + (spike ? "The room spiked too, so run a purifier or a fan instead of opening the window." : purifier);
    }
    case "ventilate": return "The room just spiked. Open up until the stale index drops.";
    case "warmup": return "The air sensor is warming up. That takes about two minutes.";
  }
  return "";
}
function hintFor(s, key) {
  const sky = s.sky || {}, level = s.verdict.outdoor_level;
  if (key === "open") return level === "moderate" ? "Turns to Either way once the room is fresh again." : "Turns to Either way if the AQI passes 50.";
  if (key === "either") return s.fires && s.fires.smoke_risk && level === "good" ? "Goes back to Open when the fires upwind die down or the wind turns."
    : "Turns to Open if the room gets stale, or to Keep it shut if the AQI passes 100.";
  if (key === "shut") return sky.us_aqi > 100 ? "Stays shut until the AQI drops below 95." : sky.pm2_5 > 35.4 ? "Stays shut until PM2.5 drops below 32."
    : "Stays shut until the haze clears.";
  if (key === "ventilate") return "Goes back once the stale index drops below 60.";
  return "";
}
function rateText(r) {
  r = Math.round(r || 0);
  return Math.abs(r) < 1 ? "Steady" : `${r > 0 ? "Rising" : "Falling"}, ${Math.abs(r)} a minute`;
}
function setNum(el, value) { // big readout numbers: no dashes, a short word when there is nothing
  setText(el, value == null || value === "" || Number.isNaN(value) ? "None" : String(value));
}

function render(s) {
  latest = s;
  lastOk = Date.now();
  const v = s.verdict, key = v.key, sky = s.sky || {}, ind = s.indoor || {}, cl = s.clarity || {};
  const st = verdictOf(key), cat = catOf(sky.us_aqi), w = weatherText(sky.weather_code);
  const body = document.body.classList;
  body.remove("is-loading");
  body.toggle("is-error", !s.sky);
  body.toggle("is-stale", !!sky.stale);
  if (!s.sky) setText($("err-text"), "The SkyWindow device hasn't reached Open-Meteo yet. It tries again every minute.");
  const updated = new Date(Date.now() - (s.sky_age_min || 0) * 60000);

  setVerdict(key);
  if (activeTab !== "replay") moveSash(key);
  setText($("reasons"), reasonFor(s, key, cat));
  setText($("verdict-hint"), sky.stale ? `As of ${clockText(updated)}. Check again before opening the window.` : hintFor(s, key));
  setText($("event"), s.event ? `Indoor event classifier: ${s.event}.` : "");

  // status in the head rail
  $("status-dot").className = "dot" + (s.replay ? " replay" : !s.sky ? " error" : sky.stale ? "" : " live");
  setText($("mode-chip"), s.replay ? (serverMode ? "Device replay running" : "Replay running") : !s.sky ? "Sky data didn't load" : sky.stale ? ""
    : serverMode ? (s.mock ? "Live sky, simulated sensors." : "Live sky, live room.") : "Live sky, simulated room.");
  $("clock").innerHTML = s.replay || !s.sky ? "" : `<span class="m-hide">${sky.stale ? "Last updated" : "Updated"} </span>${clockText(updated)}`;
  renderConnection(sky.stale ? s.sky_age_min : null);

  // the sill
  setNum($("aqi"), sky.us_aqi);
  setText($("aqi-cat"), cat.name);
  $("aqi-cat").style.setProperty("--c", cat.text);
  setNum($("stale"), ind.warming_up ? "Not yet" : ind.stale_index);
  $("stale-bar").style.width = (ind.stale_index || 0) + "%";
  setNum($("sill-temp"), sky.temperature == null ? null : Math.round(sky.temperature) + "°");
  setText($("sill-cond"), s.replay ? "Wildfire smoke" : w);
  setText($("sill-feels"), upperFirst([sky.feels_like == null ? "" : `feels like ${Math.round(sky.feels_like)}°C`,
    sky.is_day && sky.uv_index >= 1 ? `UV ${sky.uv_index.toFixed(1)}` : ""].filter(Boolean).join(", ")));

  // the readings below the window
  setText($("readings-when"), s.replay ? "this" : sky.is_day === 0 ? "tonight's" : "today's");
  setText($("d-aqi"), sky.us_aqi == null ? NO_DATA : `${sky.us_aqi}, ${cat.lower}`);
  setText($("pm25"), fmt(sky.pm2_5, 1, " µg/m³"));
  setText($("aod"), sky.aod == null ? NO_DATA : `${sky.aod.toFixed(2)}, ${aodWord(sky.aod)}`);
  setText($("haze"), !cl.daylight ? "Sun is down" : fmt(cl.haze_transmission, 0, "%"));
  setText($("wind-text"), windPhrase(sky.wind_speed, s.wind_compass));
  setText($("d-stale"), ind.warming_up ? "Warming up" : `${fmt(ind.stale_index)} of 100`);
  setText($("rate"), rateText(ind.rate_per_min));
  setText($("air"), ind.air == null ? "Simulated" : `${fmt(ind.air, 0)}, baseline ${fmt(ind.baseline, 0)}`);
  // During replay the server drops model_clarity (2023 model sunlight ignores the smoke) -> show haze instead
  const [clar, src] = cl.sensor_clarity != null ? [cl.sensor_clarity, "from the sensor"]
    : cl.model_clarity != null ? [cl.model_clarity, "model estimate"] : [cl.haze_transmission, "through the haze"];
  setText($("clarity"), cl.daylight ? `${fmt(clar, 0, "%")}, ${src}` : "Dark outside");
  setText($("room-note"), !serverMode ? "This page is in showcase mode, so the room sensor is simulated. On the Raspberry Pi at PHS these come from the Grove sensors."
    : s.mock ? "The device is running with simulated sensors." : "");
  setText($("wx-cond"), w);
  setText($("wx-temp"), sky.temperature == null ? NO_DATA : `${Math.round(sky.temperature)}°C` + (sky.feels_like == null ? "" : `, feels like ${Math.round(sky.feels_like)}°C`));
  setText($("wx-hum"), fmt(sky.humidity, 0, "%"));
  setText($("wx-wind"), sky.wind_speed == null ? NO_DATA : `${Math.round(sky.wind_speed)} and ${fmt(sky.wind_gusts, 0)} km/h`);
  setText($("wx-rain"), fmt(sky.precipitation, 1, " mm"));
  renderFireLine(s.fires);

  // CAMPUS: the Raspberry Pi inside the school vs the air outside
  setText($("pi-label"), s.mock ? "Inside, simulated sensor" : "Inside, the Raspberry Pi");
  setText($("local-scope"), !serverMode ? "No device in showcase mode, so this is simulated." : s.mock ? "The device is using simulated sensors." : "Live from the Grove sensors.");
  setText($("pi-stale"), ind.warming_up ? "Warming up" : fmt(ind.stale_index));
  setText($("pi-trend"), rateText(ind.rate_per_min).toLowerCase());
  setText($("pi-air"), ind.air == null ? "Simulated" : `${fmt(ind.air, 0)}, baseline ${fmt(ind.baseline, 0)}`);
  setText($("pi-light"), fmt(ind.light, 0));
  setText($("pi-status"), !serverMode ? "No device, showcase mode" : ind.warming_up ? "Warming up" : s.mock ? "Simulated sensors" : "Live");
  setText($("po-aqi"), fmt(sky.us_aqi));
  setText($("po-cat"), cat.lower);
  $("po-cat").style.setProperty("--c", cat.text);
  setText($("po-wx"), `${w}, ${fmt(sky.temperature, 0, "°C")}.`);
  $("po-wind").innerHTML = sky.wind_speed == null ? NO_DATA
    : `<b class="tabnum">${Math.round(sky.wind_speed)}</b> km/h${WIND_WORDS[s.wind_compass] ? " from the " + WIND_WORDS[s.wind_compass] : ""}` + (sky.wind_gusts != null ? `, gusts to ${Math.round(sky.wind_gusts)}.` : ".");
  LocalMap.updateDevice({ color: st.color, verdict: st.label.replace(/\.$/, ""), mock: s.mock || !serverMode,
    inside: ind.warming_up ? "warming up" : fmt(ind.stale_index), aqi: fmt(sky.us_aqi), cat: cat.lower, catColor: cat.text,
    weather: sky.temperature == null ? "" : `${Math.round(sky.temperature)}°C` });
  if (!localPickCaption) setCaps("local", [campusWindCaption(sky, s.wind_compass)]);

  // NEXT 24 HOURS: values beside the chart, and the sky right now
  setText($("ozone"), fmt(sky.ozone, 0, " µg/m³"));
  setText($("clouds"), fmt(sky.cloud_cover, 0, "%"));
  setText($("uv"), fmt(sky.uv_index, 1));
  setText($("sun-el"), cl.sun_elevation == null ? NO_DATA : upperFirst(sunPhrase(cl.sun_elevation)));
  setText($("clear-sky"), fmt(cl.clear_sky_wm2, 0, " W/m²"));
  setText($("temp"), fmt(sky.temperature, 1, " °C"));
  setText($("wind-big"), sky.wind_speed == null ? NO_DATA : `${Math.round(sky.wind_speed)} km/h`);
  setText($("wind-note"), WIND_WORDS[s.wind_compass] ? `From the ${WIND_WORDS[s.wind_compass]} now. Smoke travels with the wind.` : "Smoke travels with the wind.");
  $("wind-arrow").style.transform = `rotate(${((sky.wind_dir ?? 0) + 180) % 360}deg)`;

  // banners, buttons, device-only controls
  renderBanners(s, sky, cat);
  document.querySelectorAll(".server-only").forEach((e) => (e.hidden = !serverMode));
  document.querySelectorAll(".mock-only").forEach((e) => (e.hidden = !s.mock));
  document.querySelectorAll(".showcase-only").forEach((e) => (e.hidden = serverMode));
  const rb = $("btn-replay"), rlabel = s.replay ? "Stop replay" : serverMode ? "Play it on the device" : "Play the day";
  if (rb.dataset.state !== rlabel) { rb.dataset.state = rlabel; rb.innerHTML = (s.replay ? ICON.stop : ICON.play) + `<span class="btn-text">${rlabel}</span>`; }
  setText($("replay-note"), serverMode ? "The LCD at PHS replays the day from 8 am, about a minute in all." : "Plays the day from 8 am in about a minute, right here in the window.");
  setText($("replay-status"), s.replay ? `Playing ${hourLabel(s.replay.clock, true)}, hour ${s.replay.index + 1} of ${s.replay.total}.` : "");

  if ((activeTab !== "replay" || s.replay) && !explored) applySky(s);
  if (activeTab === "replay" && s.replay && replayData && +$("scrub").value !== s.replay.index) { $("scrub").value = s.replay.index; showHour(s.replay.index); }
  setText($("gap-text"), sky.wind_speed == null ? "" : `Air moving ${windPhrase(sky.wind_speed, s.wind_compass)}`);
  setCaps("now", [s.sky ? nowCaption(s) : ""]);
  if (activeTab === "sky") renderForecast(sky);
}
function nowCaption(s) {
  const sky = s.sky || {}, cl = s.clarity || {};
  const when = s.replay ? `at ${hourLabel(s.replay.clock)} on June 7, 2023` : "right now";
  const beam = cl.daylight && cl.haze_transmission != null ? `, ${cl.haze_transmission}% of the sunbeam getting through` : "";
  return `The sky over PHS ${when}: ${s.replay ? "wildfire smoke" : skyWords(sky)}, sun ${sunPhrase(cl.sun_elevation)}${beam}.`;
}
const campusWindCaption = (sky, code) => (document.body.classList.contains("wind-on") && sky.wind_speed != null ? `Wind lines: ${windPhrase(sky.wind_speed, code)}.` : "");

// EPA guidance for each AQI category (airnow.gov)
const EPA_ADVICE = [null, null,
  "People with asthma, heart or lung disease, children, older adults and teens should limit long or heavy outdoor exertion.",
  "Everyone should reduce long or heavy outdoor exertion. Sensitive groups should avoid it.",
  "Everyone should avoid long or heavy outdoor exertion. Sensitive groups should stay indoors.",
  "Health warning: everyone should avoid all outdoor exertion."];

function renderFireLine(f) {
  const el = $("fire-line");
  let html = "", cls = "fireline";
  if (!f || !f.available) html = serverMode ? `${ICON.fire}<span>Loading NASA satellite fire data.</span>` : "";
  else {
    cls += f.smoke_risk ? " risk" : "";
    html = `${ICON.fire}<span>NASA fire detections in the last 7 days: ${f.within_50km} within 50 km and ${f.within_100km} within 100 km. ` +
      (f.upwind_count ? `${f.upwind_count} upwind${f.smoke_risk ? ", so smoke could drift in." : ", all small."}` : "None upwind right now.") + "</span>";
  }
  el.className = cls;
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
}

function renderBanners(s, sky, cat) {
  $("replay-banner").hidden = !s.replay;
  if (s.replay) {
    setText($("replay-banner-text"), `Replaying June 7, 2023 at ${hourLabel(s.replay.clock, true)}. This is recorded data, not today's air.`);
    setText($("replay-banner-hour"), `Hour ${s.replay.index + 1} of ${s.replay.total}`);
  }
  updateStoryBanner();
  const el = $("alert");
  let html = "", cls = "banner b-alert", role = "alert";
  if (!s.replay && sky.us_aqi != null && cat.level >= 2) {
    const cause = causeOf(sky);
    html = `<p><b>Air quality alert for Princeton: AQI ${sky.us_aqi}, ${cat.lower}.</b>${cause ? ` Likely cause: ${cause}.` : ""} Keep windows shut. ${EPA_ADVICE[Math.min(5, cat.level)]}</p>`;
  } else if (!s.replay && s.fires && s.fires.smoke_risk) {
    cls = "banner b-smoke"; role = "status";
    html = `${ICON.fire}<p><b>Fire watch for PHS.</b> NASA satellites see ${s.fires.upwind_count} hotspots upwind, ${s.fires.upwind_frp_150km} MW within 150 km. The air is fine right now, but smoke could drift in.</p>`;
  }
  el.hidden = !html;
  el.className = cls;
  el.setAttribute("role", role);
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
}
function updateStoryBanner() { $("story-banner").hidden = activeTab !== "replay" || !!(latest && latest.replay); }

// ---------- connection: offline banner, error state, retries ----------
let lastOk = 0, retryAt = 0;
function renderConnection(staleAgeMin) {
  const off = $("offline");
  let age = staleAgeMin;
  if (age == null && latest && retryAt) age = (latest.sky_age_min || 0) + (Date.now() - lastOk) / 60000; // we couldn't reach anyone
  if (age == null) { off.hidden = true; return; }
  const at = new Date(Date.now() - age * 60000), mins = Math.round(age);
  setText($("offline-text"), `Showing the sky from ${clockText(at)}, ${mins < 1 ? "less than a minute" : mins === 1 ? "1 minute" : mins + " minutes"} old. ` +
    (staleAgeMin == null && serverMode ? "Retrying every few seconds." : "Retrying every minute."));
  off.hidden = false;
}
function showNoData(e) {
  document.body.classList.remove("is-loading");
  document.body.classList.add("is-error");
  setText($("err-text"), serverMode ? "The SkyWindow device didn't answer. Trying again in a few seconds." : "Open-Meteo didn't answer. Trying again in 60 seconds.");
  setText($("mode-chip"), "Sky data didn't load");
  $("status-dot").className = "dot error";
  $("clock").textContent = "";
  console.warn("No sky data yet:", e && e.message);
}

async function poll(force = false) {
  if (!force && Date.now() < retryAt) { if (latest) renderConnection(null); return; }
  let s;
  try { s = await getState(); }
  catch (e) {
    retryAt = Date.now() + (serverMode ? 5000 : 60000); // Open-Meteo is shared, so showcase mode backs off for a minute
    if (latest) {
      const asOf = clockText(new Date(lastOk - (latest.sky_age_min || 0) * 60000));
      document.body.classList.add("is-stale");
      renderConnection(null);
      setText($("verdict-hint"), `As of ${asOf}. Check again before opening the window.`);
      setText($("mode-chip"), "");
      $("status-dot").className = "dot";
      $("clock").innerHTML = `<span class="m-hide">Last updated </span>${asOf}`;
    }
    else showNoData(e);
    return;
  }
  retryAt = 0;
  try { render(s); } catch (e) { console.error("render failed", e); } // a UI bug must not hide the verdict
}
$("btn-retry").onclick = () => { setText($("err-text"), "Checking the sky over PHS."); poll(true); };

// ---------- charts ----------
// Chart.js is bundled in vendor/; if it didn't load, skip the charts instead of stopping this script
const hasChart = typeof Chart !== "undefined";
if (hasChart) {
  Chart.defaults.color = "#5B636B";
  Chart.defaults.borderColor = "#E4E6E3";
  Chart.defaults.font.family = "Archivo, system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Object.assign(Chart.defaults.plugins.tooltip, { backgroundColor: "#1C2024", titleColor: "#F2F3F0", bodyColor: "#F2F3F0", cornerRadius: 2, padding: 10, boxPadding: 4 });
}
// EPA bands behind the AQI line, and night hours shaded
const bandsPlugin = {
  id: "skyBands",
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales: { x, y } } = chart;
    if (!a) return;
    ctx.save();
    (opts.night || []).forEach((isNight, i) => {
      if (!isNight) return;
      const x0 = Math.max(a.left, x.getPixelForValue(i - 0.5)), x1 = Math.min(a.right, x.getPixelForValue(i + 0.5));
      ctx.fillStyle = "rgba(28,32,36,.06)"; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    });
    ctx.font = "11px Archivo, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "top";
    for (const [lo, hi, color, label] of [[0, 50, "rgba(74,169,105,.12)", "Good, 50 and under"], [50, 100, "rgba(229,193,74,.18)", "Moderate"],
      [100, 150, "rgba(228,130,51,.10)", "Unhealthy for sensitive groups"], [150, 200, "rgba(196,65,52,.10)", "Unhealthy"]]) {
      if (lo >= y.max) continue;
      const top = y.getPixelForValue(Math.min(hi, y.max)), bot = y.getPixelForValue(lo);
      ctx.fillStyle = color; ctx.fillRect(a.left, top, a.right - a.left, bot - top);
      if (bot - top > 16) { ctx.fillStyle = "#5B636B"; ctx.fillText(label, a.right - 6, top + 4); }
    }
    ctx.restore();
  },
};
let chart, fchart;
function lineChart(el, datasets, labels, extra = {}) {
  if (!hasChart) return null;
  return new Chart(el, {
    type: "line", data: { labels, datasets }, plugins: extra.plugins || [],
    options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      elements: { point: { radius: 0, hoverRadius: 3 }, line: { borderWidth: 2 } },
      plugins: { legend: { align: "start", labels: { boxWidth: 14, boxHeight: 3, color: "#1C2024", padding: 14 } }, ...(extra.pluginOptions || {}) },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: "#E4E6E3" }, border: { display: false }, ...(extra.y || {}) } } },
  });
}
async function refreshHistory() {
  if (!serverMode || activeTab !== "sky") return;
  const h = await api("api/history?minutes=60").catch(() => []);
  const labels = h.map((r) => clockText(new Date(r.ts * 1000)));
  const ds = [
    { label: "Room stale index", data: h.map((r) => r.stale_index), borderColor: "#7D45A2", tension: 0.3 },
    { label: "Sky AQI", data: h.map((r) => r.us_aqi), borderColor: "#1C2024", tension: 0.3 },
  ];
  if (!chart) chart = lineChart($("chart"), ds, labels);
  else if (chart) { chart.data.labels = labels; chart.data.datasets.forEach((d, i) => (d.data = ds[i].data)); chart.update(); }
}
setInterval(refreshHistory, 30000);

function renderForecast(sky) {
  if (!sky || !sky.forecast) return;
  const f = sky.forecast, nowKey = (sky.time || "").slice(0, 13);
  let i0 = f.time.findIndex((t) => t.slice(0, 13) >= nowKey); if (i0 < 0) i0 = 0;
  const sl = (a) => (a || []).slice(i0, i0 + 24);
  const key = sl(f.time).join();
  if (renderForecast.key === key) return;
  renderForecast.key = key;
  const times = sl(f.time), aqi = sl(f.us_aqi), aod = sl(f.aod), cloud = sl(f.cloud_cover), rain = sl(f.precip_prob);
  const night = times.map((t) => LocalSky.solarElevation(phsDate(t)) < 0);
  const ds = [
    { label: "US AQI", data: aqi, borderColor: "#1C2024", borderWidth: 2.5, tension: 0.3 },
    { label: "Smoke haze (AOD × 100)", data: aod.map((x) => (x == null ? null : x * 100)), borderColor: "#5B636B", borderWidth: 1.5,
      backgroundColor: "rgba(91,99,107,.16)", fill: "origin", tension: 0.3 },
    { label: "Clouds, %", data: cloud, borderColor: "#9AA1A7", borderWidth: 1.5, borderDash: [4, 4], tension: 0.3 },
  ];
  if (fchart) fchart.destroy();
  fchart = lineChart($("forecast"), ds, times.map((t) => hourLabel(t.slice(11, 16))), { plugins: [bandsPlugin], pluginOptions: { skyBands: { night } }, y: { suggestedMax: 120 } });
  forecastWords(times, aqi, aod, rain);
  forecastPanes(times, aqi, aod, cloud, rain, sky.time);
  const { rise, set } = nextSunEvents();
  const dayName = (d) => (phsDay(d) === phsDay(new Date()) ? "today" : weekday(phsDay(d)));
  const t = (d) => ampm(d.toLocaleTimeString("en-US", { timeZone: PHS_TZ, hour: "numeric", minute: "2-digit" }));
  if (rise) { setText($("fc-rise-l"), `Sunrise ${dayName(rise)}`); setText($("fc-rise"), t(rise)); }
  if (set) { setText($("fc-set-l"), `Sunset ${dayName(set)}`); setText($("fc-set"), t(set)); }
  if (times[0]) setText($("fc-from"), `Forecast from ${hourLabel(times[0].slice(11, 16))} ${weekday(times[0].slice(0, 10))}`);
}
function forecastWords(times, aqi, aod, rain) {
  const vals = aqi.filter((x) => x != null);
  if (!vals.length) { setText($("fc-title"), "The next 24 hours of sky"); setText($("fc-text"), "The air-quality forecast isn't available right now."); return; }
  const when = (i) => (i === 0 ? "right now" : `around ${hourLabel(times[i].slice(11, 16))}${times[i].slice(0, 10) !== times[0].slice(0, 10) ? " " + weekday(times[i].slice(0, 10)) : ""}`);
  let best = [0, -1], run = -1;
  aqi.forEach((x, i) => { if (x != null && x <= 50) { if (run < 0) run = i; if (i - run > best[1] - best[0]) best = [run, i]; } else run = -1; });
  const min = Math.min(...vals), max = Math.max(...vals), cMin = catOf(min), cMax = catOf(max);
  let title;
  if (vals.every((x) => x <= 50)) title = "Clean air for the next 24 hours.";
  else if (best[1] - best[0] >= 1) title = `The cleanest stretch is ${hourLabel(times[best[0]].slice(11, 16))} to ${hourLabel(times[best[1]].slice(11, 16))}.`;
  else title = "No clean stretch in the next 24 hours.";
  let text = cMin.level === cMax.level ? `The air stays ${cMax.lower}, between AQI ${min} and ${max}.` : `The AQI moves between ${min}, ${cMin.lower}, and ${max}, ${cMax.lower}.`;
  const wet = rain.findIndex((p) => p >= 50);
  if (wet >= 0) text += ` Rain is likely from ${when(wet).replace(/^around /, "about ")}.`;
  const hz = Math.max(...aod.filter((x) => x != null), 0);
  if (hz > 0.3) text += ` Smoke haze peaks at ${hz.toFixed(2)} ${when(aod.indexOf(hz))}.`;
  text += ` The lowest it gets is about ${min}, ${when(aqi.indexOf(min))}.`;
  setText($("fc-title"), title);
  setText($("fc-text"), text);
}
function forecastPanes(times, aqi, aod, cloud, rain, nowIso) {
  const RAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='34'%3E%3Cpath d='M6 2l-4 12M19 18l-4 12' stroke='%23FFFFFF' stroke-opacity='.45' stroke-width='1.2' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`;
  const GLOSS = "linear-gradient(115deg, rgba(255,255,255,.08) 0%, rgba(255,255,255,0) 38%)";
  const today = (nowIso || times[0] || "").slice(0, 10), list = [];
  [2, 11, 17].forEach((off, k) => {
    const i = Math.min(off, times.length - 1);
    const pane = [$("pane-0"), $("pane-1"), $("pane-2")][k];
    if (i < 0 || !times[i]) { list.push(""); return; }
    const t = times[i], h = +t.slice(11, 13), el = LocalSky.solarElevation(phsDate(t)), c = cloud[i] ?? 0, wet = (rain[i] ?? 0) >= 50;
    const look = skyLook({ el, aod: aod[i], cloud: c, smoke: (aod[i] ?? 0) > 0.7, hour: h });
    const layers = [GLOSS, wet ? RAIN : null, look.glow, look.ground, skyGradient(look)].filter(Boolean);
    pane.classList.add("self");
    pane.style.backgroundImage = layers.join(", ");
    pane.style.backgroundSize = layers.map((l) => (l === RAIN ? "26px 34px" : "100% 100%")).join(", ");
    pane.style.backgroundRepeat = layers.map((l) => (l === RAIN ? "repeat" : "no-repeat")).join(", ");
    const day = t.slice(0, 10) === today ? (h < 12 ? "this morning" : h < 17 ? "this afternoon" : "tonight") : h < 5 && i < 9 ? "tonight" : weekday(t.slice(0, 10));
    let cond = wet ? "rain likely" : (rain[i] ?? 0) >= 30 ? "a chance of rain" : c >= 85 ? "overcast" : c >= 50 ? "mostly cloudy" : c >= 20 ? "partly cloudy" : "clear";
    if (el > -4 && el < 6) cond += h < 12 ? " at sunrise" : " at sunset";
    if ((aod[i] ?? 0) > 0.3) cond += ", hazy";
    list.push(`${upperFirst(hourLabel(t.slice(11, 16)))} ${day}: ${cond}${aqi[i] != null ? `, AQI ${aqi[i]}` : ""}`);
  });
  setCaps("sky", list);
}
function clearPaneSkies() {
  [$("pane-0"), $("pane-1"), $("pane-2")].forEach((p) => { p.classList.remove("self"); p.style.backgroundImage = p.style.backgroundSize = p.style.backgroundRepeat = ""; });
}
function nextSunEvents(from = new Date()) { // sunrise and sunset from the sun's position over PHS
  let rise = null, set = null, prev = LocalSky.solarElevation(from);
  for (let m = 5; m <= 36 * 60 && !(rise && set); m += 5) {
    const t = new Date(from.getTime() + m * 60000), e = LocalSky.solarElevation(t);
    if (!rise && prev < -0.833 && e >= -0.833) rise = t;
    if (!set && prev >= -0.833 && e < -0.833) set = t;
    prev = e;
  }
  return { rise, set };
}

// ---------- read it aloud (ElevenLabs on the device, the browser's voice otherwise) ----------
$("btn-announce").onclick = async () => {
  const b = $("btn-announce"), label = b.querySelector(".btn-text");
  let finished = false;
  const done = () => { if (finished) return; finished = true; b.disabled = false; label.textContent = "Read it aloud"; };
  b.disabled = true; label.textContent = "Reading aloud";
  try {
    const rep = serverMode ? await api("api/report", {}) : LocalSky.report(latest);
    $("announce-text").textContent = "“" + rep.text + "”";
    if (rep.audio_url) { const a = $("audio"); a.onended = a.onerror = done; a.src = rep.audio_url; await a.play().catch(done); }
    else if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(rep.text);
      u.onend = u.onerror = done;
      speechSynthesis.speak(u);
      setTimeout(done, 30000);
    } else done();
  } catch (e) { $("announce-text").textContent = "Couldn't read it aloud: " + e.message; done(); }
};

function setSound(on) {
  const state = SkyAudio.toggle(on), b = $("btn-sound");
  b.setAttribute("aria-pressed", state);
  b.querySelector(".sound-text").textContent = state ? "Sound on" : "Sound off";
}
$("btn-sound").onclick = () => setSound(); // the first press is also the click browsers need before playing sound

// ---------- the June 7, 2023 record ----------
const STORY = {
  7: (b) => `The sun rises into the smoke. Only about ${b}% of its beam gets through.`,
  13: (b) => `The sun is almost overhead, so its path through the smoke is short. Still only ${b}% gets through.`,
  17: (b) => `The haze thickens and the sun drops west. The sky goes deep orange and ${b}% of the beam gets through.`,
  20: () => "The worst hour. The sun sets behind the thickest smoke of the day.",
};
function hourFacts(h) {
  const el = LocalSky.solarElevation(phsDate(h.time));
  const beam = el > 3 && h.aod != null ? Math.round(100 * Math.exp(-h.aod / Math.sin(el * Math.PI / 180))) : null;
  return { el, beam, hour: +h.time.slice(11, 13), clock: h.time.slice(11, 16), look: skyLook({ el, aod: h.aod, cloud: h.cloud_cover, smoke: true, hour: +h.time.slice(11, 13) }) };
}
function storyLine(f) {
  if (STORY[f.hour] && (f.beam != null || f.hour === 20)) return STORY[f.hour](f.beam);
  if (f.el <= 0) return "The sun is down, but the smoke stays overhead.";
  return f.beam != null ? `About ${f.beam}% of the sunbeam gets through the smoke.` : "The sun is low behind the smoke.";
}
async function loadReplay() {
  if (!replayData) {
    try { replayData = await LocalSky.smokeDay(); }
    catch (e) { $("replay-status").textContent = "Couldn't load the 2023 record: " + e.message; return; }
    const max = Math.max(...replayData.hours.map((h) => h.us_aqi || 0));
    $("scrub-bars").innerHTML = replayData.hours.map((h) => `<div style="height:${Math.max(4, 100 * (h.us_aqi || 0) / max)}%"></div>`).join("");
    $("scrub").max = replayData.hours.length - 1;
    renderStory();
  }
  showHour(+$("scrub").value);
}
function renderStory() {
  const hours = replayData.hours, at = (i) => hourLabel(hours[i].time.slice(11, 16));
  const worst = hours.reduce((m, h, i) => (h.us_aqi > hours[m].us_aqi ? i : m), 0), thick = hours.reduce((m, h, i) => (h.aod > hours[m].aod ? i : m), 0);
  setText($("st-worst"), `${hours[worst].us_aqi} at ${at(worst)}`);
  setText($("st-haze"), `${hours[thick].aod.toFixed(2)} at ${at(thick)}`);
  setText($("st-shut"), `${hours.filter((h) => LocalSky.verdictFor(h).key === "shut").length} of ${hours.length}`);
  $("story-hours").innerHTML = [7, 13, 17, 20].filter((i) => hours[i]).map((i) => {
    const h = hours[i], f = hourFacts(h), st = verdictOf(LocalSky.verdictFor(h).key);
    return `<article class="hour"><div class="hour-text"><span class="hour-time">${hourLabel(f.clock)}</span><p>${storyLine(f)}</p>
      <dl class="dl"><dt>US AQI</dt><dd>${fmt(h.us_aqi)}</dd><dt>PM2.5</dt><dd>${fmt(h.pm2_5, 1, " µg/m³")}</dd><dt>Haze</dt><dd>${fmt(h.aod, 2)}</dd><dt>Sun</dt><dd>${sunPhrase(f.el)}</dd></dl>
      <span class="hour-verdict" style="color:${st.color};font-stretch:${st.stretch}%">${st.label}</span></div>
      <div class="hour-sky" role="img" aria-label="The sky over PHS at ${hourLabel(f.clock)}, rendered from the measurements" style="background-image:${skyBackground(f.look, ["linear-gradient(115deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,0) 40%)"])}"></div></article>`;
  }).join("");
}
function showHour(i) {
  if (!replayData) return;
  const h = replayData.hours[i], v = LocalSky.verdictFor(h), st = verdictOf(v.key), cat = catOf(h.us_aqi), f = hourFacts(h);
  setText($("r-time"), upperFirst(hourLabel(f.clock)) + ".");
  setText($("r-story"), storyLine(f));
  setText($("r-wind"), windPhrase(h.wind_speed, LocalSky.compass(h.wind_dir)));
  setText($("r-aqi"), fmt(h.us_aqi));
  setText($("r-cat"), cat.name);
  $("r-cat").style.setProperty("--c", cat.text);
  setText($("r-pm"), fmt(h.pm2_5, 0));
  setText($("r-beam"), f.beam == null ? "Dark" : f.beam + "%");
  setText($("r-aod"), h.aod == null ? NO_DATA : `Aerosol optical depth ${h.aod.toFixed(2)}, ${aodWord(h.aod)}`);
  const rv = $("r-verdict");
  setText(rv, st.label);
  rv.style.color = st.color; rv.style.fontStretch = st.stretch + "%"; rv.style.fontWeight = st.weight;
  $("scrub").setAttribute("aria-valuetext", `${hourLabel(f.clock)}, AQI ${h.us_aqi}, ${st.label}`);
  document.querySelectorAll("#scrub-bars div").forEach((d, j) => d.classList.toggle("on", j === i));
  setCaps("replay", [`The sky over PHS at ${hourLabel(f.clock)} on June 7, 2023: wildfire smoke, sun ${sunPhrase(f.el)}${f.beam != null ? `, ${f.beam}% of the sunbeam getting through` : ""}.`]);
  if (activeTab !== "replay" || (latest && latest.replay && latest.replay.index !== i)) return;
  setSky(f.look);
  moveSash(v.key);
  windStreaks(h.wind_speed, h.wind_dir);
  if (globeState === "ready") { Globe.setSky({ haze: hazeOf(h), wind: h.wind_speed, night: f.el < 0, cloud: h.cloud_cover }); Globe.setVerdictColor(st.color); }
  SkyAudio.setSky({ wind: h.wind_speed, haze: hazeOf(h) });
}
$("scrub").oninput = (e) => showHour(+e.target.value);
async function toggleReplay() {
  const on = !(latest && latest.replay), buttons = [$("btn-replay"), $("btn-stop-replay")];
  try {
    buttons.forEach((b) => (b.disabled = true));
    if (serverMode) {
      await api("api/replay", { on });
      await new Promise((r) => setTimeout(r, 1200)); // let the device's 1 Hz loop pick it up
    } else if (on) await LocalSky.startReplay(); else LocalSky.stopReplay();
    await poll(true);
  } catch (e) { $("replay-status").textContent = e.message; }
  buttons.forEach((b) => (b.disabled = false));
}
$("btn-replay").onclick = toggleReplay;
$("btn-stop-replay").onclick = toggleReplay;

// ---------- setup and sensor training ----------
$("btn-setup").onclick = () => {
  const b = $("btn-setup"), open = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", open);
  $("setup-panel").hidden = !open;
};
document.querySelectorAll("[data-cal]").forEach((b) => (b.onclick = async () => {
  try { const r = await api("api/calibrate", { what: b.dataset.cal }); b.textContent = "Done: " + Object.entries(r).map(([k, v]) => `${k.replace(/_/g, " ")} ${(+v).toFixed(2)}`).join(", "); }
  catch (e) { alert(e.message); }
}));
document.querySelectorAll("[data-label]").forEach((b) => (b.onclick = async () => {
  try {
    await api("api/label", { label: b.dataset.label });
    b.dataset.n = (+b.dataset.n || 0) + 1; b.textContent = `${b.dataset.label} (${b.dataset.n})`;
  } catch (e) { alert(e.message); }
}));
document.querySelectorAll("[data-mock]").forEach((b) => (b.onclick = () => {
  if (serverMode) api("api/mock/" + b.dataset.mock, {}).catch((e) => alert(e.message));
  else if (b.dataset.mock === "spike") LocalSky.spike();
}));

// ---------- explore: tap anywhere on Earth ----------
const coordText = (lat, lon, d = 2) => `${Math.abs(lat).toFixed(d)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(d)}° ${lon >= 0 ? "E" : "W"}`;
async function explore(lat, lon, name) {
  explored = { lat, lon };
  if (activeTab !== "explore") selectTab("explore");
  explored = { lat, lon };
  $("explore-card").hidden = false;
  setText($("x-coords"), coordText(lat, lon));
  setText($("x-place"), name || "Reading the air here");
  setText($("x-status"), "Reading the air at that spot.");
  try {
    const r = await LocalSky.skyAt(lat, lon);
    if (!explored || explored.lat !== lat || explored.lon !== lon) return; // user tapped somewhere else meanwhile
    const sky = r.sky, cat = catOf(sky.us_aqi), home = (latest && latest.sky) || {}, hc = catOf(home.us_aqi);
    const place = name || r.place || "Open ocean";
    setText($("x-place"), place);
    setText($("x-here"), place.split(",")[0].slice(0, 28));
    setText($("x-verdict"), sky.us_aqi == null ? NO_DATA : `AQI ${sky.us_aqi}`);
    $("explore-card").style.setProperty("--x", cat.fill);
    setText($("x-cat"), cat.name);
    $("x-cat").style.setProperty("--c", cat.text);
    const haze = (a) => (a == null ? NO_DATA : `${a.toFixed(2)}, ${aodWord(a)}`);
    const cells = {
      aqi: [$("x-aqi"), $("c-aqi")], pm: [$("x-pm"), $("c-pm")], aod: [$("x-aod"), $("c-aod")], cond: [$("x-cond"), $("c-cond")],
      temp: [$("x-temp"), $("c-temp")], hum: [$("x-hum"), $("c-hum")], wind: [$("x-wind"), $("c-wind")], time: [$("x-time"), $("c-time")],
    };
    const rows = [
      ["aqi", sky.us_aqi == null ? NO_DATA : `${sky.us_aqi}, ${cat.lower}`, home.us_aqi == null ? NO_DATA : `${home.us_aqi}, ${hc.lower}`, sky.us_aqi, home.us_aqi],
      ["pm", fmt(sky.pm2_5, 1, " µg/m³"), fmt(home.pm2_5, 1, " µg/m³"), sky.pm2_5, home.pm2_5],
      ["aod", haze(sky.aod), haze(home.aod), sky.aod, home.aod],
      ["cond", weatherText(sky.weather_code), weatherText(home.weather_code)],
      ["temp", fmt(sky.temperature, 0, "°C"), fmt(home.temperature, 0, "°C")],
      ["hum", fmt(sky.humidity, 0, "%"), fmt(home.humidity, 0, "%")],
      ["wind", windPhrase(sky.wind_speed, LocalSky.compass(sky.wind_dir)), windPhrase(home.wind_speed, LocalSky.compass(home.wind_dir))],
      ["time", sky.utc_offset == null ? NO_DATA : hourLabel(new Date(Date.now() + sky.utc_offset * 1000).toISOString().slice(11, 16), true), clockText()],
    ];
    for (const [k, here, phs, a, b] of rows) {
      const [xc, cc] = cells[k];
      xc.textContent = here; cc.textContent = phs;
      xc.className = a != null && b != null && a !== b ? (a > b ? "worse" : "better") : ""; // red = dirtier than PHS
    }
    const cause = r.cause ? ` Likely cause: ${CAUSES[r.cause] || r.cause.toLowerCase()}.` : "";
    setText($("x-compare"), (home.us_aqi && sky.us_aqi != null
      ? (sky.us_aqi > home.us_aqi * 1.1 ? `The AQI here is ${(sky.us_aqi / home.us_aqi).toFixed(1)} times the AQI over PHS right now.`
        : sky.us_aqi < home.us_aqi * 0.9 ? "The air here is cleaner than over PHS right now." : "The air here is about the same as over PHS right now.")
      : "") + cause);
    setText($("x-status"), "Tap another spot, or jump to a region.");
    if (globeState === "ready") {
      Globe.dropPin(lat, lon, cat.fill);
      const hz = hazeOf(sky);
      Globe.setSky({ haze: hz, wind: sky.wind_speed, night: sky.is_day === 0, cloud: sky.cloud_cover });
    }
    SkyAudio.setSky({ wind: sky.wind_speed, haze: hazeOf(sky) });
    if (!reduceMotion) gsap.fromTo("#explore-card", { opacity: 0.4 }, { opacity: 1, duration: 0.5 });
  } catch (e) {
    setText($("x-status"), "Couldn't read that spot (" + e.message + "). Try again in a moment.");
  }
}

// ---------- campus: analyze any point near PHS ----------
function kmBetween(a, b, c, d) {
  const p = Math.PI / 180, h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b, c, d) {
  const p = Math.PI / 180, y = Math.sin((d - b) * p) * Math.cos(c * p);
  const x = Math.cos(a * p) * Math.sin(c * p) - Math.sin(a * p) * Math.cos(c * p) * Math.cos((d - b) * p);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const dirWord = (deg) => WIND_WORDS[LocalSky.compass(deg)] || "";
const CAMPUS_KM = 25;
let localPick = null, firesList = null, localPickCaption = "";
LocalMap.onAnalyze(async (lat, lon) => {
  if (activeTab !== "local") { selectTab.keepView = true; selectTab("local"); }
  const [plat, plon] = LocalMap.PHS, km = kmBetween(plat, plon, lat, lon);
  if (km > CAMPUS_KM) {
    localPick = null;
    $("local-card").hidden = true;
    $("local-out").hidden = false;
    setText($("lo-dist"), `${km.toFixed(0)} km ${dirWord(bearingDeg(plat, plon, lat, lon))} of PHS`);
    localPickCaption = `That spot is ${km.toFixed(0)} km from PHS, outside the campus area. Details below the window.`;
    setCaps("local", [localPickCaption]);
    $("btn-to-earth").onclick = () => { selectTab("explore"); if (globeState === "ready") Globe.flyTo(lat, lon); explore(lat, lon); };
    return;
  }
  $("local-out").hidden = true;
  localPick = { lat, lon };
  $("local-card").hidden = false;
  setText($("l-coords"), `${lat.toFixed(3)}°, ${lon.toFixed(3)}°, ${km < 1 ? "at PHS" : km.toFixed(1) + " km " + dirWord(bearingDeg(plat, plon, lat, lon)) + " of PHS"}`);
  setText($("l-place"), "Reading the air here");
  localPickCaption = "Reading the air at that spot. The full reading appears below the window.";
  setCaps("local", [localPickCaption]);
  setText($("l-around"), "Looking up roads, parks and industry nearby in OpenStreetMap. This can take about 10 seconds.");
  setText($("l-fire"), "Checking.");
  const same = () => localPick && localPick.lat === lat && localPick.lon === lon;
  // surroundings come from a separate (slower) OpenStreetMap query, so they fill in on their own
  LocalSky.surroundings(lat, lon).then((a) => {
    if (!same()) return;
    const road = a.nearestRoad;
    $("l-around").innerHTML =
      (road ? `Nearest major road: <b>${road.name}</b>, about ${Math.round(road.m / 10) * 10} m away` + (a.roadNames.length > 1 ? ` (also ${a.roadNames.slice(1).join(", ")})` : "") + "." : "No major roads within 1 km.") +
      ` <b>${a.green}</b> parks or green areas, <b>${a.industrial}</b> industrial areas, <b>${a.schools}</b> schools.` +
      (road && road.m < 200 ? ` <span class="risk">Within 200 m of a major road, traffic pollution (nitrogen dioxide, fine particles) is usually higher than the model grid shows.</span>` : "");
  }).catch((e) => { if (same()) setText($("l-around"), "OpenStreetMap lookup unavailable right now (" + e.message + ")."); });

  // nearest NASA fire detection (from the list the Pi downloaded)
  if (firesList && firesList.length) {
    const near = firesList.map((f) => ({ ...f, d: kmBetween(lat, lon, f.lat, f.lon) })).sort((a, b) => a.d - b.d)[0];
    $("l-fire").innerHTML = `<b>${near.d.toFixed(1)} km ${dirWord(bearingDeg(lat, lon, near.lat, near.lon))}</b> of this spot, ` +
      `detected ${near.date} (${near.frp} MW, ${near.confidence} confidence). ` +
      `${firesList.filter((f) => kmBetween(lat, lon, f.lat, f.lon) <= 25).length} detections within 25 km in the last 7 days.`;
  } else setText($("l-fire"), serverMode ? "No fire detections loaded." : "Fire data comes from the SkyWindow device. Open this page from the Pi to see it.");

  try {
    const r = await LocalSky.skyAt(lat, lon);
    if (!same()) return;
    const sky = r.sky, st = verdictOf(r.verdict.key), cat = catOf(sky.us_aqi), place = r.place || "Selected point";
    setText($("l-place"), place);
    setText($("l-verdict"), st.label);
    $("local-card").style.setProperty("--x", st.color);
    setText($("l-cat"), cat.name + (r.cause ? `. Likely cause: ${CAUSES[r.cause] || r.cause.toLowerCase()}` : ""));
    $("l-cat").style.setProperty("--c", cat.text);
    setText($("l-aqi"), fmt(sky.us_aqi));
    setText($("l-pm"), fmt(sky.pm2_5, 1));
    setText($("l-pm10"), fmt(sky.pm10, 1));
    setText($("l-o3"), fmt(sky.ozone, 0));
    setText($("l-no2"), fmt(sky.no2, 1));
    setText($("l-so2"), fmt(sky.so2, 1));
    setText($("l-co"), fmt(sky.co, 0));
    setText($("l-aod"), sky.aod == null ? NO_DATA : `${sky.aod.toFixed(2)}, ${aodWord(sky.aod)}`);
    setText($("l-uv"), fmt(sky.uv_index, 1));
    setText($("l-cond"), weatherText(sky.weather_code));
    setText($("l-temp"), sky.temperature == null ? NO_DATA : `${Math.round(sky.temperature)}°C` + (sky.feels_like == null ? "" : `, feels like ${Math.round(sky.feels_like)}°C`));
    setText($("l-hum"), fmt(sky.humidity, 0, "%"));
    setText($("l-dew"), fmt(sky.dew_point, 0, "°C"));
    setText($("l-wind"), sky.wind_speed == null ? NO_DATA : `${windPhrase(sky.wind_speed, LocalSky.compass(sky.wind_dir))}, gusts ${fmt(sky.wind_gusts, 0)}`);
    setText($("l-rain"), fmt(sky.precipitation, 1, " mm"));
    setText($("l-press"), fmt(sky.pressure, 0, " hPa"));
    setText($("l-vis"), sky.visibility == null ? NO_DATA : (sky.visibility / 1000).toFixed(1) + " km");
    setText($("l-elev"), fmt(sky.elevation, 0, " m"));
    localPickCaption = `${place.split(",")[0]}: AQI ${fmt(sky.us_aqi)}, ${cat.lower}. The full reading is below the window.`;
    setCaps("local", [localPickCaption]);
    LocalMap.setPickColor(cat.fill);
    if (!reduceMotion) gsap.fromTo("#local-card", { opacity: 0.4 }, { opacity: 1, duration: 0.4 });
  } catch (e) { setText($("l-place"), "Couldn't read this spot (" + e.message + ")"); }
});
document.querySelectorAll("[data-layer]").forEach((b) => (b.onchange = () => {
  if (b.dataset.layer === "wind") { // drawn by this page over the panes, not by the map
    document.body.classList.toggle("wind-on", b.checked);
    if (latest && !localPickCaption) setCaps("local", [campusWindCaption(latest.sky || {}, latest.wind_compass)]);
    return;
  }
  LocalMap.toggle(b.dataset.layer, b.checked);
}));
document.body.classList.toggle("wind-on", !!document.querySelector('[data-layer="wind"]:checked'));
document.querySelectorAll("[data-base]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("[data-base]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  LocalMap.setBase(b.dataset.base);
}));
document.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  mapView = b.dataset.view;
  LocalMap.view(mapView, !reduceMotion);
}));

async function loadFires() {
  if (!serverMode) {
    setText($("fire-summary"), "Satellite fire data is fetched by the SkyWindow device. Open this page from the Pi (http://<pi-ip>:8000/app.html) to see recent fires near PHS.");
    return;
  }
  if (loadFires.done) return;
  try {
    const d = await api("api/fires");
    firesList = d.fires;
    LocalMap.setFires(d.fires);
    const f = d.summary, n = f.nearest;
    $("fire-summary").innerHTML =
      `<b>${f.within_50km}</b> detections within 50 km and <b>${f.within_100km}</b> within 100 km in the last 7 days (${f.within_300km} within 300 km).` +
      (n ? ` Nearest: <b>${n.km} km ${dirWord(n.bearing)}</b> on ${n.date} (${n.frp} MW).` : "") +
      ` Largest nearby fire: ${f.largest_frp} MW. ` +
      (f.smoke_risk ? `<span class="risk">Upwind right now: ${f.upwind_count} detections, ${f.upwind_frp_150km} MW within 150 km. Smoke could drift toward PHS.</span>`
        : f.upwind_count ? `Upwind right now: ${f.upwind_count} small detections. Not enough to expect smoke.` : "None are upwind of PHS right now.");
    loadFires.done = true;
  } catch (e) { setText($("fire-summary"), "NASA fire data unavailable right now (" + e.message + ")."); }
}

// ---------- the world now: live AQI for major cities ----------
async function loadWorld() {
  try {
    const list = await LocalSky.worldNow();
    worldList = list;
    if (globeState === "ready") Globe.setCities(list);
    const phs = list.find((c) => c.name.startsWith("Princeton"));
    const counts = EPA_NAMES.map((_, lvl) => list.filter((c) => c.category.level === lvl).length);
    $("dist-bar").innerHTML = counts.map((n, k) => (n ? `<span style="flex:${n};background:${EPA_FILL[k]}" title="${EPA_NAMES[k]}: ${n}"></span>` : "")).join("");
    $("dist-bar").setAttribute("aria-label", `Of ${list.length} cities: ` + counts.map((n, k) => (n ? `${n} ${EPA_NAMES[k].toLowerCase()}` : "")).filter(Boolean).join(", "));
    $("dist-legend").innerHTML = counts.map((n, k) => (n ? `<span><i style="--c:${EPA_FILL[k]}" aria-hidden="true"></i>${EPA_NAMES[k]} ${n}</span>` : "")).join("");
    const sorted = list.map((c) => c.us_aqi).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    const when = latest && latest.sky && latest.sky.is_day === 0 ? "tonight" : "today";
    setText($("world-summary"), `The median city is at AQI ${median}.` + (phs ? ` PHS, at ${phs.us_aqi}, is ${phs.us_aqi < median ? "cleaner than" : phs.us_aqi > median ? "worse than" : "about the same as"} the typical city ${when}.` : ""));
    setText($("world-count"), `${list.length} cities`);
    setText($("world-time"), `Updated ${clockText()} at PHS`);
  } catch (e) {
    setText($("world-time"), "World data unavailable right now");
    setText($("world-summary"), `Couldn't load the world's air (${e.message}). Trying again in 10 minutes.`);
  }
}
setInterval(loadWorld, 600000);

function jumpTo(region) {
  const [lat, lon] = region.split(",").map(Number);
  if (globeState === "ready") Globe.flyTo(lat, lon);
}
$("region-jump").onchange = () => {
  const o = [...document.querySelectorAll("[data-region]")].find((x) => x.selected);
  if (o) jumpTo(o.dataset.region);
};
Globe.onPick((lat, lon) => { if (activeTab === "explore") explore(lat, lon); });

// ---------- links between views ----------
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (!go) return;
  e.preventDefault();
  selectTab(go.dataset.go);
  scrollTo({ top: 0 });
});
$("btn-orbit").onclick = (e) => { e.preventDefault(); selectTab("now"); scrollTo({ top: 0 }); };

// ---------- start: straight into the window, skeletons until the first reading ----------
async function boot() {
  const fromHash = Object.keys(HASH).find((k) => "#" + HASH[k] === location.hash);
  selectTab(fromHash || "now", true);
  await detectServer();
  await poll(true);
  setInterval(poll, 2000);
  setTimeout(() => { ensureGlobe(); loadWorld(); }, 800);
}
boot();
