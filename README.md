# ☁️ SkyWindow: *Should I let the sky in?*

**hackPHS 2026 · Theme: "Into the Skies"**

On **June 7, 2023**, wildfire smoke from Canada turned Princeton's sky orange. That day, opening a window was the worst thing you could do. On most other days, opening a window is the best thing you can do for a stuffy room.

**SkyWindow** is a small device that sits on your windowsill. It watches the sky above you and the air in your room, then gives you one clear answer:

| LCD | Verdict | When |
|---|---|---|
| 🟢 | **OPEN THE WINDOW** | The sky is cleaner than your room (clean outdoor air, or moderate outdoor air and a stale room) |
| 🟡 | **EITHER WAY** | Inside and outside are about the same (moderate outdoor air, room not stale) |
| 🔴 | **KEEP IT SHUT** | Smoke, haze, ozone or particles in the sky (AQI > 100, PM2.5 > 35, or heavy haze) |
| 🟣 | **VENTILATE NOW** | Your room just spiked (cleaners, markers, cooking, sanitizer) |

Press **Read it aloud** and it reads the verdict to the classroom: *"SkyWindow update: the sky is hazy with pollution, so please keep the windows shut…"*

## How it connects to the sky

- **The sky above you, live.** We pull outdoor US AQI, PM2.5, ozone, dust, **aerosol optical depth** (how much smoke or haze is in the air column), UV, cloud cover and **wind direction** for our exact location from Open-Meteo, which uses the CAMS atmospheric models.
- **Sunbeam-through-haze meter.** We use the Beer–Lambert law to calculate how much of the direct sunbeam makes it through the aerosols on its slanted path at the current sun angle: `T = exp(−AOD / sin(sun elevation))`. That's about 88% on a clear day with the sun high, and about 5–30% under the 2023 smoke depending on the sun angle.
- **Sky Clarity sensor.** Our light sensor points out the window. After a one-tap calibration, we compare its reading with the theoretical clear-sky sunlight for this exact time and place (Haurwitz model plus solar position). The result shows how much of the sky's light is actually reaching you.
- **Smoke Day replay.** One button replays June 7, 2023 over Princeton using real historical model data (AQI up to 151, aerosol optical depth up to 1.47). The device and dashboard react live, and the dashboard's sky turns orange.

## AI

- **Classroom announcement (GenAI).** Google Gemini turns the live facts into one or two spoken sentences. The facts are the verdict, AQI, haze, wind and the cleanest 2-hour window in the forecast. The prompt only allows facts we pass in, so it can't make up numbers.
- **Voice (ElevenLabs).** The briefing is read aloud by an ElevenLabs voice, in the browser or through the device's own speaker. With `SKYWINDOW_AUTO_ANNOUNCE=1` the device announces every time the verdict changes.
- **Indoor event classifier (trained by us).** We recorded labeled sensor data during the hackathon: normal air, chemicals (hand sanitizer or markers), breath, and a covered light sensor. We trained a random forest (`ml/train.py`) on it. The dashboard shows what it thinks is happening in the room. Accuracy is cross-validated by labeling session, so it isn't inflated by near-identical back-to-back samples. The model and labeled data stay on the device (`ml/model.joblib`, `data/skywindow.db`); run `python ml/train.py` on the Pi after labeling.

Verdict thresholds have hysteresis (for example, KEEP IT SHUT starts above AQI 100 and only ends below 95), so readings that hover around a boundary don't make the LCD or the announcements flip back and forth.

**Honesty note:** the Grove Air Quality v1.3 is a VOC gas sensor with **relative** output. We never call its reading AQI. It becomes a 0–100 "stale index" measured against the room's own clean-air baseline. The outdoor AQI comes from real atmospheric data.

## The website

`web/` has two pages: a 3D story that explains the project (`index.html`, the home page) and the live dashboard (`app.html`).

**The story** is a scroll-driven 3D film in one continuous flight, from 824 km up to a classroom windowsill. It is built with three.js, GSAP and Lenis (all bundled, so it works offline):

