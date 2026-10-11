# Graph Report - .  (2026-10-10)

## Corpus Check
- 24 files · ~10,421 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 255 nodes · 323 edges · 33 communities detected
- Extraction: 84% EXTRACTED · 15% INFERRED · 1% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.72)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]

## God Nodes (most connected - your core abstractions)
1. `Replay` - 9 edges
2. `MockSensors` - 9 edges
3. `SkyWindow Device` - 9 edges
4. `$()` - 8 edges
5. `GroveLCD` - 8 edges
6. `Smoother` - 8 edges
7. `RollingMin` - 8 edges
8. `AI Captain's Announcement` - 8 edges
9. `render()` - 7 edges
10. `GroveSensors` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Rationale: Prompt Only Allows Passed-In Facts (No Invented Numbers)` --semantically_similar_to--> `Judge Q: Is the AI Real?`  [INFERRED] [semantically similar]
  README.md → DEMO.md
- `Honesty Note: VOC Sensor Is Relative, Never Called AQI` --semantically_similar_to--> `Judge Q: Is the Indoor Number Accurate?`  [INFERRED] [semantically similar]
  README.md → DEMO.md
- `what=air: current reading becomes the clean-air baseline (do it with the window` --uses--> `Smoother`  [INFERRED]
  server/app.py → device/hw.py
- `Labeled Indoor Events (normal, chemical, breath, covered light)` --conceptually_related_to--> `Indoor Spike Demo (hand sanitizer)`  [INFERRED]
  README.md → DEMO.md
- `SkyWindow server: sensor loop + LCD + REST API + dashboard.      uvicorn server.` --uses--> `RollingMin`  [INFERRED]
  server/app.py → device/hw.py

## Hyperedges (group relationships)
- **Sensor + Sky -> Verdict -> LCD/Dashboard Pipeline** — device_hw_py, server_sky_py, server_replay_py, server_app_py, server_decide_py, device_lcd_py, readme_web_dashboard [EXTRACTED 0.90]
- **Captain's Briefing Flow (Gemini text + ElevenLabs voice)** — readme_captain_announcement, server_report_py, readme_gemini, server_voice_py, readme_elevenlabs, readme_api_report [EXTRACTED 0.85]
- **Smoke Day 2023 Replay Demo** — readme_smoke_day_2023, readme_smoke_day_replay, demo_replay_step, readme_verdict_shut, demo_hook [INFERRED 0.80]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (40): decide(), outdoor_level(), _pack(), Verdict engine: should the window be open?  Indoor side - the Grove Air Quality, good' | 'moderate' | 'bad' | 'unknown' plus the reason. `prev` is the last level, `prev` is the previous verdict dict; passing it in gives the thresholds hysteres, stale_index(), Closing Pitch: Compare Sky With Room (+32 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (19): announce(), api_calibrate(), api_report(), check_model(), rate_per_min(), SkyWindow server: sensor loop + LCD + REST API + dashboard.      uvicorn server., what=air: current reading becomes the clean-air baseline (do it with the window, what=air: current reading becomes the clean-air baseline (do it with the window (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (18): Backup Plan (offline video, spare Pi B), Pre-Judging Checklist, Sky Dashboard Walkthrough (AQI, haze, wind, sunbeam), SkyWindow HTTP API, POST /api/calibrate, GET /api/history, POST /api/label, GET /api/now (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (11): Rationale: Power On 2 Min Early for Air Sensor Heater Warm-Up, get_sensors(), GroveSensors, MockSensors, Sensor access for SkyWindow.  Grove Base HAT (STM32 ADC over I2C) on a Raspberry, Real hardware via Seeed grove.py., Simulated sensors. spike() fakes hand sanitizer / a marker near the sensor,, Grove Air Quality Sensor v1.3 (A0) (+3 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (8): ConsoleLCD, get_lcd(), GroveLCD, Grove LCD RGB Backlight (16x2, JHD1313) driver over I2C bus 1.  Text controller, Grove LCD RGB Backlight (I2C), scripts/setup_pi.sh, skywindow systemd Service, smbus2>=0.4

### Community 5 - "Community 5"
Cohesion: 0.2
Nodes (11): POST /api/report, best_window(), _facts(), generate(), AI "captain's report": turns the live state + forecast into a short spoken brief, Find the cleanest 2-hour stretch in the next 24h of the forecast (lowest mean AQ, template_report(), enabled() (+3 more)

### Community 6 - "Community 6"
Cohesion: 0.4
Nodes (12): $(), api(), brief(), fmt(), lineChart(), mix(), paintSky(), poll() (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.22
Nodes (0): 

### Community 8 - "Community 8"
Cohesion: 0.22
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 0.33
Nodes (8): calibrate_k(), clear_sky_ghi(), compute(), Sky Clarity: how much of the sky's light is actually getting through?  Three num, Approximate solar elevation angle in degrees (NOAA simplified equations)., k such that light_reading == k * irradiance right now. Uses Open-Meteo's current, solar_elevation(), Haurwitz Clear-Sky Model

### Community 10 - "Community 10"
Cohesion: 0.28
Nodes (7): requests>=2.31, fetch_sky(), _get(), latest(), The sky above you: live outdoor air + weather from Open-Meteo (free, no API key), Last fetched sky, without any network I/O - safe to call from the 1 Hz sensor lo, Refresh current sky conditions plus a 24h hourly forecast when the 10-minute cac

### Community 11 - "Community 11"
Cohesion: 0.48
Nodes (5): fake_get(), test_data_goes_stale_if_nobody_refreshes_it(), test_failure_backs_off_and_marks_last_good_data_stale(), test_fetch_caches_for_ten_minutes(), test_latest_never_touches_the_network()

### Community 12 - "Community 12"
Cohesion: 0.4
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (4): main(), Train the indoor event classifier from samples labeled during the event.  Collec, Group id per (ts, label) row (sorted by ts): a new session starts when the label, sessions()

### Community 14 - "Community 14"
Cohesion: 0.4
Nodes (5): ElevenLabs Voice TTS, .env (GEMINI_API_KEY, ELEVENLABS_API_KEY), Google Gemini, Optional Speaker for Captain Voice, python-dotenv>=1.0

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 0.67
Nodes (2): features(), Same feature vector at training and prediction time. Sun elevation lets the mode

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (1): Download the June 7, 2023 Canadian-wildfire smoke day over Princeton, NJ from Op

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (1): Run SkyWindow on a laptop with simulated sensors + console LCD.      python scri

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (1): Return current sky conditions plus a 24h hourly forecast. Cached for 10 minutes;

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): good' | 'moderate' | 'bad' | 'unknown' plus the reason.

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): Same feature vector at training and prediction time.

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (1): Real hardware via Seeed grove.py.

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (1): Simulated sensors. spike() fakes hand sanitizer / a marker near the sensor,

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (1): Exponential moving average so the LCD doesn't flicker.

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): SkyWindow Architecture (1 Hz FastAPI Loop)

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): SQLite History + Labels

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Laptop Simulated-Sensor Mode (Mock buttons)

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (1): joblib>=1.3 (optional)

## Ambiguous Edges - Review These
- `report.py` → `requests>=2.31`  [AMBIGUOUS]
  requirements.txt · relation: references
- `hw.py` → `smbus2>=0.4`  [AMBIGUOUS]
  requirements.txt · relation: references

## Knowledge Gaps
- **52 isolated node(s):** `SQLite log of readings + labeled samples for training the spike classifier.`, `Sky Clarity: how much of the sky's light is actually getting through?  Three num`, `Approximate solar elevation angle in degrees (NOAA simplified equations).`, `k such that light_reading == k * irradiance right now. Uses Open-Meteo's current`, `The sky above you: live outdoor air + weather from Open-Meteo (free, no API key)` (+47 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 17`** (2 nodes): `Download the June 7, 2023 Canadian-wildfire smoke day over Princeton, NJ from Op`, `fetch_smoke_day.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `Run SkyWindow on a laptop with simulated sensors + console LCD.      python scri`, `dev.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `Return current sky conditions plus a 24h hourly forecast. Cached for 10 minutes;`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `good' | 'moderate' | 'bad' | 'unknown' plus the reason.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `Same feature vector at training and prediction time.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `Real hardware via Seeed grove.py.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `Simulated sensors. spike() fakes hand sanitizer / a marker near the sensor,`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `Exponential moving average so the LCD doesn't flicker.`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `SkyWindow Architecture (1 Hz FastAPI Loop)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `SQLite History + Labels`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Laptop Simulated-Sensor Mode (Mock buttons)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `joblib>=1.3 (optional)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `report.py` and `requests>=2.31`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `hw.py` and `smbus2>=0.4`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `SkyWindow HTTP API` connect `Community 2` to `Community 0`, `Community 1`, `Community 5`?**
  _High betweenness centrality (0.201) - this node is a cross-community bridge._
- **Why does `POST /api/report` connect `Community 5` to `Community 2`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `Replay` (e.g. with `SkyWindow server: sensor loop + LCD + REST API + dashboard.      uvicorn server.` and `Drop a model trained on a different feature vector instead of crashing every tic`) actually correct?**
  _`Replay` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SQLite log of readings + labeled samples for training the spike classifier.`, `Sky Clarity: how much of the sky's light is actually getting through?  Three num`, `Approximate solar elevation angle in degrees (NOAA simplified equations).` to the rest of the system?**
  _52 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._