# Bundled third-party files

Served locally so the SkyWindow site renders without internet (e.g. phone on a Pi hotspot at judging).
Live data (Open-Meteo, NASA FIRMS, map tiles, OpenStreetMap lookups) still needs a connection.

| File | Source | License |
|---|---|---|
| `three.min.js` | three.js r128, cdnjs | MIT |
| `gsap.min.js` | GSAP 3.12.5, cdnjs | GreenSock Standard License (free) |
| `chart.umd.min.js` | Chart.js 4.4.1, cdnjs | MIT |
| `leaflet.min.js`, `leaflet.min.css`, `images/` | Leaflet 1.9.4, cdnjs | BSD-2-Clause |
| `textures/` | three.js example textures (`threejs.org/examples/textures/planets/`) | three.js repository (MIT) |
| `fonts/` | JetBrains Mono and Inter, latin + latin-ext subsets, Google Fonts | SIL Open Font License 1.1 |

The JS/CSS files match cdnjs's published SHA-512 integrity hashes for those versions. To update one,
download the new version from cdnjs into this folder and change nothing else (index.html points here).
