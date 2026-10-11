# ☁️ SkyWindow: *Should I let the sky in?*

**hackPHS 2026 · Theme: "Into the Skies"** · Built by Mahit's Team

**Try it:** https://mahitp.github.io/phs-hackathon/ (showcase mode: the live sky over Princeton High School and a simulated room sensor, no Raspberry Pi needed). It's published from `main` by `.github/workflows/pages.yml` on every push.

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

**The live dashboard** (`app.html`, reached through the dive from the story):

1. **Now:** after the flight from space, the globe hands off to a close **satellite view of Princeton** with the SkyWindow device marker at PHS. The panel shows the verdict, outside (sky) vs inside (classroom) readings, current weather at PHS (conditions, temperature/feels-like, humidity, wind/gusts, rain), recent fires, the 🔊 Announce button and (on the device) **▶ Replay June 7, 2023**, which makes the Pi relive the 2023 smoke day on its LCD, verdict and voice until you press it again.
2. **PHS Campus** (local, within 25 km): zooms in on **Princeton High School** itself. You get the Raspberry Pi's live inside-the-school readings (stale index, trend, raw air sensor, light at the window, device status) next to the outside air and weather. The device marker on the map carries the same live card. The dashed green outline is the official PHS school grounds (OpenStreetMap). Only clicks inside it count as "on PHS school grounds". Click anywhere within 25 km for that spot's air and weather.

**Map controls:** every map view has the same small control in the corner: recenter, satellite/map and NASA fires.
3. **Forecast — "When can PHS open its windows?"** An hour-by-hour strip for the next 24 hours: weather icon, temperature, AQI, rain chance and a window verdict per hour (open, either, shut for bad air, shut for rain). It also highlights the best daytime window to air out and shows sunrise, sunset, max UV, clouds and ozone. On the device it also charts the last hour of the room vs the sky from the Pi's history. Hourly rules: shut if the forecast AQI is over 100, PM2.5 is over 35 or there's heavy haze; shut if rain is 60%+ likely; open if AQI is 50 or less and it's dry.
4. **Earth** (global context): city dots on the 3D globe in EPA colors, a breakdown of how many of 43 cities are Good, Moderate, Unhealthy and so on, the median AQI, and region jumps, with each city's name and AQI next to its dot. Tap anywhere for a **side-by-side comparison with PHS** (AQI, PM2.5, haze, weather, temperature, humidity, wind, local time). Earth never shows the classroom sensor or a windows verdict. Those belong to PHS Campus, and clicks more than 25 km from PHS on the campus map are sent to Earth.

The June 7, 2023 smoke day and how SkyWindow works are told by the story, so the dashboard keeps to these four views.

**Real alerts:**
- A red banner appears if the air over PHS is actually unhealthy (AQI > 100). It shows the EPA category, the likely cause and the EPA's health guidance.
- A dark banner says how old the data is when the connection drops; the last verdict stays up, grayed and dated.
- An orange **Fire Watch** banner appears if NASA satellites see sizeable fires *upwind* of PHS (≥ 30 MW within 150 km). In that case an "open" verdict becomes "either way", because smoke could drift in.

**Fires (NASA FIRMS):** the Pi downloads the public VIIRS active-fire file every hour and keeps detections within 300 km of PHS, dropping low-confidence points. It works out which ones are upwind from the live wind direction. These detections include small crop and brush burns and some industrial heat sources, so the site reports their size (fire radiative power) and only warns when the upwind fire power is significant.

The site runs in one of two modes:

