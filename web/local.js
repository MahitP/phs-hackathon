// Close-up map (Leaflet), shared by three tabs:
//   NOW         -> "city":   Princeton with the SkyWindow device marker
//   PHS CAMPUS  -> "school": the school grounds (official OpenStreetMap outline)
//   2023 RECORD -> "nj":     New Jersey only - everything outside the state border is masked
// One small control on the map works the same in every view: recenter, satellite/map, fires.
// Base layers need no API keys: Esri World Imagery + Esri reference labels, or OpenStreetMap tiles.
const LocalMap = (() => {
  const PHS = [40.3587, -74.656];
  let map, sat, osm, labels, fireLayer, campusLayer, njMask, smoke, pickMarker, deviceMarker;
  let onAnalyze = () => {}, ready = false, mode = "city", base = "sat", firesOn = true;
  let campusRing = null, njRing = null, njBounds = null;

  function init(el) {
    if (ready) return;
    ready = true;
    map = L.map(el, { zoomControl: false, worldCopyJump: true, zoomSnap: 0.5 }).setView(PHS, 6);
    sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    });
    const ref = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/";
    labels = L.layerGroup([
      L.tileLayer(ref + "World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.8 }),
      L.tileLayer(ref + "World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
    ]);
    osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "osm-dark",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    sat.addTo(map); labels.addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    addControl();

    fireLayer = L.layerGroup().addTo(map);
    campusLayer = L.layerGroup().addTo(map);
    deviceMarker = L.marker(PHS, {
      icon: L.divIcon({ className: "device-pin", html: '<span class="pulse"></span><span class="core"></span>', iconSize: [22, 22] }),
      zIndexOffset: 1000,
    }).addTo(map);
    deviceMarker.bindTooltip("SkyWindow · Princeton High School", { permanent: true, direction: "right", offset: [14, 0], className: "device-tip" });
    map.on("click", (e) => { if (mode !== "nj") analyze(e.latlng.lat, e.latlng.lng); });
    loadShapes();
  }

  async function loadShapes() {
    try {
      const [campus, nj] = await Promise.all([fetch("geo/phs_campus.json").then((r) => r.json()), fetch("geo/nj.json").then((r) => r.json())]);
      campusRing = campus.geometry.coordinates[0].map(([x, y]) => [y, x]);
      L.polygon(campusRing, { color: "#86efac", weight: 2, dashArray: "6 4", fillColor: "#22c55e", fillOpacity: 0.08, interactive: false })
        .addTo(campusLayer);
      njRing = nj.geometry.coordinates[0][0].map(([x, y]) => [y, x]);
      njBounds = L.latLngBounds(njRing);
      const world = [[-89, -179.9], [-89, 179.9], [89, 179.9], [89, -179.9]];
      njMask = L.polygon([world, njRing], { stroke: false, fillColor: "#05070c", fillOpacity: 0.82, interactive: false });
      smoke = L.polygon(njRing, { color: "#ff9a5a", weight: 1.5, fillColor: "#ff7a2e", fillOpacity: 0, interactive: false });
      if (mode === "nj") view("nj", false);
    } catch (e) { console.warn("map shapes failed", e); }
  }

  /** Is (lat, lon) on the PHS school grounds (official OSM outline)? Ray-casting point-in-polygon. */
  function onCampus(lat, lon) {
    if (!campusRing) return false;
    let inside = false;
    for (let i = 0, j = campusRing.length - 1; i < campusRing.length; j = i++) {
      const [yi, xi] = campusRing[i], [yj, xj] = campusRing[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ---- the one universal control: recenter / satellite-map / fires ----
  let ctl;
  function addControl() {
    const C = L.Control.extend({
      onAdd() {
        const d = L.DomUtil.create("div", "map-ctl mono");
        d.innerHTML = '<button data-c="center" title="Recenter">⌖ RECENTER</button>' +
          '<button data-c="base" title="Switch satellite / map">MAP</button>' +
          '<button data-c="fires" class="on" title="NASA satellite fire detections, last 7 days">🔥 FIRES</button>';
        L.DomEvent.disableClickPropagation(d);
        d.onclick = (e) => {
          const btn = e.target.closest("button");
          const c = btn && btn.dataset.c;
          if (c === "center") view(mode);
          if (c === "base") setBase(base === "sat" ? "map" : "sat");
          if (c === "fires") { firesOn = !firesOn; firesOn ? fireLayer.addTo(map) : map.removeLayer(fireLayer); btn.classList.toggle("on", firesOn); }
        };
        return d;
      },
    });
    ctl = new C({ position: "bottomright" }).addTo(map);
  }
  function setBase(kind) {
    base = kind;
    if (kind === "map") { map.removeLayer(sat); map.removeLayer(labels); osm.addTo(map); }
    else { map.removeLayer(osm); sat.addTo(map); labels.addTo(map); }
    ctl.getContainer().querySelector('[data-c="base"]').textContent = kind === "map" ? "SATELLITE" : "MAP";
  }

  /** Live device card next to the PHS marker. */
  function updateDevice(d) {
    if (!ready) return;
    const el = deviceMarker.getElement();
    if (el) el.style.setProperty("--v", d.color);
    deviceMarker.setTooltipContent(
      `<div class="dt-title">SKYWINDOW · PHS</div>` +
      `<div class="dt-verdict" style="color:${d.color}">${d.verdict}</div>` +
      `<div class="dt-row"><span>${d.insideLabel || "INSIDE " + (d.mock ? "(SIMULATED)" : "(RASPBERRY PI)")}</span><b>${d.inside}</b></div>` +
      `<div class="dt-row"><span>OUTSIDE AQI</span><b style="color:${d.catColor}">${d.aqi} ${d.cat}</b></div>` +
      `<div class="dt-row"><span>WEATHER</span><b>${d.weather}</b></div>`);
  }

  function setFires(fires) {
    if (!ready) return;
    fireLayer.clearLayers();
    for (const f of fires) {
      const r = Math.max(4, Math.min(14, 3 + Math.sqrt(f.frp) * 1.6));
      L.circleMarker([f.lat, f.lon], { radius: r, color: "#ff8a3d", weight: 1, fillColor: "#ff5a1f", fillOpacity: 0.65 })
        .bindTooltip(`🔥 Satellite fire detection<br>${f.date} ${f.time.slice(0, 2)}:${f.time.slice(2)} UTC · ${f.frp} MW · ${f.confidence}<br>${f.km} km from PHS`, { direction: "top" })
        .addTo(fireLayer);
    }
  }

  function analyze(lat, lon) {
    if (pickMarker) pickMarker.setLatLng([lat, lon]);
    else pickMarker = L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 2, fillOpacity: 0 }).addTo(map);
    onAnalyze(lat, lon);
  }
  function setPickColor(color) { if (pickMarker) pickMarker.setStyle({ color }); }

  function padding() { return innerWidth > 900 ? [Math.min(620, innerWidth * 0.45), 60] : [0, 60]; }
  function bottomPad() { return innerWidth > 900 ? [20, 40] : [20, innerHeight * 0.5]; } // phone: panel docked at bottom

  /** "city" (Princeton), "school" (PHS grounds) or "nj" (New Jersey only, locked). */
  function view(kind, fly = true) {
    mode = kind;
    map.invalidateSize();
    const nj = kind === "nj";
    // 2023 RECORD shows recorded history only: no live fires or campus extras; New Jersey masked + locked
    [njMask, smoke].forEach((l) => l && (nj ? l.addTo(map) : map.removeLayer(l)));
    if (nj) { map.removeLayer(fireLayer); map.removeLayer(campusLayer); if (pickMarker) map.removeLayer(pickMarker); }
    else { campusLayer.addTo(map); if (firesOn) fireLayer.addTo(map); if (pickMarker) pickMarker.addTo(map); }
    ctl.getContainer().querySelector('[data-c="fires"]').hidden = nj;
    const opts = { paddingTopLeft: padding(), paddingBottomRight: bottomPad() };
    if (nj) {
      const b = njBounds || L.latLngBounds([38.93, -75.56], [41.36, -73.89]);
      map.setMaxBounds(null); map.setMinZoom(0);
      map.fitBounds(b, opts);
      map.setMinZoom(map.getZoom());
      map.setMaxBounds(b.pad(0.08));
      return;
    }
    map.setMaxBounds(null); map.setMinZoom(0);
    const radius = kind === "school" ? 300 : 1800; // metres around PHS kept in view
    const b = L.latLng(PHS).toBounds(radius * 2);
    const o = { ...opts, maxZoom: kind === "school" ? 18 : 15 };
    fly ? map.flyToBounds(b, { ...o, duration: kind === "city" ? 3 : 1.6 }) : map.fitBounds(b, o);
  }

  /** Smoke haze over New Jersey for the replayed hour: 0..1 */
  function setSmoke(level) { if (smoke) smoke.setStyle({ fillOpacity: Math.min(0.55, level * 0.6) }); }

  return { init, view, updateDevice, setFires, analyze, setPickColor, setSmoke, onCampus,
    isLocked: () => mode === "nj", onAnalyze: (cb) => (onAnalyze = cb), invalidate: () => ready && map.invalidateSize(), PHS };
})();
