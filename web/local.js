// Close-up map of Princeton (Leaflet), seen through the window panes in the Campus view.
// The SkyWindow device marker at PHS shows the Raspberry Pi's live inside reading next to the outside air.
// Base layers (no API keys): Esri World Imagery + Esri reference labels, or OpenStreetMap tiles.
const LocalMap = (() => {
  const PHS = [40.3587, -74.656];
  let map, sat, dark, labels, gridLayer, fireLayer, pickMarker, deviceMarker, onAnalyze = () => {}, ready = false, gridLoaded = false;
  let pad = null; // [[left, top], [right, bottom]] from the page, so views fit inside the window panes

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
      icon: L.divIcon({ className: "device-pin", iconSize: [30, 30],
        html: '<span class="win"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="#1C2024" stroke-width="1.75" aria-hidden="true"><rect x="3.5" y="2.5" width="13" height="15"/><path d="M3.5 10.5h13M10 2.5v15"/></svg></span>' }),
      zIndexOffset: 1000,
    }).addTo(map);
    deviceMarker.bindTooltip('<span class="dt-title">SkyWindow at PHS</span>Princeton High School', { permanent: true, direction: "top", offset: [0, -20], className: "device-tip" });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    map.on("click", (e) => analyze(e.latlng.lat, e.latlng.lng));
  }

  /** Live device card next to the PHS marker: inside (Raspberry Pi) vs outside. */
  function updateDevice(d) {
    if (!ready) return;
    const el = deviceMarker.getElement();
    if (el) el.style.setProperty("--v", d.color);
    deviceMarker.setTooltipContent(
      `<span class="dt-title">SkyWindow at PHS</span>` +
      `<span class="dt-verdict" style="color:${d.color}">${d.verdict}</span>, AQI ${d.aqi}, room ${d.inside}`);
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
      L.circleMarker([f.lat, f.lon], { radius: r, color: "#9B4805", weight: 1.5, fillColor: "#DD7B2B", fillOpacity: 0.75 })
        .bindTooltip(`<b>Satellite fire detection</b><br>${f.date}, ${f.time.slice(0, 2)}:${f.time.slice(2)} UTC<br>${f.frp} MW, ${f.confidence} confidence, ${f.km} km from PHS`, { direction: "top" })
        .addTo(fireLayer);
    }
  }

  function analyze(lat, lon) {
    if (pickMarker) pickMarker.setLatLng([lat, lon]);
    else pickMarker = L.circleMarker([lat, lon], { radius: 10, color: "#F2F3F0", weight: 3, fillOpacity: 0 }).addTo(map);
    onAnalyze(lat, lon);
  }
  function setPickColor(color) { if (pickMarker) pickMarker.setStyle({ color }); }

  function padding() { return pad ? pad[0] : [0, 60]; }
  function bottomPad() { return pad ? pad[1] : [20, 40]; }

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

  return { init, view, setBase, updateDevice, setFires, analyze, setPickColor, toggle, setPadding: (tl, br) => (pad = [tl, br]),
    onAnalyze: (cb) => (onAnalyze = cb), invalidate: () => ready && map.invalidateSize(), PHS };
})();
