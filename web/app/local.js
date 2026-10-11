// Close-up map of Princeton (Leaflet). Used as the NOW tab's city view and the LOCAL tab's school view.
// The story's Earth dives into it at zoom 6 (wide()), then it flies down to the city.
// The SkyWindow device marker at PHS shows the Raspberry Pi's live INSIDE reading next to the outside air,
// and the dashed outline is the official PHS school grounds (OpenStreetMap).
// One small control on the map works the same in every view: recenter, satellite/map, fires.
// Base layers (no API keys): Esri World Imagery + Esri reference labels, or OpenStreetMap tiles.
const LocalMap = (() => {
  const PHS = [40.3587, -74.656];
  let map, sat, dark, labels, fireLayer, campusLayer, pickMarker, deviceMarker, onAnalyze = () => {}, ready = false;
  let mode = "city", base = "sat", firesOn = true, campusRing = null, ctl = null;

  function init(el) {
    if (ready) return;
    ready = true;
    map = L.map(el, { zoomControl: false, worldCopyJump: true, zoomSnap: 0.5 }).setView(PHS, 6);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    });
    // keyless reference overlays on top of the imagery: roads + place names (Esri)
    const ref = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/";
    labels = L.layerGroup([
      L.tileLayer(ref + "World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.8 }),
      L.tileLayer(ref + "World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19 }),
    ]);
    // MAP view: OpenStreetMap's own tiles (open data, ODbL), darkened with a CSS filter to match the site
    dark = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "osm-dark",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    sat.addTo(map); labels.addTo(map);
    addControl();

    fireLayer = L.layerGroup().addTo(map);
    campusLayer = L.layerGroup().addTo(map);

    deviceMarker = L.marker(PHS, {
      icon: L.divIcon({ className: "device-pin", html: '<span class="pulse"></span><span class="core"></span>', iconSize: [22, 22] }),
      zIndexOffset: 1000,
    }).addTo(map);
    deviceMarker.bindTooltip("SkyWindow · Princeton High School", { permanent: true, direction: "right", offset: [14, 0], className: "device-tip" });

    map.on("click", (e) => analyze(e.latlng.lat, e.latlng.lng));
    loadCampus();
  }

  async function loadCampus() {
    try {
      const campus = await fetch("geo/phs_campus.json").then((r) => r.json());
      campusRing = campus.geometry.coordinates[0].map(([x, y]) => [y, x]);
      L.polygon(campusRing, { color: "#86efac", weight: 2, dashArray: "6 4", fillColor: "#22c55e", fillOpacity: 0.08, interactive: false })
        .addTo(campusLayer);
    } catch (e) { console.warn("campus outline failed", e); }
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

  // ---- the one map control: recenter / satellite-map / fires ----
  function addControl() {
    const C = L.Control.extend({
      onAdd() {
        const d = L.DomUtil.create("div", "map-ctl mono");
        d.innerHTML = '<button data-c="center" title="Recenter on PHS">⌖ RECENTER</button>' +
          '<button data-c="base" title="Switch satellite / map">MAP</button>' +
          '<button data-c="fires" class="on" aria-pressed="true" title="NASA satellite fire detections, last 7 days">🔥 FIRES</button>';
        L.DomEvent.disableClickPropagation(d);
        d.onclick = (e) => {
          const btn = e.target.closest("button");
          const c = btn && btn.dataset.c;
          if (c === "center") view(mode);
          if (c === "base") setBase(base === "sat" ? "map" : "sat");
          if (c === "fires") {
            firesOn = !firesOn;
            firesOn ? fireLayer.addTo(map) : map.removeLayer(fireLayer);
            btn.classList.toggle("on", firesOn); btn.setAttribute("aria-pressed", String(firesOn));
          }
        };
        return d;
      },
    });
    ctl = new C({ position: "bottomright" }).addTo(map);
  }

  /** Live device card next to the PHS marker: inside (Raspberry Pi) vs outside. */
  function updateDevice(d) {
    if (!ready) return;
    const el = deviceMarker.getElement();
    if (el) el.style.setProperty("--v", d.color);
    deviceMarker.setTooltipContent(
      `<div class="dt-title">SKYWINDOW · PHS</div>` +
      `<div class="dt-verdict" style="color:${d.color}">${d.verdict}</div>` +
      `<div class="dt-row"><span>${d.insideLabel || "INSIDE " + (d.mock ? "(DEV MODE)" : "(RASPBERRY PI)")}</span><b>${d.inside}</b></div>` +
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

  /** Fly to a view of PHS: "city" (Princeton, ~zoom 13) or "school" (the building, ~zoom 17).
   *  hold: keep the place names and roads out of the flight, and fade them in on arrival */
  function view(kind, fly = true, { holdLabels: hold = false } = {}) {
    mode = kind;
    map.invalidateSize();
    if (hold && fly) { holdLabels(true); map.once("moveend", () => holdLabels(false)); }
    else holdLabels(false);
    const radius = kind === "school" ? 300 : 1800; // metres around PHS kept in view
    const opts = { paddingTopLeft: padding(), paddingBottomRight: bottomPad(), maxZoom: kind === "school" ? 18 : 15 };
    const b = L.latLng(PHS).toBounds(radius * 2);
    fly ? map.flyToBounds(b, { ...opts, duration: kind === "city" ? 3 : 1.6 }) : map.fitBounds(b, opts);
  }

  function setBase(kind) {
    base = kind;
    if (kind === "map") { map.removeLayer(sat); map.removeLayer(labels); dark.addTo(map); }
    else { map.removeLayer(dark); sat.addTo(map); labels.addTo(map); }
    ctl.getContainer().querySelector('[data-c="base"]').textContent = kind === "map" ? "SATELLITE" : "MAP";
  }

  /** place names and roads off (instantly) or back on (fading): Leaflet blows them up mid-zoom */
  function holdLabels(on) {
    labels.getLayers().forEach((l, i) => {
      const c = l.getContainer();
      if (c) c.style.transition = on ? "none" : "opacity .8s ease";
      l.setOpacity(on ? 0 : i === 0 ? 0.8 : 1);
    });
  }

  /** The wide view the globe hands over to: PHS in the centre at zoom 6, without labels (the next view
   *  brings them back). With a duration it flies there (resolves when it arrives); without one it jumps. */
  function wide(duration = 0) {
    if (!ready) return Promise.resolve();
    map.invalidateSize(); map.stop();
    holdLabels(true);
    if (!duration) { map.setView(PHS, 6, { animate: false }); return Promise.resolve(); }
    return new Promise((res) => { map.once("moveend", res); map.flyTo(PHS, 6, { duration }); setTimeout(res, duration * 1000 + 500); });
  }
  /** Ground width across the map right now, in km (at PHS's latitude). */
  function widthKm() {
    if (!ready) return null;
    const b = map.getBounds();
    return map.distance([PHS[0], b.getWest()], [PHS[0], b.getEast()]) / 1000;
  }

  return { init, view, wide, widthKm, updateDevice, setFires, analyze, setPickColor, onCampus,
    onAnalyze: (cb) => (onAnalyze = cb), invalidate: () => ready && map.invalidateSize(), PHS };
})();
