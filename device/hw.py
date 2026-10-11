"""Sensor access for SkyWindow.

Grove Base HAT (STM32 ADC over I2C) on a Raspberry Pi:
  - Grove Air Quality Sensor v1.3 -> analog port A0
  - Grove Light Sensor            -> analog port A2

grove.py's ADC.read(channel) returns a 0-1000 "per mille" value.
With SKYWINDOW_MOCK=1 (laptop development only) a mock is used instead. Without it, the real
sensors are used, and if they can't be read the readings are None ("sensor offline") - never fake.

Run directly to print live readings:  python device/hw.py
"""
import math
import os
import random
import threading
import time

AIR_CHANNEL = int(os.environ.get("SKYWINDOW_AIR_CH", "0"))
LIGHT_CHANNEL = int(os.environ.get("SKYWINDOW_LIGHT_CH", "2"))
WARMUP_SECONDS = 120  # air quality v1.3 heater needs ~2 min after power-on


class GroveSensors:
    """Real hardware via Seeed grove.py."""

    mock = False

    def __init__(self):
        from grove.adc import ADC  # noqa: import inside so laptops don't need it

        self.adc = ADC()
        self.started = time.time()

    def read_air(self):
        return float(self.adc.read(AIR_CHANNEL))

    def read_light(self):
        return float(self.adc.read(LIGHT_CHANNEL))

    def warming_up(self):
        return time.time() - self.started < WARMUP_SECONDS


class MockSensors:
    """Simulated sensors. spike() fakes hand sanitizer / a marker near the sensor,
    cover() fakes a hand over the light sensor."""

    mock = True

    def __init__(self):
        self.started = time.time()
        self.air_base = 80.0
        self.stale = 0.0  # slowly drifts up like a closed room
        self.spike_until = 0.0
        self.cover_until = 0.0

    def spike(self, seconds=20):
        self.spike_until = time.time() + seconds

    def cover(self, seconds=10):
        self.cover_until = time.time() + seconds

    def read_air(self):
        now = time.time()
        self.stale = min(self.stale + 0.02, 120)
        value = self.air_base + self.stale + random.uniform(-3, 3)
        if now < self.spike_until:
            remaining = self.spike_until - now
            value += 350 * math.sin(math.pi * min(1.0, remaining / 20))
        return max(0.0, value)

    def read_light(self):
        if time.time() < self.cover_until:
            return random.uniform(5, 15)
        hour = time.localtime().tm_hour + time.localtime().tm_min / 60
        daylight = max(0.0, math.sin(math.pi * (hour - 6.5) / 13))
        return 40 + 650 * daylight + random.uniform(-10, 10)

    def warming_up(self):
        return False


class PiSensors:
    """The Raspberry Pi's real sensors, and nothing else. If the Grove HAT/driver is missing or a read
    fails (e.g. a cable comes loose), readings are None and `offline` is True: we never substitute
    made-up numbers for Pi data. It keeps retrying, so the sensor comes back by itself once fixed."""

    mock = False

    def __init__(self):
        self._dev, self.error, self._retry_at, self.started = None, None, 0.0, time.time()
        self._connect()

    def _connect(self):
        if time.time() < self._retry_at:
            return
        try:
            self._dev = GroveSensors()
            self.error, self.started = None, time.time()
            print("[hw] Grove sensors connected")
        except Exception as exc:  # ImportError (no grove.py), OSError (no HAT on I2C)
            self._dev, self.error, self._retry_at = None, f"{type(exc).__name__}: {exc}", time.time() + 30
            print(f"[hw] sensors offline: {self.error} (retrying every 30 s)")

    def _read(self, fn):
        if self._dev is None:
            self._connect()
        if self._dev is None:
            return None
        try:
            return fn(self._dev)
        except Exception as exc:
            self._dev, self.error, self._retry_at = None, f"{type(exc).__name__}: {exc}", time.time() + 5
            print(f"[hw] sensor read failed: {self.error}")
            return None

    @property
    def offline(self):
        return self._dev is None

    def read_air(self):
        return self._read(lambda d: d.read_air())

    def read_light(self):
        return self._read(lambda d: d.read_light())

    def warming_up(self):
        return self._dev is not None and self._dev.warming_up()


def get_sensors():
    """Mock readings ONLY when explicitly asked for (SKYWINDOW_MOCK=1, e.g. scripts/dev.py on a laptop).
    On the Pi this is always the real sensors - or 'offline', never fake data."""
    if os.environ.get("SKYWINDOW_MOCK") == "1":
        return MockSensors()
    return PiSensors()


class Smoother:
    """Exponential moving average so the LCD doesn't flicker."""

    def __init__(self, alpha=0.3):
        self.alpha = alpha
        self.value = None

    def update(self, x):
        self.value = x if self.value is None else self.alpha * x + (1 - self.alpha) * self.value
        return self.value


class RollingMin:
    """Lowest value over the last `window` seconds, kept as per-bucket minima. Used for the
    clean-air baseline so one freak low reading (or a calibration in another room, or sensor
    drift) ages out after a day instead of sticking forever."""

    def __init__(self, window=24 * 3600, bucket=3600):
        self.window, self.bucket = window, bucket
        self.buckets = {}  # bucket number -> lowest value seen in it
        self._lock = threading.Lock()  # sensor loop updates, API calibration resets

    def update(self, x, now=None):
        now = time.time() if now is None else now
        b = int(now // self.bucket)
        with self._lock:
            self.buckets[b] = min(x, self.buckets.get(b, x))
            for k in [k for k in self.buckets if (k + 1) * self.bucket <= now - self.window]:
                del self.buckets[k]
        return self.value

    def reset(self, x, now=None):
        with self._lock:
            self.buckets = {}
        return self.update(x, now)

    @property
    def value(self):
        with self._lock:
            return min(self.buckets.values()) if self.buckets else None


if __name__ == "__main__":
    s = get_sensors()
    print(f"mock={s.mock}  air=A{AIR_CHANNEL}  light=A{LIGHT_CHANNEL}  (Ctrl+C to stop)")
    while True:
        air, light = s.read_air(), s.read_light()
        if air is None:
            print(f"SENSOR OFFLINE: {getattr(s, 'error', '?')}")
        else:
            tag = " (warming up)" if s.warming_up() else ""
            print(f"air={air:7.1f}   light={(light if light is not None else float('nan')):7.1f}{tag}")
        time.sleep(1)
