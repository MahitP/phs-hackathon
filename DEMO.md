# Demo script (≈2 min) + checklist

## Before judging
- [ ] Device powered **at least 2 min** before judges arrive (air sensor heater warm-up)
- [ ] Clean-air baseline set: hold near an open window or door → dashboard NOW → *Setup & training* → *Set clean-air baseline*
- [ ] Light sensor calibrated while it faces daylight → dashboard NOW → *Setup & training* → *Calibrate light to sky*
- [ ] Phone dashboard open at `http://<pi-ip>:8000`, plus a laptop mirror if possible
- [ ] Hand sanitizer or a dry-erase marker in your pocket
- [ ] Speaker plugged in, volume checked (or laptop audio)
- [ ] Backup demo video downloaded locally, in case the Wi-Fi dies
- [ ] Spare Pi (Pi B) flashed and tested with the same code

- [ ] Backup ready: dashboard at `http://<pi-ip>:8001/app.html` with scenarios at `http://<pi-ip>:8001/sim`. If the Pi's sensor misbehaves, demo from the backup, and tell the judges it's the backup with a test scenario (it uses scripted indoor readings and, in some scenarios, scripted outside air).

## Script
1. **Hook (15 s).** Hold up a photo of the orange Princeton sky. *"June 7, 2023. Who remembers this? That day, opening your window was the worst thing you could do. Most days, it's the best thing for a stuffy room. So how do you know?"*
2. **The device (15 s).** It sits on the windowsill. *"SkyWindow watches the sky above you and the air in your room, and gives you one answer."* Point at the green LCD showing **OPEN THE WINDOW**.
3. **Indoor spike (20 s).** Open the sanitizer next to the sensor. Within seconds it turns purple: **VENTILATE NOW**.
4. **The sky (30 s).** Show the phone dashboard: live AQI, smoke haze, the wind arrow, and **sunbeam through haze**. *"It uses the Beer–Lambert law to show how much sunlight gets through the haze overhead."* Cover the light sensor to show the sky-clarity reading drop.
5. **Smoke Day replay (30 s).** On the dashboard's NOW view press **▶ Replay June 7, 2023**. The verdict and the LCD turn red: **KEEP IT SHUT**. Press **🔊 Announce** and it reads the warning aloud. Press **■ Stop replay** to return to live data.
6. **PHS Campus + Earth (25 s).** Open PHS CAMPUS and click a spot near PHS (e.g. downtown Trenton). Show its AQI and weather, then point at the orange NASA fire dots: *"These are satellite fire detections from this week. SkyWindow checks if any are upwind of PHS."* Then open EARTH and tap New Delhi. The side-by-side shows how its air compares with ours right now.
7. **Close (10 s).** *"AQI apps tell you about outside. SkyWindow compares the sky with your room and tells you what to do about it."*

## Likely judge questions
- **Is the AI real?** Gemini writes the briefing from real data only. We also trained a random-forest classifier on sensor data we labeled here (see the session-grouped accuracy from `ml/train.py`).
- **Is the indoor number accurate?** It's a relative VOC gas sensor, so we show a stale index compared with the room's own baseline, not a fake AQI. The outdoor numbers come from real atmospheric data (CAMS via Open-Meteo).
- **Why not just use an AQI app?** Apps only report outside air. The decision depends on the *difference* between inside and outside, and on the forecast.