1. **Orbit:** the Earth as it is right now, lit by the real sun: NASA Blue Marble imagery for the same month, Black Marble city lights, terrain relief, cloud shadows, ocean sun glint and a ray-marched atmosphere. The stars behind it are the real catalogue, placed by sidereal time. NASA's real **Suomi NPP** 3D model passes the camera, its gold foil reflecting the planet, and its VIIRS camera sweeps the ground below; VIIRS is the source of the NASA FIRMS fire detections SkyWindow reads.
2. **The air:** the actual **June 6–8, 2023 smoke plume** from the CAMS model drifts from Quebec down to New Jersey as you scroll, hour by hour, with the sun of each hour lighting it.
3. **Descent:** a cloud-curtain transition drops you through the clouds.
4. **Princeton:** the town drawn from real OpenStreetMap streets and 3,000 buildings with lit windows and shadows, traffic moving on the real major roads, PHS highlighted, wind lines that follow the **live** wind and the live AQI.
5. **The sunbeam test:** a beam crosses a volumetric smoke layer while the haze rises from **today's reading** to June 7, 2023's 1.44. The Beer–Lambert law dims it live (74% → 9%), and the smoke glows and reddens around the sun.
6. **The window:** you fly over the lawn, through the opening under a sash window in a brick wall, turn around and find the device on the sill. The classroom is a real one: rows of school desks and chairs, the teacher's desk with a laptop and lamp, a whiteboard with an AQI lesson and today's reading, shelves of books, a clock showing the actual time, plants, backpacks and water bottles. Ceiling troffers light it, and the sun falls through the windows and blinds with drifting dust.
7. **The device:** a to-scale 3D model of the real hardware, built from the boards' mechanical drawings: the Raspberry Pi 4 (ports, BCM2711, RAM, ribbon connectors, a blinking ACT LED and hundreds of surface-mount parts on a copper-traced board), the green Grove Base HAT with its 15 sockets, the Grove air-quality and light sensors, the RGB LCD showing the device's real text, the speaker and latched Grove cables. It comes apart into an exploded view.
8. **The verdict:** the window acts out all four verdicts on four real days. The sash slides, the sky changes, the LCD shows the device's real text and colors, and the announcement is read out.
9. **Right now:** the live verdict for PHS and a button into the dashboard.

Scroll snaps to each hero pose. Sound is generated in the browser and follows the real wind. Rendering uses a post-processing chain chosen per device: ambient occlusion, god rays, depth of field, bloom, filmic tone mapping, anti-aliasing and film grain. `scripts/fetch_story_assets.sh` re-downloads and compresses the imagery, star catalogue and classroom models. The story adapts to the device (lighter effects on phones and slower GPUs), respects reduced-motion settings, and becomes a plain text article if WebGL isn't available. `scripts/bake_story_data.py` re-creates the map and smoke data files.

**The live dashboard** is drawn as a classroom sash window, in one typeface (Archivo, bundled in `web/vendor/fonts/`):

