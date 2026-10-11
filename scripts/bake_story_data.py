"""Bake the two data files the 3D story (web/index.html) needs, so the site works offline.

    python scripts/bake_story_data.py

- web/assets/data/princeton.json: streets, buildings and water around PHS from OpenStreetMap
  (Overpass API, ODbL - credited on the page), in metres relative to PHS (x east, z south).
- web/assets/data/smoke-2023.json: hourly aerosol optical depth over Quebec to New Jersey for
  June 6-8, 2023 from the CAMS model via Open-Meteo (CC BY 4.0). Shows the smoke plume drifting south.
"""
import json
import math
from pathlib import Path

import requests

LAT, LON = 40.3587, -74.6560
OUT = Path(__file__).resolve().parents[1] / "web" / "assets" / "data"
M_PER_DEG_LAT = 110540
M_PER_DEG_LON = 111320 * math.cos(math.radians(LAT))


def to_xz(lat, lon):
    return round((lon - LON) * M_PER_DEG_LON), round(-(lat - LAT) * M_PER_DEG_LAT)


def simplify(pts, tol=2.0):
    """Ramer-Douglas-Peucker on a list of (x, z) points."""
    if len(pts) < 3:
        return pts
    if pts[0] == pts[-1]:  # closed ring: split at the point farthest from the start, simplify both halves
        k = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
        return simplify(pts[: k + 1], tol)[:-1] + simplify(pts[k:], tol) if 0 < k < len(pts) - 1 else pts
    (x1, z1), (x2, z2) = pts[0], pts[-1]
    dx, dz = x2 - x1, z2 - z1
    norm = math.hypot(dx, dz) or 1
    far, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dz * pts[i][0] - dx * pts[i][1] + x2 * z1 - z2 * x1) / norm
        if d > far:
            far, idx = d, i
    if far <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)


def stitch(ways):
    """Join a relation's outer member ways (lists of {lat, lon}) end to end into closed rings."""
    key = lambda g: (round(g["lat"], 7), round(g["lon"], 7))
    ways, rings = [list(w) for w in ways], []
    while ways:
        ring = ways.pop(0)
        grew = True
        while key(ring[0]) != key(ring[-1]) and grew:
            grew = False
            for i, w in enumerate(ways):
                if key(w[0]) == key(ring[-1]):
                    ring += w[1:]
                elif key(w[-1]) == key(ring[-1]):
                    ring += w[::-1][1:]
                else:
                    continue
                ways.pop(i)
                grew = True
                break
        if key(ring[0]) == key(ring[-1]) and len(ring) >= 4:
            rings.append(ring)
    return rings


def flat(pts):
    return [c for p in pts for c in p]


def bake_princeton():
    s, w, n, e = LAT - 0.034, LON - 0.05, LAT + 0.034, LON + 0.05
    q = f"""[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian)$"]({s},{w},{n},{e});
  way["building"](around:1300,{LAT},{LON});
  relation["building"](around:1300,{LAT},{LON});
  way["natural"="water"]({s},{w},{n},{e});
  way["water"]({s},{w},{n},{e});
  nwr["name"="Princeton High School"](around:900,{LAT},{LON});
);
out geom;"""
    r = requests.post("https://overpass-api.de/api/interpreter", data={"data": q}, timeout=120,
                      headers={"User-Agent": "SkyWindow hackPHS 2026 (bake_story_data.py)"})
    r.raise_for_status()
    major_types = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    out = {"origin": [LAT, LON], "major": [], "minor": [], "buildings": [], "water": [], "phs": []}
    elements = []
    for el in r.json()["elements"]:
        if el["type"] == "relation" and "building" in el.get("tags", {}):
            # multipolygon buildings (like the main PHS building): one footprint per closed outer ring
            for ring in stitch([m["geometry"] for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]):
                elements.append({"geometry": ring, "tags": el["tags"]})
        else:
            elements.append(el)
    for el in elements:
        geom = el.get("geometry")
        if not geom:
            continue
        tags = el.get("tags", {})
        pts = simplify([to_xz(g["lat"], g["lon"]) for g in geom], 1.5 if "building" in tags else 2.5)
        if tags.get("name") == "Princeton High School" and "building" in tags and len(pts) >= 4:
            levels = float(tags.get("building:levels", 3) or 3)
            out["buildings"].append({"h": round(levels * 3.6, 1), "p": flat(pts), "school": 1})
        elif tags.get("name") == "Princeton High School":
            out["phs"].append(flat(pts))
        elif "highway" in tags:
            out["major" if tags["highway"] in major_types else "minor"].append(flat(pts))
        elif "building" in tags and len(pts) >= 4:
            try:
                h = float(str(tags.get("height", "")).replace("m", "").strip())
            except ValueError:
                h = float(tags.get("building:levels", 2) or 2) * 3.2
            out["buildings"].append({"h": round(min(max(h, 3), 40), 1), "p": flat(pts)})
        elif len(pts) >= 4:
            out["water"].append(flat(pts))
    (OUT / "princeton.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"princeton.json: {len(out['major'])} major + {len(out['minor'])} minor roads, "
          f"{len(out['buildings'])} buildings, {len(out['water'])} water, {len(out['phs'])} PHS shapes")


def bake_smoke():
    lats = [37 + i for i in range(17)]          # 37..53 N
    lons = [-82 + i for i in range(19)]         # 82..64 W
    pts = [(la, lo) for la in lats for lo in lons]
    aod = {}
    for i in range(0, len(pts), 60):
        chunk = pts[i:i + 60]
        r = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={
            "latitude": ",".join(str(p[0]) for p in chunk), "longitude": ",".join(str(p[1]) for p in chunk),
            "start_date": "2023-06-06", "end_date": "2023-06-08", "timezone": "America/New_York",
            "hourly": "aerosol_optical_depth"}, timeout=60)
        r.raise_for_status()
        res = r.json()
        res = res if isinstance(res, list) else [res]
        for p, item in zip(chunk, res):
            aod[p] = item["hourly"]["aerosol_optical_depth"]
        times = res[0]["hourly"]["time"]
    # grid[hour][row][col], AOD x100 as integers (row 0 = southernmost latitude)
    grid = [[[round((aod[(la, lo)][h] or 0) * 100) for lo in lons] for la in lats] for h in range(len(times))]
    out = {"lats": lats, "lons": lons, "times": times, "scale": 0.01, "aod": grid,
           "source": "CAMS global atmospheric composition forecasts via Open-Meteo (CC BY 4.0)"}
    (OUT / "smoke-2023.json").write_text(json.dumps(out, separators=(",", ":")))
    peak = max(v for hour in grid for row in hour for v in row) / 100
    print(f"smoke-2023.json: {len(times)} hours x {len(lats)}x{len(lons)} grid, peak AOD {peak}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    bake_smoke()
    bake_princeton()
