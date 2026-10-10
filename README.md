# ☁️ SkyWindow: *Should I let the sky in?*

**hackPHS 2026 · Theme: "Into the Skies"**

On **June 7, 2023**, wildfire smoke from Canada turned Princeton's sky orange. That day, opening a window was the worst thing you could do. On most other days, opening a window is the best thing you can do for a stuffy room.

**SkyWindow** is a small device that sits on your windowsill. It watches the sky above you and the air in your room, then gives you one clear answer:

| LCD | Verdict | When |
|---|---|---|
| 🟢 | **OPEN THE WINDOW** | The sky is cleaner than your room |
| 🟡 | **EITHER WAY** | Inside and outside are about the same (moderate outdoor air) |
| 🔴 | **KEEP IT SHUT** | Smoke, haze, ozone or particles in the sky (AQI > 100, PM2.5 > 35, or heavy haze) |
| 🟣 | **VENTILATE NOW** | Your room just spiked (cleaners, markers, cooking, sanitizer) |

An AI "captain" then announces it: *"This is your captain speaking. Winds from the northwest are carrying haze…"*

## How it connects to the sky

- **The sky above you, live.** We pull outdoor US AQI, PM2.5, ozone, dust, **aerosol optical depth** (how much smoke or haze is in the air column), UV, cloud cover and **wind direction** for our exact location from Open-Meteo, which uses the CAMS atmospheric models.
- **Sunbeam-through-haze meter.** We use the Beer–Lambert law to calculate how much of the direct sunbeam makes it through the aerosols on its slanted path at the current sun angle: `T = exp(−AOD / sin(sun elevation))`. That's about 88% on a clear day and about 14–30% under the 2023 smoke.
- **Sky Clarity sensor.** Our light sensor points out the window. After a one-tap calibration, we compare its reading with the theoretical clear-sky sunlight for this exact time and place (Haurwitz model plus solar position). The result shows how much of the sky's light is actually reaching you.
- **Smoke Day replay.** One button replays June 7, 2023 over Princeton using real historical model data (AQI up to 151, aerosol optical depth up to 1.47). The device and dashboard react live, and the dashboard's sky turns orange.

## AI

- **Captain's announcement (GenAI).** Google Gemini turns the live facts into a short spoken briefing. The facts are the verdict, AQI, haze, wind and the cleanest 2-hour window in the forecast. The prompt only allows facts we pass in, so it can't make up numbers.
- **Voice (ElevenLabs).** The briefing is read aloud by an ElevenLabs voice, in the browser or through the device's own speaker. With `SKYWINDOW_AUTO_ANNOUNCE=1` the device announces every time the verdict changes.
- **Indoor event classifier (trained by us).** We recorded labeled sensor data during the hackathon: normal air, chemicals (hand sanitizer or markers), breath, and a covered light sensor. We trained a random forest (`ml/train.py`) on it. The dashboard shows what it thinks is happening in the room.

**Honesty note:** the Grove Air Quality v1.3 is a VOC gas sensor with **relative** output. We never call its reading AQI. It becomes a 0–100 "stale index" measured against the room's own clean-air baseline. The outdoor AQI comes from real atmospheric data.

## Hardware

- Raspberry Pi with a Grove Base HAT
- Grove Air Quality Sensor v1.3 → **A0**
- Grove Light Sensor → **A2** (facing the window)
- Grove LCD RGB Backlight → **I2C**
- *(optional)* a speaker on the Pi's audio jack or USB for the captain's voice

## Architecture

```
 Grove sensors ──► device/hw.py ─┐
                                 ├─► server/app.py (FastAPI, 1 Hz loop) ──► device/lcd.py (verdict + color)
 Open-Meteo ────► server/sky.py ─┤        │                         └─► web/ dashboard (phone, any browser)
 2023 replay ───► server/replay.py┘        ├─► server/decide.py   (verdict engine)
                                          ├─► server/clarity.py  (sun position, clear-sky, Beer-Lambert)
                                          ├─► server/report.py   (Gemini captain's report)
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

Then open `http://<pi-ip>:8000` on any phone on the same network.

Hardware checks:

```bash
python device/hw.py               # live sensor values
python device/lcd.py --test       # cycles the 4 verdict colours
```

**On a laptop (no hardware, simulated sensors):**

```bash
python -m venv .venv && .venv/Scripts/pip install fastapi uvicorn requests python-dotenv   # Windows
python scripts/dev.py             # http://localhost:8000  - use the "Mock" buttons under Setup
```

### API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/now` | Full live state: verdict, indoor, sky, clarity, replay |
| GET | `/api/history?minutes=60` | Logged readings |
| POST | `/api/report` `{"speak": true}` | Generate the captain's report (+ ElevenLabs audio) |
| POST | `/api/replay` `{"on": true}` | Start or stop the Smoke Day replay |
| POST | `/api/calibrate` `{"what": "air"\|"light"}` | Set the clean-air baseline, or calibrate the light sensor to the sky |
| POST | `/api/label` `{"label": "chemical"}` | Record a labeled sample for the classifier |

## What's next

- A second node mounted outside the window, so we measure outdoor air directly instead of relying on the model.
- Wildfire tracking: NASA FIRMS fire detections upwind × wind direction → "smoke arriving in ~3 h" warnings.
- A servo or smart-plug that opens a window vent or turns on a purifier automatically.

## Credits

Sky data: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), CAMS air-quality and ERA5 reanalysis. Built in 24 hours at hackPHS 2026.
