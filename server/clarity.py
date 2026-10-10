"""Sky Clarity: how much of the sky's light is actually getting through?

Three numbers:
  haze_transmission - % of the direct sunbeam that makes it through the aerosols overhead
                   (Beer-Lambert law with Open-Meteo's aerosol optical depth). ~88% on a clear
                   day, ~14% under the June 2023 wildfire smoke.
  model_clarity  - Open-Meteo's measured/modelled shortwave radiation divided by the
                   theoretical clear-sky radiation for this exact sun position.
  sensor_clarity - our own light sensor (pointed at the window) compared to what it
                   read under a known sky, scaled by the clear-sky curve. Needs one
                   calibration (POST /api/calibrate) taken while the sky is clear.

Clear-sky irradiance uses the Haurwitz model: GHI = 1098 * cos(z) * exp(-0.057 / cos(z)).
"""
import math
from datetime import datetime, timezone


def solar_elevation(lat, lon, when=None):
    """Approximate solar elevation angle in degrees (NOAA simplified equations)."""
    when = when or datetime.now(timezone.utc)
    doy = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60 + when.second / 3600
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                       - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    true_solar_min = hour * 60 + eqtime + 4 * lon
    hour_angle = math.radians(true_solar_min / 4 - 180)
    lat_r = math.radians(lat)
    cos_zen = math.sin(lat_r) * math.sin(decl) + math.cos(lat_r) * math.cos(decl) * math.cos(hour_angle)
    cos_zen = max(-1.0, min(1.0, cos_zen))
    return 90 - math.degrees(math.acos(cos_zen))


def clear_sky_ghi(elevation_deg):
    if elevation_deg <= 0:
        return 0.0
    cz = math.sin(math.radians(elevation_deg))
    return 1098 * cz * math.exp(-0.057 / cz)


def compute(lat, lon, sky, light_reading, light_k=None, when=None):
    elev = solar_elevation(lat, lon, when)
    clear = clear_sky_ghi(elev)
    out = {"sun_elevation": round(elev, 1), "clear_sky_wm2": round(clear), "model_clarity": None,
           "sensor_clarity": None, "haze_transmission": None, "daylight": elev > 3}
    if elev > 3 and sky and sky.get("aod") is not None:
        # Beer-Lambert: share of the direct sunbeam that survives the aerosols (smoke/dust/haze)
        # on its slanted path through the atmosphere.
        out["haze_transmission"] = round(100 * math.exp(-sky["aod"] / math.sin(math.radians(elev))))
    if clear > 50 and sky and sky.get("radiation") is not None:
        out["model_clarity"] = round(min(100.0, 100 * sky["radiation"] / clear))
    if clear > 50 and light_k:
        out["sensor_clarity"] = round(min(100.0, 100 * light_reading / (light_k * clear)))
    return out


def calibrate_k(light_reading, lat, lon, radiation=None):
    """k such that light_reading == k * irradiance right now. Uses Open-Meteo's current
    shortwave radiation when available, else assumes the sky is clear."""
    irradiance = radiation if radiation and radiation > 50 else clear_sky_ghi(solar_elevation(lat, lon))
    if irradiance < 50:
        return None
    return light_reading / irradiance
