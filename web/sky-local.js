// Showcase mode: when the page is opened without the Raspberry Pi (e.g. a judge's phone or a
// static host), we fetch the same Open-Meteo data directly from the browser and simulate the
// room sensor, producing the same state shape as GET /api/now.
// Verdict thresholds mirror server/decide.py - keep them in sync.
const LocalSky = (() => {
  const LAT = 40.3587, LON = -74.656;
  const VERDICTS = {
    open: ["OPEN THE WINDOW", "#16a34a"], either: ["EITHER WAY", "#d97706"],
    shut: ["KEEP IT SHUT", "#dc2626"], ventilate: ["VENTILATE NOW", "#9333ea"],
  };
  let sky = null, fetchedAt = 0, stale = 18, spikeUntil = 0, lastIdx = 18, lastT = Date.now();
  let replay = null; // {hours, start}
  let replayData = null;
  let lastVerdict = null; // hysteresis, as on the Pi

  const qs = (o) => new URLSearchParams(o).toString();
  async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); }
  // the weather is optional: the verdict runs on the air. If the weather API is down or rate-limited
  // (it allows 10,000 calls a day per address), carry on with the last weather we had, or none.
  let lastWx = null;
  const NO_WX = { current: {}, hourly: {} };
  const weather = (url) => getJSON(url).then((w) => (lastWx = w)).catch(() => lastWx || NO_WX);

  async function fetchSky() {
    if (sky && Date.now() - fetchedAt < 600000) return;
    const base = { latitude: LAT, longitude: LON, timezone: "auto", forecast_days: 2 };
    const [aq, wx] = await Promise.all([
      getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({ ...base,
        current: "us_aqi,pm2_5,pm10,ozone,dust,aerosol_optical_depth,uv_index", hourly: "us_aqi,pm2_5,aerosol_optical_depth" })),
      weather("https://api.open-meteo.com/v1/forecast?" + qs({ ...base,
        current: WX_NOW + ",shortwave_radiation",
        hourly: "cloud_cover,wind_direction_10m,wind_speed_10m,temperature_2m,precipitation_probability" })),
    ]);
    const c = { ...aq.current, ...wx.current };
    sky = { time: c.time, us_aqi: c.us_aqi, pm2_5: c.pm2_5, pm10: c.pm10, ozone: c.ozone, dust: c.dust,
      aod: c.aerosol_optical_depth, uv_index: c.uv_index, ...weatherOf(c), cloud_cover: c.cloud_cover,
      wind_speed: c.wind_speed_10m, wind_dir: c.wind_direction_10m, radiation: c.shortwave_radiation, is_day: c.is_day,
      forecast: { time: aq.hourly.time, us_aqi: aq.hourly.us_aqi, pm2_5: aq.hourly.pm2_5, aod: aq.hourly.aerosol_optical_depth,
        cloud_cover: wx.hourly.cloud_cover, wind_dir: wx.hourly.wind_direction_10m,
        temperature: wx.hourly.temperature_2m, precip_prob: wx.hourly.precipitation_probability },
      source: "live", stale: false };
    fetchedAt = Date.now();
  }

  // ---- weather ----
  const WX_NOW = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover," +
    "wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day";
  function weatherOf(c) {
    return { temperature: c.temperature_2m, feels_like: c.apparent_temperature, humidity: c.relative_humidity_2m,
      precipitation: c.precipitation, weather_code: c.weather_code, wind_gusts: c.wind_gusts_10m };
  }
  // WMO weather interpretation codes (as used by Open-Meteo)
  const WMO = { 0: ["Clear sky", "☀"], 1: ["Mainly clear", "🌤"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁"],
    45: ["Fog", "🌫"], 48: ["Freezing fog", "🌫"], 51: ["Light drizzle", "🌦"], 53: ["Drizzle", "🌦"], 55: ["Heavy drizzle", "🌧"],
    56: ["Freezing drizzle", "🌧"], 57: ["Freezing drizzle", "🌧"], 61: ["Light rain", "🌦"], 63: ["Rain", "🌧"], 65: ["Heavy rain", "🌧"],
    66: ["Freezing rain", "🌧"], 67: ["Freezing rain", "🌧"], 71: ["Light snow", "🌨"], 73: ["Snow", "🌨"], 75: ["Heavy snow", "❄"],
    77: ["Snow grains", "🌨"], 80: ["Rain showers", "🌦"], 81: ["Rain showers", "🌧"], 82: ["Violent showers", "⛈"],
    85: ["Snow showers", "🌨"], 86: ["Heavy snow showers", "❄"], 95: ["Thunderstorm", "⛈"], 96: ["Thunderstorm, hail", "⛈"], 99: ["Thunderstorm, hail", "⛈"] };
  function describeWeather(code) { const w = WMO[code]; return w ? { text: w[0], icon: w[1] } : { text: "–", icon: "" }; }

  /** Model AQI on an n x n grid around (lat, lon), one request. step in degrees. */
  async function aqiGrid(lat, lon, n = 7, step = 0.15) {
    const pts = [];
    const half = (n - 1) / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push([lat + (i - half) * step, lon + (j - half) * step * 1.3]);
    const rows = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({
      latitude: pts.map((p) => p[0].toFixed(3)).join(","), longitude: pts.map((p) => p[1].toFixed(3)).join(","), current: "us_aqi,pm2_5" }));
    return pts.map(([a, b], k) => ({ lat: a, lon: b, us_aqi: ((rows[k] || {}).current || {}).us_aqi, pm2_5: ((rows[k] || {}).current || {}).pm2_5,
      dlat: step, dlon: step * 1.3 }));
  }

  // ---- live world snapshot: ~40 major cities in one Open-Meteo request ----
  const CITIES = [
    ["Delhi", 28.61, 77.21], ["Lahore", 31.55, 74.34], ["Dhaka", 23.81, 90.41], ["Kolkata", 22.57, 88.36],
    ["Mumbai", 19.08, 72.88], ["Karachi", 24.86, 67.01], ["Kathmandu", 27.72, 85.32], ["Beijing", 39.90, 116.40],
    ["Shanghai", 31.23, 121.47], ["Chengdu", 30.57, 104.07], ["Seoul", 37.57, 126.98], ["Tokyo", 35.68, 139.69],
    ["Jakarta", -6.21, 106.85], ["Bangkok", 13.76, 100.50], ["Hanoi", 21.03, 105.85], ["Manila", 14.60, 120.98],
    ["Singapore", 1.35, 103.82], ["Sydney", -33.87, 151.21], ["Cairo", 30.04, 31.24], ["Lagos", 6.52, 3.38],
    ["Kinshasa", -4.44, 15.27], ["Johannesburg", -26.20, 28.05], ["Nairobi", -1.29, 36.82], ["Riyadh", 24.71, 46.68],
    ["Dubai", 25.20, 55.27], ["Tehran", 35.69, 51.39], ["Istanbul", 41.01, 28.98], ["Moscow", 55.76, 37.62],
    ["London", 51.51, -0.13], ["Paris", 48.86, 2.35], ["Berlin", 52.52, 13.40], ["Madrid", 40.42, -3.70],
    ["New York", 40.71, -74.01], ["Los Angeles", 34.05, -118.24], ["Chicago", 41.88, -87.63], ["Toronto", 43.65, -79.38],
    ["Mexico City", 19.43, -99.13], ["São Paulo", -23.55, -46.63], ["Lima", -12.05, -77.04], ["Bogotá", 4.71, -74.07],
    ["Buenos Aires", -34.60, -58.38], ["Santiago", -33.45, -70.67], ["Princeton (PHS)", 40.3587, -74.656],
  ];
  let world = null, worldAt = 0;

  /** Official U.S. EPA AQI categories. */
  function aqiCategory(aqi) {
    // colors: the EPA category fills used across the dashboard's data bars and globe dots
    if (aqi == null) return { label: "NO DATA", color: "#5B636B", level: -1 };
    if (aqi <= 50) return { label: "GOOD", color: "#4AA969", level: 0 };
    if (aqi <= 100) return { label: "MODERATE", color: "#E5C14A", level: 1 };
    if (aqi <= 150) return { label: "UNHEALTHY FOR SENSITIVE GROUPS", short: "SENSITIVE", color: "#E48233", level: 2 };
    if (aqi <= 200) return { label: "UNHEALTHY", color: "#C44134", level: 3 };
    if (aqi <= 300) return { label: "VERY UNHEALTHY", color: "#733893", level: 4 };
    return { label: "HAZARDOUS", color: "#6A1D30", level: 5 };
  }

  /** Best guess at what is dirtying the air, from the same model data. */
  function likelyCause(s) {
    if (s.dust != null && s.dust > 80) return "DESERT DUST";
    if (s.aod != null && s.aod > 0.6) return "SMOKE / HAZE";
    if (s.pm2_5 != null && s.pm2_5 > 35) return "FINE PARTICLES";
    if (s.ozone != null && s.ozone > 140) return "OZONE SMOG";
    return null;
  }

  async function worldNow(force = false) {
    if (world && !force && Date.now() - worldAt < 600000) return world;
    const rows = await getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({
      latitude: CITIES.map((c) => c[1]).join(","), longitude: CITIES.map((c) => c[2]).join(","),
      current: "us_aqi,pm2_5,ozone,dust,aerosol_optical_depth" }));
    world = CITIES.map(([name, lat, lon], i) => {
      const c = (rows[i] || {}).current || {};
      const s = { us_aqi: c.us_aqi, pm2_5: c.pm2_5, ozone: c.ozone, dust: c.dust, aod: c.aerosol_optical_depth };
      return { name, lat, lon, ...s, category: aqiCategory(s.us_aqi), cause: likelyCause(s) };
    }).filter((c) => c.us_aqi != null);
    worldAt = Date.now();
    return world;
  }

  /** Current sky anywhere on Earth (used by the EARTH and PHS CAMPUS tabs). */
  async function skyAt(lat, lon) {
    const base = { latitude: lat.toFixed(3), longitude: lon.toFixed(3), timezone: "auto" };
    const [aq, wx, place] = await Promise.all([
      getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({ ...base,
        current: "us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust,aerosol_optical_depth,uv_index" })),
      getJSON("https://api.open-meteo.com/v1/forecast?" + qs({ ...base, current: WX_NOW + ",dew_point_2m,surface_pressure,visibility" })).catch(() => NO_WX),
      placeName(lat, lon),
    ]);
    const c = { ...aq.current, ...wx.current };
    const s = { us_aqi: c.us_aqi, pm2_5: c.pm2_5, ozone: c.ozone, dust: c.dust, aod: c.aerosol_optical_depth,
      uv_index: c.uv_index, ...weatherOf(c), cloud_cover: c.cloud_cover, wind_speed: c.wind_speed_10m,
      wind_dir: c.wind_direction_10m, is_day: c.is_day, local_time: c.time, utc_offset: wx.utc_offset_seconds,
      pm10: c.pm10, no2: c.nitrogen_dioxide, so2: c.sulphur_dioxide, co: c.carbon_monoxide,
      dew_point: c.dew_point_2m, pressure: c.surface_pressure, visibility: c.visibility, elevation: wx.elevation };
    // sun angle at that spot right now -> how much of the sunbeam gets through its haze
    const elev = solarElevationAt(lat, lon, new Date()), cz = Math.sin(elev * Math.PI / 180);
    s.haze_transmission = elev > 3 && s.aod != null ? Math.round(100 * Math.exp(-s.aod / cz)) : null;
    return { lat, lon, place, sky: s, verdict: decide(0, 0, s), category: aqiCategory(s.us_aqi), cause: likelyCause(s) };
  }

  /** Place name from OpenStreetMap's Nominatim (open data, ODbL). */
  async function placeName(lat, lon) {
    try {
      const r = await getJSON("https://nominatim.openstreetmap.org/reverse?" + qs({ lat: lat.toFixed(5), lon: lon.toFixed(5), format: "jsonv2", zoom: 16 }));
      if (r.error) return null; // open water etc.
      const a = r.address || {};
      const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
      const first = r.name || a.road || a.neighbourhood || a.suburb;
      return [...new Set([first, town, a.state || a.country].filter(Boolean))].slice(0, 3).join(", ");
    } catch { return null; }
  }

  /** What's around a point, from OpenStreetMap via the Overpass API (open data, ODbL). */
  async function surroundings(lat, lon, radius = 1000) {
    const around = `(around:${radius},${lat.toFixed(5)},${lon.toFixed(5)})`;
    const q = `[out:json][timeout:20];(` +
      `way${around}[highway~"^(motorway|trunk|primary|secondary)$"];` +
      `way${around}[leisure~"^(park|nature_reserve)$"];way${around}[landuse~"^(forest|meadow|recreation_ground)$"];way${around}[natural=wood];` +
      `way${around}[landuse=industrial];way${around}[amenity~"^(school|college|university)$"];node${around}[amenity~"^(school|college|university)$"];` +
      `);out center tags;`;
    const els = await overpass(q);
    const dist = (e) => { const c = e.center || e; return c.lat == null ? Infinity : kmApprox(lat, lon, c.lat, c.lon) * 1000; };
    const roads = els.filter((e) => e.tags.highway).map((e) => ({ name: e.tags.ref || e.tags.name || e.tags.highway, type: e.tags.highway, m: dist(e) }))
      .sort((a, b) => a.m - b.m);
    const green = els.filter((e) => e.tags.leisure || e.tags.natural || ["forest", "meadow", "recreation_ground"].includes(e.tags.landuse));
    const industrial = els.filter((e) => e.tags.landuse === "industrial");
    const schools = els.filter((e) => /school|college|university/.test(e.tags.amenity || ""));
    return { radius, roads, nearestRoad: roads[0] || null, roadNames: [...new Set(roads.map((r) => r.name))].slice(0, 4),
      green: green.length, industrial: industrial.length, schools: schools.length };
  }
  // public Overpass servers; the main one sometimes times out under load, so fall back to mirrors
  // (only servers that allow browser requests; the main one answers in ~3-12 s)
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  async function overpass(q) {
    let last;
    for (const url of OVERPASS) {
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: ctl.signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        clearTimeout(t);
        if (r.ok) return (await r.json()).elements || [];
        last = new Error(r.status);
      } catch (e) { last = e.name === "AbortError" ? new Error("timeout") : e; }
    }
    throw last;
  }

  function kmApprox(a, b, c, d) {
    const p = Math.PI / 180, h = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  async function smokeDay() {
    if (replayData) return replayData;
    try { return (replayData = await getJSON("smoke_day_2023.json")); } catch { /* fall back to Open-Meteo */ }
    const p = { latitude: LAT, longitude: LON, start_date: "2023-06-07", end_date: "2023-06-07", timezone: "America/New_York" };
    const [aq, wx] = await Promise.all([
      getJSON("https://air-quality-api.open-meteo.com/v1/air-quality?" + qs({ ...p, hourly: "us_aqi,pm2_5,pm10,ozone,dust,aerosol_optical_depth,uv_index" })),
      getJSON("https://archive-api.open-meteo.com/v1/archive?" + qs({ ...p, hourly: "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,shortwave_radiation" })),
    ]);
    const A = aq.hourly, W = wx.hourly;
    replayData = { label: "Smoke Day - June 7, 2023 (Princeton, NJ)", hours: A.time.map((t, i) => ({
      time: t, us_aqi: A.us_aqi[i], pm2_5: A.pm2_5[i], pm10: A.pm10[i], ozone: A.ozone[i], dust: A.dust[i],
      aod: A.aerosol_optical_depth[i], uv_index: A.uv_index[i], temperature: W.temperature_2m[i], cloud_cover: W.cloud_cover[i],
      wind_speed: W.wind_speed_10m[i], wind_dir: W.wind_direction_10m[i], radiation: W.shortwave_radiation[i] })) };
    return replayData;
  }

  function solarElevation(date) { return solarElevationAt(LAT, LON, date); }

  function solarElevationAt(LAT, LON, date) {
    const doy = Math.floor((date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5);
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
    const g = 2 * Math.PI / 365 * (doy - 1 + (hour - 12) / 24);
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const ha = ((hour * 60 + eq + 4 * LON) / 4 - 180) * Math.PI / 180, lat = LAT * Math.PI / 180;
    const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) * 180 / Math.PI;
  }

  function clarity(s, when) {
    const elev = solarElevation(when), cz = Math.sin(elev * Math.PI / 180);
    const clear = elev > 0 ? 1098 * cz * Math.exp(-0.057 / cz) : 0;
    return { sun_elevation: Math.round(elev * 10) / 10, clear_sky_wm2: Math.round(clear), daylight: elev > 3, sensor_clarity: null,
      model_clarity: clear > 50 && s.radiation != null ? Math.round(Math.min(100, 100 * s.radiation / clear)) : null,
      haze_transmission: elev > 3 && s.aod != null ? Math.round(100 * Math.exp(-s.aod / cz)) : null };
  }

  // hysteresis margins (server HYST); index margin is already in index units
  const HYST = { aqi: 5, pm2_5: 3.0, aod: 0.05, index: 10 };

  function outdoorLevel(s, prev) {
    if (!s) return ["unknown", "no sky data"];
    const aqi = s.us_aqi, pm = s.pm2_5, aod = s.aod, cat = aqiCategory(aqi).label.toLowerCase();
    const bad = prev === "bad" ? 1 : 0, mod = prev === "bad" || prev === "moderate" ? 1 : 0;
    if ((aqi != null && aqi > 100 - bad * HYST.aqi) || (pm != null && pm > 35.4 - bad * HYST.pm2_5))
      return ["bad", `outdoor AQI ${aqi} (${cat}), PM2.5 ${pm} ug/m3`];
    if (aod != null && aod > 0.7 - bad * HYST.aod) return ["bad", `heavy haze overhead (aerosol optical depth ${aod})`];
    if (aqi != null && aqi > 50 - mod * HYST.aqi) return ["moderate", `outdoor AQI ${aqi} (moderate)`];
    return ["good", `outdoor AQI ${aqi} (${cat})`];
  }

  /** Mirrors server/decide.py decide(); `fires` is the FIRMS summary, `prev` the last verdict (hysteresis). */
  function decide(idx, rate, s, { fires = null, prev = null } = {}) {
    const prevKey = prev ? prev.key : null;
    const [level, why] = outdoorLevel(s, prev ? prev.outdoor_level : null);
    const rising = rate > 40 * 100 / 250; // server SPIKE_RATE is in sensor units; we work in index units
    const spike = rising || idx >= 70 - (prevKey === "ventilate" ? HYST.index : 0);
    const stale = idx >= 40 - (prevKey === "open" ? HYST.index : 0);
    const reasons = [why, `indoor stale index ${idx}/100` + (rising ? " (rising fast!)" : "")];
    let key;
    if (level === "bad") { key = "shut"; if (spike) reasons.push("indoor spike too - run a purifier or fan instead of opening the window"); }
    else if (spike) key = "ventilate";
    else if (level === "good") {
      key = "open";
      reasons.push(idx >= 25 ? "your room is staler than the sky - let it in" : "both sides are clean - fresh air is a bonus");
    } else if (level === "moderate" && stale) {
      key = "open";
      reasons.push("your room is staler than the moderate sky - air it out for a few minutes");
    } else {
      key = "either";
      if (level === "moderate") reasons.push("inside and outside are about the same");
    }
    // NASA satellite fire detections upwind: the air is measured clean now, but smoke could arrive
    if (fires && fires.smoke_risk) {
      reasons.push(`${fires.upwind_count} satellite fire detections upwind (${fires.upwind_frp_150km} MW within 150 km) - smoke could drift in`);
      if (key === "open") key = "either";
    }
    return { key, label: VERDICTS[key][0], color: VERDICTS[key][1], reasons, stale_index: idx, outdoor_level: level };
  }

  function compass(d) { return d == null ? "?" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((d % 360) / 45) % 8]; }

  async function state() {
    await fetchSky();
    // simulated room: slow stale build-up, spikes on demand
    const now = Date.now(), dt = (now - lastT) / 1000; lastT = now;
    stale = Math.min(60, stale + dt * 0.01);
    let idx = stale;
    if (now < spikeUntil) idx += 80 * Math.sin(Math.PI * Math.min(1, (spikeUntil - now) / 20000));
    idx = Math.round(Math.max(0, Math.min(100, idx)));
    const rate = (idx - lastIdx) / Math.max(dt / 60, 1e-3); lastIdx = idx;

    let s = sky, info = null, when = new Date();
    if (replay) {
      const i = 8 + Math.floor((now - replay.start) / 4000);
      if (i >= replay.hours.length) replay = null;
      else {
        const h = replay.hours[i];
        s = { ...h, is_day: i >= 6 && i <= 20 ? 1 : 0, source: "replay", stale: false,
          forecast: { time: replay.hours.map((x) => x.time), us_aqi: replay.hours.map((x) => x.us_aqi),
            pm2_5: replay.hours.map((x) => x.pm2_5), aod: replay.hours.map((x) => x.aod),
            cloud_cover: replay.hours.map((x) => x.cloud_cover), wind_dir: replay.hours.map((x) => x.wind_dir) } };
        info = { label: replayData.label, clock: h.time.slice(11, 16), index: i, total: replay.hours.length };
        when = new Date(h.time + ":00-04:00");
      }
    }
    const verdict = decide(idx, rate, s, { prev: lastVerdict }); lastVerdict = verdict;
    return { verdict, sky: s, clarity: clarity(s, when), replay: info, event: null, mock: true,
      indoor: { air: null, light: null, baseline: null, rate_per_min: Math.round(rate), stale_index: idx, warming_up: false },
      wind_compass: compass(s.wind_dir), sky_age_min: Math.round((now - fetchedAt) / 6000) / 10, voice_enabled: false,
      last_report: null, showcase: true };
  }

  function report(st) {
    const s = st.sky, words = { N: "north", NE: "northeast", E: "east", SE: "southeast", S: "south", SW: "southwest", W: "west", NW: "northwest", "?": "an unknown direction" };
    const advice = { open: "the air outside is cleaner than in here, so open the windows.",
      either: "inside and outside air are about the same, so windows are your call.",
      shut: "the sky is hazy with pollution, so please keep the windows shut.",
      ventilate: "the air in this room just spiked, so ventilate right away." }[st.verdict.key];
    return { text: `SkyWindow update: ${advice} Outdoor air quality index is ${s.us_aqi}. Winds are ${Math.round(s.wind_speed)} kilometers per hour from the ${words[st.wind_compass]}.`,
      engine: "showcase template", audio_url: null, at: Date.now() / 1000 };
  }

  return {
    state, report, smokeDay, compass, skyAt, worldNow, aqiCategory, likelyCause, describeWeather, aqiGrid, surroundings, solarElevation,
    verdictFor: (s) => decide(0, 0, s), // outdoor-only verdict, used by the replay scrubber
    decide, // full verdict: decide(idx, ratePerMin, sky, {fires, prev}), same rules as server/decide.py
    spike() { spikeUntil = Date.now() + 20000; },
    async startReplay() { const d = await smokeDay(); replay = { hours: d.hours, start: Date.now() }; },
    stopReplay() { replay = null; },
    get replaying() { return !!replay; },
  };
})();