- **Device mode:** served by the Pi at `http://<pi-ip>:8000` (story) or `http://<pi-ip>:8000/app.html` (dashboard). Both the story and the dashboard read the Pi's `/api/now`, so the Pi's verdict, room reading, forecast and fires show everywhere. The status chip says which source is live: **DEVICE LIVE** (Raspberry Pi sensors), **DEVICE · SENSOR OFFLINE** (Pi running but the Grove HAT/sensor isn't answering, so the verdict uses outside air only), **DEVICE · BACKUP FEED** (the backup backend on port 8001) or **DEVICE · DEV MODE** (laptop with mock sensors). The page must be opened from the server's own address: a copy of `web/` served by anything else can't reach the Pi and runs in showcase mode.
- **Showcase mode:** opened anywhere without the Pi. For example, serve `web/` from any static host, or run `python -m http.server -d web`. The page fetches the sky straight from Open-Meteo and simulates the room sensor, so judges can try it on their own phones.

## Raspberry Pi backend + backup backend (kept separate)

| | **Pi backend** — `server/`, `device/` (port 8000) | **Backup backend** — `simulator/` (port 8001) |
|---|---|---|
| Indoor air | The Pi's Grove sensors **only** | Scenario-driven classroom (`simulator/scenarios.py`) |
| If a sensor fails | Shows **SENSOR OFFLINE** and decides on outside air only. It never substitutes made-up numbers, and it reconnects automatically | n/a |
| Outside air, weather, NASA fires | Real | The same real data, unless the chosen scenario overrides it |
| LCD / GPIO | Real | Never touched |
| Database | `data/skywindow.db` (real readings only) | `data/sim.db` |
| Scenario controls | None | Operator page at `/sim` |
| Dashboard label for the room reading | RASPBERRY PI / LIVE (or SENSOR OFFLINE) | BACKUP FEED |

- **Separation:** the Pi backend never imports anything from `simulator/` (a test enforces this). The backup runs as its own process and wraps its *own* copy of the server code, so nothing it does can reach the Pi backend's readings, verdict or database.
- **Mock readings:** these only exist when `SKYWINDOW_MOCK=1` is set explicitly. `scripts/dev.py` sets it for laptop development, and the dashboard then says DEV MODE.
- **Operator page** (`http://<pi>:8001/sim`, not part of the dashboard):
  - **Indoor events, running in real time** at three distances. Right next to the sensor, the vapour plume hits it within seconds. At arm's length, only about a tenth of the plume reaches it. From across the room, nothing reaches it directly: only the share that mixes into the room air does, over about 4 minutes, so the reading creeps up instead of spiking. The metal-oxide sensor's response flattens out at high levels, so repeated events saturate instead of adding up. "Clear events" removes whatever is still lingering.
    - hand sanitizer: ethanol surges within ~20 s and is mostly gone in 1–2 min (VENTILATE NOW up close, a brief one at arm's length, almost nothing from across the room)
    - breath: a small humid/VOC bump that fades in ~30 s (only right next to the sensor)
    - dry-erase marker: a slower alcohol rise, noticeable only up close
    - spray cleaner: a strong plume plus a long tail in the room air that clears with ventilation
    - hand over the light sensor
  - **Room modes:** PHS bell schedule, class in session, empty, door open, window open. CO₂ follows a mass balance, so changes are always gradual. A closed, full classroom crosses the stale threshold (stale index 40: CO₂ about 1,000 ppm above the room's cleanest air of the day, so roughly 1,400–1,700 ppm) about 40 minutes into a class; with the window open it stays near outdoor levels. A 1×/10×/30× speed control fast-forwards only the slow CO₂ part, and the trend the device judges stays at real-time pace, so a fast-forwarded class never looks like a chemical spike.
  - **Outside presets:** real sky, clean day, moderate sky with a class in session (EITHER WAY until the room goes stale, then OPEN THE WINDOW), chemical spike, smoke, fire upwind, sensor warm-up. Each preset clears leftover indoor events. The page shows the verdict's reasons and the clean-air baseline, so you can see why it says what it says.
  - **Research basis:** these events change the *indoor* stale index, never the outdoor AQI. They draw on the Winsen MP503 datasheet and module specs, the Seeed wiki, classroom CO₂ studies, hand-rub evaporation studies, the 101-marker VOC study and cleaning-spray decay studies (`simulator/room.py`).
- **Running it:** `setup_pi.sh` installs both services. On a laptop, run `python scripts/dev.py` (8000) and `python scripts/sim.py` (8001).

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
