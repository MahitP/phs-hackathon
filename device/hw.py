"""Sensor access for SkyWindow.

Grove Base HAT (STM32 ADC over I2C) on a Raspberry Pi:
  - Grove Air Quality Sensor v1.3 -> analog port A0
  - Grove Light Sensor            -> analog port A2

grove.py's ADC.read(channel) returns a 0-1000 "per mille" value.
If grove.py isn't installed (e.g. on a laptop) or SKYWINDOW_MOCK=1, a simulator
is used instead so the rest of the stack can be developed without hardware.

Run directly to print live readings:  python device/hw.py
"""
import math
import os
import random
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


def get_sensors():
    if os.environ.get("SKYWINDOW_MOCK") == "1":
        return MockSensors()
    try:
        return GroveSensors()
    except Exception as exc:  # ImportError on laptops, OSError if HAT missing
        print(f"[hw] grove.py unavailable ({exc!r}); using MOCK sensors")
        return MockSensors()


class Smoother:
    """Exponential moving average so the LCD doesn't flicker."""

    def __init__(self, alpha=0.3):
        self.alpha = alpha
        self.value = None

    def update(self, x):
        self.value = x if self.value is None else self.alpha * x + (1 - self.alpha) * self.value
        return self.value


if __name__ == "__main__":
    s = get_sensors()
    print(f"mock={s.mock}  air=A{AIR_CHANNEL}  light=A{LIGHT_CHANNEL}  (Ctrl+C to stop)")
    while True:
        tag = " (warming up)" if s.warming_up() else ""
        print(f"air={s.read_air():7.1f}   light={s.read_light():7.1f}{tag}")
        time.sleep(1)
