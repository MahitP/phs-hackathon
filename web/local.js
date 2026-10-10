// Close-up map of Princeton (Leaflet). Used as the NOW tab's city view and the LOCAL tab's school view.
// The SkyWindow device marker at PHS shows the Raspberry Pi's live INSIDE reading next to the outside air.
// Base layers (no API keys): Esri World Imagery + Esri reference labels, or OpenStreetMap tiles.
const LocalMap = (() => {
  const PHS = [40.3587, -74.656];
  let map, sat, dark, labels, gridLayer, fireLayer, pickMarker, deviceMarker, onAnalyze = () => {}, ready = false, gridLoaded = false;

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

    gridLayer = L.layerGroup();
    fireLayer = L.layerGroup().addTo(map);

    deviceMarker = L.marker(PHS, {
      icon: L.divIcon({ className: "device-pin", html: '<span class="pulse"></span><span class="core"></span>', iconSize: [22, 22] }),
      zIndexOffset: 1000,
    }).addTo(map);
    deviceMarker.bindTooltip("SkyWindow · Princeton High School", { permanent: true, direction: "right", offset: [14, 0], className: "device-tip" });

    map.on("click", (e) => analyze(e.latlng.lat, e.latlng.lng));
  }

  /** Live device card next to the PHS marker: inside (Raspberry Pi) vs outside. */
  function updateDevice(d) {
    if (!ready) return;
    const el = deviceMarker.getElement();
    if (el) el.style.setProperty("--v", d.color);
    deviceMarker.setTooltipContent(
      `<div class="dt-title">SKYWINDOW · PHS</div>` +
      `<div class="dt-verdict" style="color:${d.color}">${d.verdict}</div>` +
      `<div class="dt-row"><span>INSIDE ${d.mock ? "(SIMULATED)" : "(RASPBERRY PI)"}</span><b>${d.inside}</b></div>` +
      `<div class="dt-row"><span>OUTSIDE AQI</span><b style="color:${d.catColor}">${d.aqi} ${d.cat}</b></div>` +
      `<div class="dt-row"><span>WEATHER</span><b>${d.weather}</b></div>`);
  }

  async function loadGrid() {
    if (gridLoaded) return;
    gridLoaded = true;
    try {
      const cells = await LocalSky.aqiGrid(PHS[0], PHS[1], 9, 0.12);
      for (const c of cells) {
        if (c.us_aqi == null) continue;
        const cat = LocalSky.aqiCategory(c.us_aqi);
        L.rectangle([[c.lat - c.dlat / 2, c.lon - c.dlon / 2], [c.lat + c.dlat / 2, c.lon + c.dlon / 2]], {
          stroke: false, fillColor: cat.color, fillOpacity: 0.14, interactive: false,
        }).addTo(gridLayer);
        L.marker([c.lat, c.lon], { interactive: false, icon: L.divIcon({ className: "aqi-label", html: c.us_aqi, iconSize: [30, 14] }) }).addTo(gridLayer);
      }
    } catch (e) { gridLoaded = false; console.warn("AQI grid failed", e); }
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

  /** Fly to a view of PHS: "city" (Princeton, ~zoom 13) or "school" (the building, ~zoom 17). */
  function view(kind, fly = true) {
    map.invalidateSize();
    const radius = kind === "school" ? 300 : 1800; // metres around PHS kept in view
    const opts = { paddingTopLeft: padding(), paddingBottomRight: bottomPad(), maxZoom: kind === "school" ? 18 : 15 };
    const b = L.latLng(PHS).toBounds(radius * 2);
    fly ? map.flyToBounds(b, { ...opts, duration: kind === "city" ? 3 : 1.6 }) : map.fitBounds(b, opts);
  }

  function setBase(kind) {
    if (kind === "map") { map.removeLayer(sat); map.removeLayer(labels); dark.addTo(map); }
    else { map.removeLayer(dark); sat.addTo(map); labels.addTo(map); }
  }

  function toggle(layer, on) {
    if (layer === "grid" && on) loadGrid();
    const l = layer === "grid" ? gridLayer : fireLayer;
    on ? l.addTo(map) : map.removeLayer(l);
  }

  return { init, view, setBase, updateDevice, setFires, analyze, setPickColor, toggle,
    onAnalyze: (cb) => (onAnalyze = cb), invalidate: () => ready && map.invalidateSize(), PHS };
})();