- **The panes** show what is outside. On the Now view that is the sky over PHS, rendered from live data: the sun's real position, aerosol optical depth, cloud cover and time of day. A clean noon comes out blue, haze washes it pale, wildfire smoke turns it orange, night is dark.
- **The meeting rail** holds the verdict as one short sentence ("Open the window.", "Either way.", "Keep it shut.", "Ventilate now.") with the reason and a **Read it aloud** button. The word gets wider for open and narrower for shut, letter by letter.
- **The lower sash** rises with the verdict: half open with wind streaks for open, just ajar for either way, sealed for shut, all the way up for ventilate.
- **The sill** carries three readouts, and **two rulers** do the navigation, because distance and time really are scales:
  - Distance: **Window** (PHS right now), **Campus 25 km** (the Leaflet map of the school seen through the panes, with the Raspberry Pi's live inside reading, NASA fires, the model AQI grid and wind; click any spot for its air and weather), **Earth** (the 3D globe with city dots in EPA colors; tap anywhere for a side-by-side comparison with PHS).
  - Time: **June 7, 2023** (the recorded smoke day, hour by hour, clearly labeled as historical, with a button to replay it on the device), **Now**, **Next 24 hours** (three forecast skies, the AQI/haze/cloud chart, wind, sunrise and sunset).
- **How it works** (in the head rail) explains the sensors, the physics and the verdict rules.

Below the window, each view has its full readings: outside vs inside, weather at PHS, NASA fire detections, and Setup and sensor training (calibration and labeling, device only). Generated wind audio follows the real wind speed; it starts with the **Sound off/on** button. The page loads straight into the Now view with skeletons until the first reading, works at phone width, respects reduced motion, and links straight to a view with `app.html#campus`, `#earth`, `#forecast`, `#2023` or `#how`.

**Real alerts:**
- A red banner appears if the air over PHS is actually unhealthy (AQI > 100). It shows the EPA category, the likely cause and the EPA's health guidance.
- A dark banner says how old the data is when the connection drops; the last verdict stays up, grayed and dated.
- An orange **Fire Watch** banner appears if NASA satellites see sizeable fires *upwind* of PHS (≥ 30 MW within 150 km). In that case an "open" verdict becomes "either way", because smoke could drift in.

**Fires (NASA FIRMS):** the Pi downloads the public VIIRS active-fire file every hour and keeps detections within 300 km of PHS, dropping low-confidence points. It works out which ones are upwind from the live wind direction. These detections include small crop and brush burns and some industrial heat sources, so the site reports their size (fire radiative power) and only warns when the upwind fire power is significant.

The site runs in one of two modes:

- **Device mode:** served by the Pi at `http://<pi-ip>:8000/app.html`, using its live sensors.
- **Showcase mode:** opened anywhere without the Pi. For example, serve `web/` from any static host, or run `python -m http.server -d web`. The page fetches the sky straight from Open-Meteo and simulates the room sensor, so judges can try it on their own phones.

## Hardware

- Raspberry Pi with a Grove Base HAT
- Grove Air Quality Sensor v1.3 → **A0**
- Grove Light Sensor → **A2** (facing the window)
- Grove LCD RGB Backlight → **I2C**
- *(optional)* a speaker on the Pi's audio jack or USB for spoken announcements

## Architecture

```
 Grove sensors ──► device/hw.py ─┐
                                 ├─► server/app.py (FastAPI, 1 Hz loop) ──► device/lcd.py (verdict + color)
 Open-Meteo ────► server/sky.py ─┤        │                         └─► web/ dashboard (phone, any browser)
 2023 replay ───► server/replay.py┘        ├─► server/decide.py   (verdict engine)
                                          ├─► server/clarity.py  (sun position, clear-sky, Beer-Lambert)
                                          ├─► server/report.py   (Gemini classroom announcement)
                                          ├─► server/voice.py    (ElevenLabs TTS)
                                          └─► server/store.py    (SQLite history + labels) ──► ml/train.py
```

## Run it

**On the Raspberry Pi:**

```bash
git clone <this repo> ~/skywindow && cd ~/skywindow
bash scripts/setup_pi.sh          # enables I2C, installs deps + grove.py, starts the service on boot
nano .env                         # optional: GEMINI_API_KEY, ELEVENLABS_API_KEY
sudo systemctl restart skywindow
```

Then open `http://<pi-ip>:8000/app.html` (the dashboard) or `http://<pi-ip>:8000` (the story page) on any phone on the same network. The site's libraries, fonts and Earth textures are bundled in `web/vendor/`, so it renders even when the phone has no internet (for example on a Pi hotspot); only the live sky data needs a connection.

Hardware checks:

```bash
python device/hw.py               # live sensor values
python device/lcd.py --test       # cycles the 4 verdict colours
```

**On a laptop (no hardware, simulated sensors):**

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt          # macOS / Linux  (Windows: .venv\Scripts\pip)
.venv/bin/python scripts/dev.py                    # http://localhost:8000 - use the "Mock" buttons under Setup
```

Tests: `.venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest`

### API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/now` | Full live state: verdict, indoor, sky, clarity, replay |
| GET | `/api/history?minutes=60` | Logged readings |
| POST | `/api/report` `{"speak": true}` | Generate the spoken announcement (+ ElevenLabs audio). Repeat requests within 15 s reuse it |
| POST | `/api/replay` `{"on": true}` | Start or stop the Smoke Day replay |
| POST | `/api/calibrate` `{"what": "air"\|"light"}` | Set the clean-air baseline, or calibrate the light sensor to the sky |
| POST | `/api/label` `{"label": "chemical"}` | Record a labeled sample for the classifier |

If `SKYWINDOW_TOKEN` is set in `.env`, every POST needs an `X-SkyWindow-Token` header. Open the dashboard once as `http://<pi-ip>:8000/app.html?token=<token>` and the phone remembers it. Reads stay open.

## What's next

- A second node mounted outside the window, so we measure outdoor air directly instead of relying on the model.
- Wildfire tracking: NASA FIRMS fire detections upwind × wind direction → "smoke arriving in ~3 h" warnings.
- A servo or smart-plug that opens a window vent or turns on a purifier automatically.

## Credits

Sky data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), CAMS air-quality and ERA5 reanalysis.
The dashboard's 3D Earth is adapted from [TerraShift](https://github.com/Flotrpy/TerraShift)'s EarthGlobe (MIT License, Copyright (c) 2026 TerraShift), with NASA Blue Marble imagery from the three.js example textures.
Story imagery: NASA Earth Observatory (Blue Marble Next Generation, Black Marble 2016, Blue Marble clouds, GEBCO/BMNG topography) and NASA/Goddard Scientific Visualization Studio (Deep Star Maps 2020). Star catalogue: [HYG database](https://github.com/astronexus/HYG-Database) v4.1 (CC BY-SA 4.0). Satellite model: NASA 3D Resources. Classroom models, textures and lighting: [Poly Haven](https://polyhaven.com/) (CC0). Map data: © OpenStreetMap contributors (ODbL).
Built in 24 hours at hackPHS 2026.
