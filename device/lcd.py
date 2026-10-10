"""Grove LCD RGB Backlight (16x2, JHD1313) driver over I2C bus 1.

Text controller is at 0x3e. The RGB backlight chip is at 0x62 on v4 boards
and 0x30 on v5 boards; we probe both. Falls back to printing to the console
when there's no I2C (laptop) or SKYWINDOW_MOCK=1.

Test:  python device/lcd.py --test
"""
import os
import sys
import time

TEXT_ADDR = 0x3E
RGB_ADDR_V4 = 0x62
RGB_ADDR_V5 = 0x30


class GroveLCD:
    mock = False

    def __init__(self, bus_num=1):
        from smbus2 import SMBus

        self.bus = SMBus(bus_num)
        self.rgb_addr = None
        for addr in (RGB_ADDR_V4, RGB_ADDR_V5):
            try:
                self.bus.read_byte(addr)
                self.rgb_addr = addr
                break
            except OSError:
                continue
        if self.rgb_addr is None:
            raise OSError("Grove LCD backlight not found at 0x62 or 0x30 (is I2C enabled? check `i2cdetect -y 1`)")
        if self.rgb_addr == RGB_ADDR_V5:
            self._rgb(0x00, 0x07)  # reset
            time.sleep(0.0002)
            self._rgb(0x04, 0x15)  # all LEDs always on
        else:
            self._rgb(0x00, 0x00)  # MODE1
            self._rgb(0x08, 0xFF)  # LEDOUT
            self._rgb(0x01, 0x20)  # MODE2
        self._last = None

    def _rgb(self, reg, val):
        self.bus.write_byte_data(self.rgb_addr, reg, val)

    def _cmd(self, cmd):
        self.bus.write_byte_data(TEXT_ADDR, 0x80, cmd)

    def set_color(self, r, g, b):
        if self.rgb_addr == RGB_ADDR_V5:
            self._rgb(0x06, r)
            self._rgb(0x07, g)
            self._rgb(0x08, b)
        else:
            self._rgb(0x04, r)
            self._rgb(0x03, g)
            self._rgb(0x02, b)

    def set_text(self, line1, line2=""):
        if self._last == (line1, line2):
            return  # avoid flicker from re-clearing identical text
        self._last = (line1, line2)
        self._cmd(0x01)  # clear
        time.sleep(0.05)
        self._cmd(0x08 | 0x04)  # display on, no cursor
        self._cmd(0x28)  # 2 lines
        time.sleep(0.05)
        for i, ch in enumerate(line1[:16]):
            self.bus.write_byte_data(TEXT_ADDR, 0x40, ord(ch) if ord(ch) < 128 else ord("?"))
        self._cmd(0xC0)  # second line
        for ch in line2[:16]:
            self.bus.write_byte_data(TEXT_ADDR, 0x40, ord(ch) if ord(ch) < 128 else ord("?"))

    def show(self, line1, line2, rgb):
        self.set_color(*rgb)
        self.set_text(line1, line2)


class ConsoleLCD:
    mock = True

    def __init__(self):
        self._last = None

    def show(self, line1, line2, rgb):
        state = (line1, line2, tuple(rgb))
        if state != self._last:
            self._last = state
            print(f"[LCD rgb{tuple(rgb)}] |{line1[:16]:<16}|{line2[:16]:<16}|")


def get_lcd():
    if os.environ.get("SKYWINDOW_MOCK") == "1":
        return ConsoleLCD()
    try:
        return GroveLCD()
    except Exception as exc:
        print(f"[lcd] Grove LCD unavailable ({exc!r}); printing to console")
        return ConsoleLCD()


if __name__ == "__main__":
    lcd = get_lcd()
    if "--test" in sys.argv:
        from pathlib import Path

        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from server.decide import VERDICTS

        for key, v in VERDICTS.items():
            lcd.show(v["lcd1"], v["lcd2"], v["rgb"])
            print(f"showing {key}")
            time.sleep(2)
    else:
        lcd.show("SkyWindow", "hello, sky!", (80, 160, 255))
