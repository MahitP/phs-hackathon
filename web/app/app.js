// The SkyWindow app: NOW, PHS CAMPUS, FORECAST and EARTH over the globe (globe.js) and the PHS map (local.js).
// It lives inside the story's page as #app. The shell opens it two ways:
//  - from the story: the story's Earth dives into the map at zoom 6, then enter({ via: "story" }) assembles the HUD;
//  - cold (app.html): enter({ via: "cold" }) plays the globe's own intro (orbit -> Princeton -> plunge into the map).
// Data comes from the Raspberry Pi's API when the device serves the page, or straight from Open-Meteo (sky-local.js).
const SkyApp = (() => {
  const $ = (id) => document.getElementById(id);
  const appEl = $("app");
  const qa = (sel) => appEl.querySelectorAll(sel);
  const fmt = (v, d = 0, unit = "") => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toFixed(d) + unit);
  let latest = null, serverMode = false, activeTab = "now", explored = null;
  let active = false, prepared = null, pollTimer = null, historyTimer = null, worldTimer = null, globeOK = false;
  let exitHandler = () => {}, sound = { toggle: () => false, on: () => false, setWind: () => {} };

  // Optional write token (SKYWINDOW_TOKEN on the server): open the site once as /?token=..., it's remembered.
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

  // ---------- getting ready while the story plays, opening, closing ----------
  /** Globe textures, the map at zoom 6 (so its tiles are cached), the first reading and the world's cities. */
  function prepare() {
    if (prepared) return prepared;
    $("localmap").hidden = false;
    $("localmap").style.opacity = 0;
    LocalMap.init($("localmap"));
    LocalMap.wide();
    let globeReady = Promise.resolve(false);
    try { globeReady = Globe.init($("globe")).then((ok) => { Globe.compile(); return ok; }); globeOK = true; }
    catch (e) { console.warn("globe unavailable", e); } // no WebGL: the map and the panels still work
    $("globe").style.opacity = 0;
    prepared = Promise.all([globeReady, detectServer().then(poll)]).then(() => { loadWorld(); worldTimer = worldTimer || setInterval(loadWorld, 600000); });
    return prepared;
  }

  function startPolling() {
    clearInterval(pollTimer); clearInterval(historyTimer);
    pollTimer = setInterval(poll, 2000);
    historyTimer = setInterval(refreshHistory, 30000);
    poll();
  }

  function assembleHUD(delay) {
    $("hud").hidden = false;
    gsap.fromTo("#hud .topbar", { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.8, delay });
    gsap.fromTo("#tab-now", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.9, delay: delay + 0.3, ease: "power3.out" });
  }

  /** Open the app. via "story": the map is already on screen (the story's Earth dived into it). via "cold": play the globe intro. */
  async function enter({ via = "story", reduced = false } = {}) {
    active = true;
    appEl.classList.add("shown");
    appEl.inert = false;
    selectTab.keepView = true; selectTab("now"); // NOW without moving the scene: the map is the scene
    startPolling();
    if (via === "cold") {
      await prepare();
      sceneIsMap = false;
      if (globeOK) { Globe.start(); gsap.to("#globe", { opacity: 1, duration: reduced ? 0 : 0.9 }); }
      if (reduced || !globeOK) { showScene("now"); assembleHUD(0); }
      else {
        Globe.focusHome();
        setTimeout(() => { if (activeTab === "now" && active) showScene("now", true); }, 2300); // keep zooming: globe -> city
        assembleHUD(1.6);
      }
    } else {
      sceneIsMap = true;
      $("localmap").hidden = false;
      gsap.set("#localmap", { opacity: 1 });
      gsap.set("#globe", { opacity: 0 });
      if (globeOK) Globe.snapHome(); // so EARTH and FORECAST open where the globe intro would have left them
      LocalMap.view("city", true, { holdLabels: true });
      loadFires();
      assembleHUD(reduced ? 0 : 0.05);
    }
    refreshHistory();
    $("verdict-label").focus({ preventScroll: true });
  }

  /** Retract the HUD (the shell then takes the picture back). Resolves when the panels are gone. */
  function exit({ reduced = false } = {}) {
    active = false;
    clearInterval(pollTimer); clearInterval(historyTimer);
    appEl.inert = true;
    if (explored) { explored = null; if (globeOK) Globe.hidePin(); }
    return new Promise((res) => {
      if (reduced) { $("hud").hidden = true; res(); return; }
      gsap.to(["#hud .topbar", "#hud .panel:not([hidden])", "#regions", ".hud-foot", "#alert"], { opacity: 0, y: -8, duration: 0.35, ease: "power2.in", stagger: 0.04,
        onComplete: () => { $("hud").hidden = true; gsap.set(["#hud .topbar", "#hud .panel", "#regions", ".hud-foot", "#alert"], { clearProps: "opacity,transform" }); res(); } });
    });
  }

  /** The picture behind the HUD right now: "map" or "globe". */
  const scene = () => (sceneIsMap ? "map" : "globe");

  /** Fully hidden again (after the shell has faded the picture out). */
  function hide() {
    appEl.classList.remove("shown");
    appEl.inert = true;
    if (globeOK) { Globe.stop(); Globe.resetZoom(); }
    gsap.killTweensOf(["#globe", "#localmap"]);
    $("globe").style.opacity = 0; $("localmap").style.opacity = 0;
    $("regions").hidden = true;
    sceneIsMap = false;
    $("localmap").hidden = false; // laid out again, ready for the next dive
    LocalMap.wide();
  }

  // ---------- sound: the shell's engine (the story's live outdoor soundscape) ----------
  function syncSound() {
    const on = sound.on();
    $("btn-sound").textContent = on ? "SOUND ON" : "SOUND OFF";
    $("btn-sound").setAttribute("aria-pressed", String(on));
  }
  $("btn-sound").onclick = () => { sound.toggle(); syncSound(); };
  document.addEventListener("skywindow:sound", syncSound);
  $("btn-orbit").onclick = () => exitHandler();
  $("btn-story").onclick = () => exitHandler(); // the same as the logo, for people who don't know the logo does it

  // ---------- tabs ----------
  qa("[role=tab]").forEach((b) => (b.onclick = () => selectTab(b.dataset.tab)));
  function selectTab(name) {
    activeTab = name;
    qa("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
    qa(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
    gsap.fromTo("#tab-" + name, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: "power2.out" });
    if (!selectTab.keepView) showScene(name);
    selectTab.keepView = false;
    if (name !== "explore" && explored) { explored = null; Globe.hidePin(); }
    if (name === "sky") { renderForecast.key = null; renderForecast(latest && latest.sky); refreshHistory(); }
    if (name !== "explore" && latest) applySky(latest);
  }

  // ---------- scenes: close-up map (NOW = city, LOCAL = school) or the 3D globe ----------
  const MAP_VIEWS = { now: "city", local: "school" }; // everything else shows the globe
  const GLOBE_REGION_TABS = ["sky", "explore"];
  let sceneIsMap = false;
  function showScene(name, plunge = false) {
    const view = MAP_VIEWS[name];
    gsap.killTweensOf(["#globe", "#localmap"]); // a pending fade from the previous scene must not land after this one
    if (view || !globeOK) {
      LocalMap.init($("localmap"));
      if (!sceneIsMap) {
        $("localmap").hidden = false;
        LocalMap.invalidate();
        if (plunge) Globe.plunge(1.4); // zoom the globe toward Princeton while the map fades in
        gsap.fromTo("#localmap", { opacity: 0 }, { opacity: 1, duration: plunge ? 1.4 : 0.6, delay: plunge ? 0.5 : 0 });
        if (globeOK) gsap.to("#globe", { opacity: 0, duration: 0.6, delay: plunge ? 1.2 : 0, onComplete: () => { Globe.resetZoom(); Globe.stop(); } });
        sceneIsMap = true;
      }
      LocalMap.view(view || "city", true, { holdLabels: plunge });
      loadFires();
    } else {
      Globe.start();
      if (sceneIsMap) {
        sceneIsMap = false;
        Globe.resetZoom(); // undo the intro plunge in case its fade was cancelled mid-way
        gsap.to("#localmap", { opacity: 0, duration: 0.5, onComplete: () => ($("localmap").hidden = true) }); // or it would catch the globe's clicks
        gsap.to("#globe", { opacity: 1, duration: 0.6 });
      }
      // closer, centred view of a region; default to North America the first time
      if (GLOBE_REGION_TABS.includes(name) && !explored) focusRegion(showScene.region || "44,-98,2.6");
    }
    $("regions").hidden = !GLOBE_REGION_TABS.includes(name) || !globeOK;
  }

  // ---------- live render ----------
  function applySky(s) {
    const sky = s.sky || {};
    const haze = hazeOf(sky);
    sound.setWind(sky.wind_speed);
    if (!globeOK) return;
    Globe.setSky({ haze, wind: sky.wind_speed, night: sky.is_day === 0, cloud: sky.cloud_cover });
    // EARTH is global context, so the PHS beacon shows its AQI category there, not the classroom verdict
    Globe.setVerdictColor(activeTab === "explore" ? LocalSky.aqiCategory(sky.us_aqi).color : s.verdict.color);
  }

  function render(s) {
    latest = s;
    const v = s.verdict, sky = s.sky || {}, ind = s.indoor || {}, cl = s.clarity || {};
    appEl.style.setProperty("--verdict", v.color);
    $("verdict-label").textContent = v.label;
    $("reasons").innerHTML = v.reasons.map((r) => `<li>${r}</li>`).join("");
    $("event").textContent = s.event ? `AI EVENT CLASSIFIER › ${s.event.toUpperCase()}` : "";
    $("clock").textContent = s.replay ? "REPLAY " + s.replay.clock : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    $("aqi").textContent = fmt(sky.us_aqi);
    const cat = LocalSky.aqiCategory(sky.us_aqi);
    $("aqi-cat").textContent = cat.label;
    $("aqi-cat").style.setProperty("--c", cat.color);
    renderAlert(s, sky, cat);
    $("pm25").textContent = fmt(sky.pm2_5, 1, " µg/m³");
    $("aod").textContent = sky.aod == null ? "–" : `${sky.aod.toFixed(2)} ${sky.aod > 0.7 ? "SMOKY" : sky.aod > 0.3 ? "HAZY" : "CLEAR"}`;
    $("haze").textContent = cl.haze_transmission == null ? "NIGHT" : fmt(cl.haze_transmission, 0, "%");
    $("wind-text").textContent = sky.wind_dir == null ? "–" : `${fmt(sky.wind_speed, 0)} KM/H ${s.wind_compass}`;
    $("stale").textContent = ind.warming_up ? "…" : fmt(ind.stale_index);
    $("stale-bar").style.width = (ind.stale_index || 0) + "%";
    $("rate").textContent = `${ind.rate_per_min > 0 ? "▲" : ind.rate_per_min < 0 ? "▼" : "•"} ${fmt(Math.abs(ind.rate_per_min || 0), 0)}/MIN`;
    $("air").textContent = ind.air == null ? "SIMULATED" : `${fmt(ind.air, 0)} / BASE ${fmt(ind.baseline, 0)}`;
    // During a replay the server drops model_clarity (2023 model sunlight ignores the smoke) -> show haze instead
    const [clar, src] = cl.sensor_clarity != null ? [cl.sensor_clarity, "SENSOR"]
      : cl.model_clarity != null ? [cl.model_clarity, "MODEL"] : [cl.haze_transmission, "THROUGH HAZE"];
    $("clarity").textContent = cl.daylight ? `${fmt(clar, 0, "%")} ${src}` : "NIGHT";

    // weather at PHS
    const w = LocalSky.describeWeather(sky.weather_code);
    $("wx-cond").textContent = `${w.icon} ${w.text}`;
    $("wx-temp").textContent = `${fmt(sky.temperature, 0, "°")} / ${fmt(sky.feels_like, 0, "°C")}`;
    $("wx-hum").textContent = fmt(sky.humidity, 0, "%");
    $("wx-wind").textContent = sky.wind_speed == null ? "–" : `${fmt(sky.wind_speed, 0)}/${fmt(sky.wind_gusts, 0)} km/h ${s.wind_compass}`;
    $("wx-rain").textContent = fmt(sky.precipitation, 1, " mm");
    renderFireLine(s.fires);

    // LOCAL: the Raspberry Pi inside the school vs the air outside
    $("pi-label").textContent = s.mock ? "INSIDE · SIMULATED SENSOR" : "INSIDE · RASPBERRY PI";
    $("local-scope").textContent = !serverMode ? "NO DEVICE (SHOWCASE)" : s.mock ? "ROOM SENSOR SIMULATED" : "ROOM SENSOR LIVE";
    $("pi-stale").textContent = ind.warming_up ? "…" : fmt(ind.stale_index);
    $("pi-trend").textContent = $("rate").textContent;
    $("pi-air").textContent = ind.air == null ? "SIMULATED" : `${fmt(ind.air, 0)} (BASE ${fmt(ind.baseline, 0)})`;
    $("pi-light").textContent = ind.light == null ? "–" : fmt(ind.light, 0);
    $("pi-status").textContent = !serverMode ? "NO DEVICE (SHOWCASE)" : ind.warming_up ? "WARMING UP" : s.mock ? "MOCK SENSORS" : "LIVE";
    $("po-aqi").textContent = fmt(sky.us_aqi);
    $("po-cat").textContent = cat.label;
    $("po-cat").style.setProperty("--c", cat.color);
    $("po-wx").textContent = `${w.icon} ${w.text} ${fmt(sky.temperature, 0, "°C")}`;
    $("po-wind").textContent = $("wx-wind").textContent;
    LocalMap.updateDevice({ color: v.color, verdict: v.label, mock: s.mock || !serverMode,
      inside: ind.warming_up ? "WARMING UP" : `STALE ${fmt(ind.stale_index)}/100 ${ind.rate_per_min > 0 ? "▲" : ind.rate_per_min < 0 ? "▼" : "•"}`,
      aqi: fmt(sky.us_aqi), cat: cat.short || cat.label, catColor: cat.color, weather: `${w.icon} ${fmt(sky.temperature, 0, "°C")}` });

    // sky tab
    $("ozone").textContent = fmt(sky.ozone, 0, " µg/m³");
    $("clouds").textContent = fmt(sky.cloud_cover, 0, "%");
    $("uv").textContent = fmt(sky.uv_index, 1);
    $("sun-el").textContent = fmt(cl.sun_elevation, 0, "°");
    $("clear-sky").textContent = fmt(cl.clear_sky_wm2, 0, " W/m²");
    $("temp").textContent = fmt(sky.temperature, 1, " °C");
    $("wind-big").textContent = sky.wind_dir == null ? "–" : `${fmt(sky.wind_speed, 0)} km/h from ${s.wind_compass}`;
    $("wind-arrow").style.transform = `rotate(${((sky.wind_dir ?? 0) + 180) % 360}deg)`;

    // status + ticker
    const chip = $("mode-chip");
    chip.className = "chip mono" + (s.replay ? " replay" : serverMode && !s.mock ? " live" : "");
    chip.textContent = s.replay ? `REPLAY ${s.replay.clock}` : serverMode ? (s.mock ? "DEVICE · MOCK SENSORS" : "DEVICE LIVE") : "SHOWCASE MODE";
    const tick = `AQI ${fmt(sky.us_aqi)} · PM2.5 ${fmt(sky.pm2_5, 1)} · AOD ${fmt(sky.aod, 2)} · WIND ${s.wind_compass} ${fmt(sky.wind_speed, 0)} KM/H · ${v.label}`;
    $("foot-ticker").textContent = tick + (sky.stale ? ` · OFFLINE, SKY DATA ${fmt(s.sky_age_min, 0)} MIN OLD` : "");

    qa(".server-only").forEach((e) => (e.hidden = !serverMode));
    qa(".mock-only").forEach((e) => (e.hidden = !s.mock));

    if (!explored) applySky(s);
    if (activeTab === "sky") renderForecast(sky);
  }

  // EPA guidance for each AQI category (airnow.gov)
  const EPA_ADVICE = [null, null,
    "People with asthma, heart or lung disease, children, older adults and teens should limit long or heavy outdoor exertion.",
    "Everyone should reduce long or heavy outdoor exertion. Sensitive groups should avoid it.",
    "Everyone should avoid long or heavy outdoor exertion. Sensitive groups should stay indoors.",
    "Health warning: everyone should avoid all outdoor exertion."];

  function renderFireLine(f) {
    const el = $("fire-line");
    if (!f || !f.available) { el.textContent = serverMode ? "FIRES: LOADING NASA SATELLITE DATA…" : ""; el.className = "mono fireline"; return; }
    el.className = "mono fireline" + (f.smoke_risk ? " risk" : "");
    el.textContent = `🔥 NASA FIRE DETECTIONS (7 DAYS): ${f.within_50km} WITHIN 50 KM · ${f.within_100km} WITHIN 100 KM · ` +
      (f.upwind_count ? `${f.upwind_count} UPWIND${f.smoke_risk ? " · SMOKE COULD DRIFT IN" : " (SMALL)"}` : "NONE UPWIND RIGHT NOW");
  }

  function renderAlert(s, sky, cat) {
    const el = $("alert");
    if (s.replay) {
      el.className = "alert mono historical";
      el.innerHTML = `<b>HISTORICAL REPLAY</b> · ${s.replay.label.toUpperCase()} · ${s.replay.clock}. THIS IS RECORDED 2023 DATA, NOT CURRENT CONDITIONS.`;
      el.hidden = false;
    } else if (sky.us_aqi != null && cat.level >= 2) {
      const cause = LocalSky.likelyCause(sky);
      el.className = "alert mono";
      el.innerHTML = `<b>⚠ AIR QUALITY ALERT · PRINCETON · AQI ${sky.us_aqi} · ${cat.label}</b>` +
        (cause ? ` · LIKELY CAUSE: ${cause}` : "") + `<br>KEEP WINDOWS SHUT. ${EPA_ADVICE[cat.level].toUpperCase()}`;
      el.hidden = false;
    } else if (s.fires && s.fires.smoke_risk) {
      el.className = "alert mono historical";
      el.innerHTML = `<b>🔥 FIRE WATCH · PHS</b> · NASA SATELLITES DETECT ${s.fires.upwind_count} FIRE HOTSPOTS UPWIND ` +
        `(${s.fires.upwind_frp_150km} MW WITHIN 150 KM). THE AIR IS FINE RIGHT NOW, BUT SMOKE COULD DRIFT IN. WATCH THE VERDICT BEFORE OPENING WINDOWS.`;
      el.hidden = false;
    } else el.hidden = true;
  }

  async function poll() {
    let s;
    try { s = await getState(); }
    catch (e) { $("verdict-label").textContent = "LINKING…"; return; }
    try { render(s); } catch (e) { console.error("render failed", e); } // a UI bug must not hide the verdict
  }

  // ---------- charts ----------
  // Chart.js may be missing (blocked script): skip the charts instead of stopping this script
  const hasChart = typeof Chart !== "undefined";
  if (hasChart) {
    Chart.defaults.color = "#8b95a7";
    Chart.defaults.borderColor = "rgba(255,255,255,0.08)";
    Chart.defaults.font.family = "JetBrains Mono";
    Chart.defaults.font.size = 10;
  }
  let chart, fchart;
  function lineChart(el, datasets, labels) {
    if (!hasChart) return null;
    return new Chart(el, {
      type: "line", data: { labels, datasets },
      options: { animation: false, responsive: true, interaction: { mode: "index", intersect: false },
        elements: { point: { radius: 0 }, line: { borderWidth: 1.5 } },
        plugins: { legend: { labels: { boxWidth: 10, boxHeight: 2 } } }, scales: { x: { ticks: { maxTicksLimit: 6 } } } },
    });
  }
  async function refreshHistory() {
    if (!serverMode || activeTab !== "sky" || !active) return;
    const h = await api("api/history?minutes=60").catch(() => []);
    const labels = h.map((r) => new Date(r.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    const ds = [
      { label: "ROOM STALE", data: h.map((r) => r.stale_index), borderColor: "#c084fc", tension: 0.3 },
      { label: "SKY AQI", data: h.map((r) => r.us_aqi), borderColor: "#60a5fa", tension: 0.3 },
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
    const ds = [
      { label: "AQI", data: sl(f.us_aqi), borderColor: "#60a5fa", tension: 0.3 },
      { label: "HAZE (AOD×100)", data: sl(f.aod).map((x) => (x == null ? null : x * 100)), borderColor: "#ff7a2e", tension: 0.3 },
      { label: "CLOUDS %", data: sl(f.cloud_cover), borderColor: "#94a3b8", borderDash: [3, 3], tension: 0.3 },
    ];
    if (fchart) fchart.destroy();
    fchart = lineChart($("forecast"), ds, sl(f.time).map((t) => t.slice(11, 16)));
  }

  // ---------- announce: read the verdict aloud (ElevenLabs on the device, browser voice otherwise) ----------
  $("btn-announce").onclick = async () => {
    const b = $("btn-announce");
    b.disabled = true;
    try {
      const rep = serverMode ? await api("api/report", {}) : LocalSky.report(latest);
      $("announce-text").textContent = "“" + rep.text + "”";
      if (rep.audio_url) { $("audio").src = rep.audio_url; await $("audio").play().catch(() => {}); }
      else if ("speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(rep.text)); }
    } catch (e) { $("announce-text").textContent = "Couldn't announce: " + e.message; }
    b.disabled = false;
  };

  // ---------- setup ----------
  qa("[data-cal]").forEach((b) => (b.onclick = async () => {
    try { const r = await api("api/calibrate", { what: b.dataset.cal }); b.textContent = "✓ " + Object.entries(r).map(([k, v]) => `${k} ${(+v).toFixed(2)}`).join(" "); }
    catch (e) { alert(e.message); }
  }));
  qa("[data-label]").forEach((b) => (b.onclick = async () => {
    try {
      await api("api/label", { label: b.dataset.label });
      b.dataset.n = (+b.dataset.n || 0) + 1; b.textContent = `${b.dataset.label} (${b.dataset.n})`;
    } catch (e) { alert(e.message); }
  }));
  qa("[data-mock]").forEach((b) => (b.onclick = () => {
    if (serverMode) api("api/mock/" + b.dataset.mock, {}).catch((e) => alert(e.message));
    else if (b.dataset.mock === "spike") LocalSky.spike();
  }));

  // ---------- explore: tap anywhere on Earth ----------
  async function explore(lat, lon, name) {
    explored = { lat, lon };
    if (activeTab !== "explore") selectTab("explore");
    explored = { lat, lon };
    $("explore-card").hidden = false;
    $("x-coords").textContent = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
    $("x-place").textContent = name || "Reading the sky…";
    $("x-status").textContent = "LINKING TO THE ATMOSPHERE…";
    try {
      const r = await LocalSky.skyAt(lat, lon);
      if (!explored || explored.lat !== lat || explored.lon !== lon) return; // user tapped somewhere else meanwhile
      const sky = r.sky, cat = r.category, home = (latest && latest.sky) || {};
      $("x-place").textContent = name || r.place || "Open ocean";
      $("x-here").textContent = (name || r.place || "HERE").split(",")[0].toUpperCase().slice(0, 18);
      $("x-verdict").textContent = sky.us_aqi == null ? "NO DATA" : `AQI ${sky.us_aqi}`;
      $("explore-card").style.setProperty("--x", cat.color);
      $("x-cat").textContent = cat.label + (r.cause ? " · " + r.cause : "");
      $("x-cat").style.setProperty("--c", cat.color);
      const xw = LocalSky.describeWeather(sky.weather_code), hw = LocalSky.describeWeather(home.weather_code);
      const haze = (a) => (a == null ? "–" : `${a.toFixed(2)}${a > 0.7 ? " SMOKY" : a > 0.3 ? " HAZY" : ""}`);
      // [here cell, PHS cell, here text, PHS text, here value, PHS value] (ids spelled out so the hook test can see them)
      const rows = [
        [$("x-aqi"), $("c-aqi"), fmt(sky.us_aqi), fmt(home.us_aqi), sky.us_aqi, home.us_aqi],
        [$("x-pm"), $("c-pm"), fmt(sky.pm2_5, 1), fmt(home.pm2_5, 1), sky.pm2_5, home.pm2_5],
        [$("x-aod"), $("c-aod"), haze(sky.aod), haze(home.aod), sky.aod, home.aod],
        [$("x-cond"), $("c-cond"), `${xw.icon} ${xw.text}`, `${hw.icon} ${hw.text}`],
        [$("x-temp"), $("c-temp"), fmt(sky.temperature, 0, "°C"), fmt(home.temperature, 0, "°C")],
        [$("x-hum"), $("c-hum"), fmt(sky.humidity, 0, "%"), fmt(home.humidity, 0, "%")],
        [$("x-wind"), $("c-wind"), sky.wind_dir == null ? "–" : `${LocalSky.compass(sky.wind_dir)} ${fmt(sky.wind_speed, 0)}`, home.wind_dir == null ? "–" : `${LocalSky.compass(home.wind_dir)} ${fmt(home.wind_speed, 0)}`],
        [$("x-time"), $("c-time"), sky.utc_offset == null ? "–" : new Date(Date.now() + sky.utc_offset * 1000).toISOString().slice(11, 16), new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })],
      ];
      for (const [hereEl, phsEl, here, phs, a, b] of rows) {
        hereEl.textContent = here; phsEl.textContent = phs;
        hereEl.className = a != null && b != null && a !== b ? (a > b ? "worse" : "better") : ""; // red = dirtier than PHS
      }
      $("x-compare").textContent = home.us_aqi && sky.us_aqi != null
        ? (sky.us_aqi > home.us_aqi * 1.1 ? `AIR HERE IS ${(sky.us_aqi / home.us_aqi).toFixed(1)}× THE AQI OVER PHS RIGHT NOW.`
          : sky.us_aqi < home.us_aqi * 0.9 ? `AIR HERE IS CLEANER THAN OVER PHS RIGHT NOW.` : `AIR HERE IS ABOUT THE SAME AS OVER PHS RIGHT NOW.`)
        : "";
      $("x-status").textContent = "TAP ANOTHER SPOT, OR JUMP TO A REGION ABOVE.";
      Globe.dropPin(lat, lon, cat.color);
      const hz = hazeOf(sky);
      Globe.setSky({ haze: hz, wind: sky.wind_speed, night: sky.is_day === 0, cloud: sky.cloud_cover });
      gsap.fromTo("#explore-card", { opacity: 0.4 }, { opacity: 1, duration: 0.5 });
    } catch (e) {
      $("x-status").textContent = "COULDN'T READ THAT SKY (" + e.message + "). TRY AGAIN IN A MOMENT.";
    }
  }

  // ---------- local: analyze any point near PHS ----------
  function kmBetween(a, b, c, d) {
    const p = Math.PI / 180, h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function bearingDeg(a, b, c, d) {
    const p = Math.PI / 180, y = Math.sin((d - b) * p) * Math.cos(c * p);
    const x = Math.cos(a * p) * Math.sin(c * p) - Math.sin(a * p) * Math.cos(c * p) * Math.cos((d - b) * p);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  let localPick = null, firesList = null;
  const CAMPUS_KM = 25;
  LocalMap.onAnalyze(async (lat, lon) => {
    if (!active) return;
    if (activeTab !== "local") { selectTab.keepView = true; selectTab("local"); }
    const [plat, plon] = LocalMap.PHS, km = kmBetween(plat, plon, lat, lon);
    if (km > CAMPUS_KM) {
      localPick = null;
      $("local-card").hidden = true;
      $("local-out").hidden = false;
      $("lo-dist").textContent = `${km.toFixed(0)} KM ${LocalSky.compass(bearingDeg(plat, plon, lat, lon))} OF PHS`;
      $("btn-to-earth").onclick = () => { selectTab("explore"); Globe.flyTo(lat, lon); explore(lat, lon); };
      $("btn-to-earth").hidden = !globeOK;
      return;
    }
    $("local-out").hidden = true;
    localPick = { lat, lon };
    $("local-card").hidden = false;
    $("l-coords").textContent = `${lat.toFixed(3)}°, ${lon.toFixed(3)}° · ${km < 1 ? "AT PHS" : km.toFixed(1) + " KM " + LocalSky.compass(bearingDeg(plat, plon, lat, lon)) + " OF PHS"}`;
    $("l-place").textContent = "Reading the air…";
    $("l-around").textContent = "Scanning OpenStreetMap for roads, parks and industry nearby (can take ~10 s)…";
    $("l-fire").textContent = "…";
    const same = () => localPick && localPick.lat === lat && localPick.lon === lon;
    // surroundings come from a separate (slower) OpenStreetMap query, so they fill in on their own
    LocalSky.surroundings(lat, lon).then((a) => {
      if (!same()) return;
      const road = a.nearestRoad;
      $("l-around").innerHTML =
        (road ? `Nearest major road: <b>${road.name}</b> ~${Math.round(road.m / 10) * 10} m away` + (a.roadNames.length > 1 ? ` (also ${a.roadNames.slice(1).join(", ")})` : "") + "." : "No major roads within 1 km.") +
        ` <b>${a.green}</b> parks/green areas, <b>${a.industrial}</b> industrial areas, <b>${a.schools}</b> schools.` +
        (road && road.m < 200 ? ` <span class="risk">Within 200 m of a major road, traffic pollution (NO₂, fine particles) is usually higher than the model grid shows.</span>` : "");
    }).catch((e) => { if (same()) $("l-around").textContent = "OpenStreetMap lookup unavailable right now (" + e.message + ")."; });

    // nearest NASA fire detection (from the list the Pi downloaded)
    if (firesList && firesList.length) {
      const near = firesList.map((f) => ({ ...f, d: kmBetween(lat, lon, f.lat, f.lon) })).sort((a, b) => a.d - b.d)[0];
      $("l-fire").innerHTML = `<b>${near.d.toFixed(1)} km ${LocalSky.compass(bearingDeg(lat, lon, near.lat, near.lon))}</b> of this spot, ` +
        `detected ${near.date} (${near.frp} MW, ${near.confidence} confidence). ` +
        `${firesList.filter((f) => kmBetween(lat, lon, f.lat, f.lon) <= 25).length} detections within 25 km in the last 7 days.`;
    } else $("l-fire").textContent = serverMode ? "No fire detections loaded." : "Fire data comes from the SkyWindow device. Open the site from the Pi to see it.";

    try {
      const r = await LocalSky.skyAt(lat, lon);
      if (!same()) return;
      const sky = r.sky, v = r.verdict, w = LocalSky.describeWeather(sky.weather_code);
      $("l-place").textContent = r.place || "Selected point";
      $("l-verdict").textContent = v.label;
      $("local-card").style.setProperty("--x", v.color);
      $("l-cat").textContent = r.category.label + (r.cause ? " · " + r.cause : "");
      $("l-cat").style.setProperty("--c", r.category.color);
      $("l-aqi").textContent = fmt(sky.us_aqi);
      $("l-pm").textContent = fmt(sky.pm2_5, 1);
      $("l-pm10").textContent = fmt(sky.pm10, 1);
      $("l-o3").textContent = fmt(sky.ozone, 0);
      $("l-no2").textContent = fmt(sky.no2, 1);
      $("l-so2").textContent = fmt(sky.so2, 1);
      $("l-co").textContent = fmt(sky.co, 0);
      $("l-aod").textContent = fmt(sky.aod, 2);
      $("l-uv").textContent = fmt(sky.uv_index, 1);
      $("l-cond").textContent = `${w.icon} ${w.text}`;
      $("l-temp").textContent = `${fmt(sky.temperature, 0, "°")} / ${fmt(sky.feels_like, 0, "°C")}`;
      $("l-hum").textContent = fmt(sky.humidity, 0, "%");
      $("l-dew").textContent = fmt(sky.dew_point, 0, "°C");
      $("l-wind").textContent = `${LocalSky.compass(sky.wind_dir)} ${fmt(sky.wind_speed, 0)}/${fmt(sky.wind_gusts, 0)} km/h`;
      $("l-rain").textContent = fmt(sky.precipitation, 1, " mm");
      $("l-press").textContent = fmt(sky.pressure, 0, " hPa");
      $("l-vis").textContent = sky.visibility == null ? "–" : (sky.visibility / 1000).toFixed(1) + " km";
      $("l-elev").textContent = fmt(sky.elevation, 0, " m");
      LocalMap.setPickColor(r.category.color);
      gsap.fromTo("#local-card", { opacity: 0.4 }, { opacity: 1, duration: 0.4 });
    } catch (e) { $("l-place").textContent = "Couldn't read this spot (" + e.message + ")"; }
  });
  qa("[data-layer]").forEach((b) => (b.onclick = () => {
    b.classList.toggle("on");
    LocalMap.toggle(b.dataset.layer, b.classList.contains("on"));
  }));
  qa("[data-base]").forEach((b) => (b.onclick = () => {
    qa("[data-base]").forEach((x) => x.classList.toggle("on", x === b));
    LocalMap.setBase(b.dataset.base);
  }));
  qa("[data-view]").forEach((b) => (b.onclick = () => LocalMap.view(b.dataset.view)));

  async function loadFires() {
    if (!serverMode) {
      $("fire-summary").textContent = "Satellite fire data is fetched by the SkyWindow device. Open this site from the Pi (http://<pi-ip>:8000) to see recent fires near PHS.";
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
        (n ? ` Nearest: <b>${n.km} km ${LocalSky.compass(n.bearing)}</b> on ${n.date} (${n.frp} MW).` : "") +
        ` Largest nearby fire: ${f.largest_frp} MW.<br>` +
        (f.smoke_risk ? `<span class="risk">Upwind right now: ${f.upwind_count} detections, ${f.upwind_frp_150km} MW within 150 km. Smoke could drift toward PHS.</span>`
          : f.upwind_count ? `Upwind right now: ${f.upwind_count} small detections. Not enough to expect smoke.` : "None are upwind of PHS right now.");
      loadFires.done = true;
    } catch (e) { $("fire-summary").textContent = "NASA fire data unavailable right now (" + e.message + ")."; }
  }

  // ---------- world now: live AQI for major cities ----------
  async function loadWorld() {
    try {
      const list = await LocalSky.worldNow();
      if (globeOK) Globe.setCities(list);
      const phs = list.find((c) => c.name.startsWith("Princeton"));
      const cats = [["GOOD", "#22c55e"], ["MODERATE", "#eab308"], ["SENSITIVE", "#f97316"], ["UNHEALTHY", "#ef4444"], ["VERY UNHEALTHY", "#a855f7"], ["HAZARDOUS", "#9f1239"]];
      const counts = cats.map((_, lvl) => list.filter((c) => c.category.level === lvl).length);
      $("dist-bar").innerHTML = counts.map((n, k) => n ? `<div style="width:${100 * n / list.length}%;background:${cats[k][1]}" title="${cats[k][0]}: ${n}"></div>` : "").join("");
      $("dist-legend").innerHTML = counts.map((n, k) => n ? `<span style="--c:${cats[k][1]}">${cats[k][0]} ${n}</span>` : "").join("");
      const sorted = list.map((c) => c.us_aqi).sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
      $("world-summary").textContent = `${list.length} CITIES · MEDIAN AQI ${median}.` + (phs ? ` PHS: AQI ${phs.us_aqi} (${phs.category.label}), ${phs.us_aqi <= median ? "CLEANER THAN" : "WORSE THAN"} THE TYPICAL CITY RIGHT NOW.` : "") +
        " SOURCE: CAMS ATMOSPHERIC MODEL VIA OPEN-METEO, UPDATED HOURLY. MODEL ESTIMATES CAN DIFFER FROM LOCAL GROUND MONITORS (SEE AIRNOW.GOV FOR STATION READINGS).";
      $("world-time").textContent = "UPDATED " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      $("world-time").textContent = "WORLD DATA UNAVAILABLE (" + e.message + ")";
    }
  }

  function focusRegion(spec) {
    showScene.region = spec;
    const [lat, lon, dist] = spec.split(",").map(Number);
    qa("[data-region]").forEach((x) => x.classList.toggle("on", x.dataset.region === spec));
    Globe.flyTo(lat, lon, 1.6, dist);
  }
  qa("[data-region]").forEach((b) => (b.onclick = () => focusRegion(b.dataset.region)));

  if (typeof Globe !== "undefined") Globe.onPick((lat, lon) => { if (active && !$("hud").hidden) explore(lat, lon); });

  return {
    prepare, enter, exit, hide, scene,
    /** the map's ground width (km) and its wide view, for the story's dive to match */
    mapWidthKm: () => LocalMap.widthKm(),
    mapWide: (duration = 0) => LocalMap.wide(duration),
    get active() { return active; },
    /** what the logo ("back to the story") does */
    onExit(fn) { exitHandler = fn; },
    /** the shell's sound engine: { toggle(), on(), setWind(kmh) } */
    useSound(s) { sound = { ...sound, ...s }; syncSound(); },
  };
})();
window.SkyApp = SkyApp;
