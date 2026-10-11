#!/usr/bin/env bash
# Download and compress the high-resolution assets for the 3D story (web/index.html).
# Needs macOS (sips), python3, curl and node (npx @gltf-transform/cli). Run from the repo root:
#     bash scripts/fetch_story_assets.sh
# Downloads are cached in .cache/story-assets/ (git-ignored); outputs go to web/assets/.
#
# Sources and licenses:
#   NASA Blue Marble Next Generation (Oct 2004), Black Marble 2016, Blue Marble clouds, GEBCO_08 elevation via
#   NASA Earth Observatory: NASA imagery, no copyright. NASA SVS Deep Star Maps 2020: NASA/Goddard SVS.
#   HYG star database v4.1: CC BY-SA 4.0 (astronexus.com). Poly Haven models, textures, HDRI: CC0.
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=.cache/story-assets
OUT=web/assets
mkdir -p "$CACHE"/{nasa,ph,stars} "$OUT"/textures/{earth,room} "$OUT"/models/room "$OUT"/hdri "$OUT"/data
UA="SkyWindow hackPHS 2026 (scripts/fetch_story_assets.sh)"
get() { [ -s "$2" ] || { echo "  downloading $(basename "$2")"; curl -fsSL -A "$UA" -o "$2.part" "$1" && mv "$2.part" "$2"; }; }
resize() { sips -s format jpeg -s formatOptions "$4" -z "$3" "$2" "$1" --out "$5" >/dev/null; } # resize <src> <w> <h> <quality> <dst>

echo "== Earth (NASA)"
EO=https://assets.science.nasa.gov/content/dam/science/esd/eo/images
get "$EO/bmng/bmng-topography-bathymetry/october/world.topo.bathy.200410.3x21600x10800.jpg" "$CACHE/nasa/day.jpg"
get "$EO/imagerecords/144000/144898/BlackMarble_2016_3km.jpg" "$CACHE/nasa/night.jpg"
get "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif" "$CACHE/nasa/clouds.tif"
get "$EO/bmng/topography/gebco_08_rev_elev_5400x2700.jpg" "$CACHE/nasa/elev.jpg"
for s in 8192:4096:8k 4096:2048:4k; do
  IFS=: read -r w h tag <<<"$s"
  resize "$CACHE/nasa/day.jpg" "$w" "$h" 84 "$OUT/textures/earth/day_$tag.jpg"
  resize "$CACHE/nasa/night.jpg" "$w" "$h" 82 "$OUT/textures/earth/night_$tag.jpg"
done
resize "$CACHE/nasa/clouds.tif" 4096 2048 82 "$OUT/textures/earth/clouds_4k.jpg"
resize "$CACHE/nasa/elev.jpg" 4096 2048 88 "$OUT/textures/earth/elevation_4k.jpg"

echo "== Sky: NASA SVS Deep Star Maps 2020 (Milky Way glow) + HYG catalogue (point stars)"
get "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_4k.exr" "$CACHE/stars/starmap_4k.exr"
sips -s format jpeg -s formatOptions 90 "$CACHE/stars/starmap_4k.exr" --out "$CACHE/stars/starmap_4k.jpg" >/dev/null
# keep only the soft Milky Way glow (point stars come from the HYG catalogue): area-average down, median out the
# stars, blur, then enlarge bicubically. Needs Pillow (sips enlarges nearest-neighbour, which leaves blocks).
python3 - "$CACHE/stars/starmap_4k.jpg" "$OUT/textures/earth/milkyway_glow.jpg" <<'PY2'
import sys
from PIL import Image, ImageFilter
small = Image.open(sys.argv[1]).convert("RGB").resize((512, 256), Image.BOX)
small = small.filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
small.resize((2048, 1024), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2.5)).save(sys.argv[2], quality=90, subsampling=0)
PY2
get "https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv" "$CACHE/stars/hyg.csv"
python3 - "$CACHE/stars/hyg.csv" "$OUT/data/stars.json" <<'PY'
import csv, json, sys
rows = []
with open(sys.argv[1], newline="") as f:
    for r in csv.DictReader(f):
        try:
            mag = float(r["mag"])
        except ValueError:
            continue
        if r["proper"] == "Sol" or mag > 6.6:
            continue
        ci = float(r["ci"]) if r["ci"] not in ("", None) else 0.6
        rows.append([round(float(r["ra"]), 4), round(float(r["dec"]), 3), round(mag, 2), round(ci, 2)])
json.dump({"source": "HYG v4.1 (CC BY-SA 4.0, astronexus.com)", "fields": ["ra_hours", "dec_deg", "mag", "b_v"], "stars": rows},
          open(sys.argv[2], "w"), separators=(",", ":"))
print(f"  stars.json: {len(rows)} stars to magnitude 6.6")
PY

echo "== Classroom textures + HDRI (Poly Haven, CC0)"
ph_tex() { # id outname
  local json; json=$(curl -fsSL -A "$UA" "https://api.polyhaven.com/files/$1")
  for m in Diffuse nor_gl arm; do
    local url; url=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d['$m']['1k']['jpg']['url'])" "$json")
    get "$url" "$CACHE/ph/$1_$m.jpg"
    cp "$CACHE/ph/$1_$m.jpg" "$OUT/textures/room/$2_$m.jpg"
  done
}
ph_tex old_linoleum_flooring_01 floor
ph_tex beige_wall_001 wall
ph_tex ceiling_interior ceiling
ph_tex red_brick_03 brick
ph_tex grass_ground grass
ph_tex wood_table_001 wood
HDR=$(curl -fsSL -A "$UA" https://api.polyhaven.com/files/school_hall | python3 -c "import json,sys; print(json.load(sys.stdin)['hdri']['1k']['hdr']['url'])")
get "$HDR" "$OUT/hdri/school_hall_1k.hdr"

echo "== Classroom models (Poly Haven, CC0) -> meshopt + WebP GLB"
MODELS="SchoolDesk_01 SchoolChair_01 metal_office_desk classic_laptop desk_lamp_arm_01 office_notepads wall_clock metal_trash_can steel_frame_shelves_01 book_encyclopedia_set_01 binder_notebook drawer_cabinet cardboard_box_01 calathea_orbifolia_01 planter_pot_clay projector_screen stationery_supplies fire_alarm"
for id in $MODELS; do
  dir="$CACHE/ph/$id"; mkdir -p "$dir"
  out="$OUT/models/room/$id.glb"
  [ -s "$out" ] && continue
  json=$(curl -fsSL -A "$UA" "https://api.polyhaven.com/files/$id")
  python3 - "$json" "$dir" <<'PY' | while read -r url path; do mkdir -p "$(dirname "$path")"; get "$url" "$path"; done
import json, sys, os
d = json.loads(sys.argv[1])["gltf"]["1k"]["gltf"]
print(d["url"], os.path.join(sys.argv[2], os.path.basename(d["url"])))
for rel, inc in d.get("include", {}).items():
    print(inc["url"], os.path.join(sys.argv[2], rel))
PY
  gltf=$(ls "$dir"/*.gltf | head -1)
  npx -y @gltf-transform/cli@4.1.1 optimize "$gltf" "$out" --compress meshopt --texture-compress webp --texture-size 1024 >/dev/null 2>&1 \
    || npx -y @gltf-transform/cli@4.1.1 optimize "$gltf" "$out" --compress meshopt --texture-size 1024 >/dev/null
  echo "  $id.glb $(du -h "$out" | cut -f1)"
done

echo "== done"; du -sh "$OUT"/textures/earth "$OUT"/textures/room "$OUT"/models/room "$OUT"/hdri "$OUT"/data/stars.json
