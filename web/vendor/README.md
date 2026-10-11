# Bundled third-party files

Served locally so both pages render without internet (e.g. a phone on the Pi's hotspot at judging).
Live data (Open-Meteo, NASA FIRMS, map tiles, OpenStreetMap lookups) still needs a connection; the story
falls back to the last cached reading.

| File | Used by | Source | License |
|---|---|---|---|
| `three/three.module.min.js`, `three/addons/…` (GLTFLoader, RGBELoader, Sky, EffectComposer + passes incl. GTAO, SMAA, Bokeh, UnrealBloom, CSS2DRenderer, OrbitControls, RoomEnvironment, RectAreaLight libs, SimplexNoise, RoundedBoxGeometry, BufferGeometryUtils, meshopt decoder) | 3D story (`index.html`) | three.js 0.169.0, npm | MIT |
| `three.min.js` | dashboard globe (`app.html`) | three.js r128, cdnjs | MIT |
| `gsap.min.js` | both | GSAP 3.13.0, npm | GreenSock Standard License (free, plugins included since 3.13) |
| `lenis.min.js`, `lenis.css` | 3D story smooth scroll | Lenis 1.3.11, npm | MIT |
| `chart.umd.min.js` | dashboard | Chart.js 4.4.1, cdnjs | MIT |
| `leaflet.min.js`, `leaflet.min.css`, `images/` | dashboard | Leaflet 1.9.4, cdnjs | BSD-2-Clause |
| `textures/earth_*` | both | three.js example textures (`examples/textures/planets/`, r169 for `earth_lights_2048.png`) | MIT |
| `fonts/archivo.css`, `fonts/Archivo-*.woff2` | both | Archivo variable (width 62–125, weight 100–900), Google Fonts | SIL Open Font License 1.1 |

Story assets in `web/assets/`:

| File | Source | License |
|---|---|---|
| `models/suomi-npp.glb` | NASA 3D Resources (github.com/nasa/NASA-3D-Resources), pruned and meshopt-compressed with glTF-Transform (2.3 MB → 162 KB) | NASA, free and without copyright |
| `data/princeton.json` | OpenStreetMap via the Overpass API (`scripts/bake_story_data.py`) | ODbL, credited on the page |
| `data/smoke-2023.json` | CAMS atmospheric composition via Open-Meteo, June 6–8, 2023 (`scripts/bake_story_data.py`) | CC BY 4.0 |
| `textures/earth/day_*.jpg` | NASA Blue Marble Next Generation, October 2004, topography + bathymetry (21600 px original, resized to 8K and 4K) | NASA, no copyright |
| `textures/earth/night_*.jpg` | NASA Black Marble 2016 (3 km) | NASA, no copyright |
| `textures/earth/clouds_4k.jpg` | NASA Blue Marble clouds (Visible Earth 57747) | NASA, no copyright |
| `textures/earth/elevation_4k.jpg` | NASA Earth Observatory, GEBCO_08 / BMNG topography | NASA (GEBCO credited) |
| `textures/earth/milkyway_glow.jpg` | NASA/Goddard SVS Deep Star Maps 2020 (4K EXR, blurred to the Milky Way glow) | NASA SVS, credited |
| `data/stars.json` | HYG star database v4.1, stars to magnitude 6.6 | CC BY-SA 4.0 (astronexus.com) |
| `models/room/*.glb`, `textures/room/*`, `hdri/school_hall_1k.hdr` | Poly Haven (polyhaven.com), meshopt + WebP with glTF-Transform | CC0 |

`scripts/fetch_story_assets.sh` downloads and converts all of the above (cached in `.cache/story-assets/`).

To update a library, download the new version into this folder and change nothing else (the HTML points here).
