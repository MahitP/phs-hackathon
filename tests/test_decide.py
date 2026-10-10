from server.decide import decide, outdoor_level

CLEAN = {"us_aqi": 20, "pm2_5": 4, "aod": 0.1}
MODERATE = {"us_aqi": 60, "pm2_5": 12, "aod": 0.2}
BASE = 100  # baseline; stale index = (reading - 100) / 2.5


def test_clean_sky_opens_either_way_but_explains_why():
    clean_room = decide(BASE, BASE, 0, CLEAN)
    stale_room = decide(BASE + 150, BASE, 0, CLEAN)
    assert clean_room["key"] == stale_room["key"] == "open"
    assert any("fresh air is a bonus" in r for r in clean_room["reasons"])
    assert any("staler than the sky" in r for r in stale_room["reasons"])


def test_moderate_sky_compares_inside_with_outside():
    assert decide(BASE, BASE, 0, MODERATE)["key"] == "either"  # clean room: no reason to open
    assert decide(BASE + 125, BASE, 0, MODERATE)["key"] == "open"  # index 50: room is worse than the sky


def test_bad_sky_keeps_it_shut_even_with_indoor_spike():
    v = decide(BASE + 250, BASE, 100, {"us_aqi": 150, "pm2_5": 60, "aod": 1.2})
    assert v["key"] == "shut"
    assert any("purifier" in r for r in v["reasons"])


def test_spike_ventilates():
    assert decide(BASE, BASE, 60, CLEAN)["key"] == "ventilate"  # rising fast
    assert decide(BASE + 180, BASE, 0, CLEAN)["key"] == "ventilate"  # index 72


def test_no_sky_data_is_either():
    assert decide(BASE + 125, BASE, 0, None)["key"] == "either"


def test_outdoor_threshold_has_hysteresis():
    at = lambda aqi, prev=None: outdoor_level({"us_aqi": aqi, "pm2_5": 10, "aod": 0.2}, prev)[0]
    assert at(101) == "bad"
    assert at(98) == "moderate"
    assert at(98, prev="bad") == "bad"  # must drop past 95 to leave "bad"
    assert at(94, prev="bad") == "moderate"
    assert at(48, prev="moderate") == "moderate"
    assert at(44, prev="moderate") == "good"


def test_verdicts_do_not_flap_around_a_threshold():
    prev = None
    keys = []
    for aqi in [101, 100, 101, 99, 100, 97]:
        prev = decide(BASE, BASE, 0, {"us_aqi": aqi, "pm2_5": 10, "aod": 0.2}, prev=prev)
        keys.append(prev["key"])
    assert keys == ["shut"] * 6


def test_ventilate_holds_until_index_clearly_drops():
    v = decide(BASE + 180, BASE, 0, CLEAN)  # index 72 -> ventilate
    v = decide(BASE + 155, BASE, -30, CLEAN, prev=v)  # index 62: still ventilating
    assert v["key"] == "ventilate"
    v = decide(BASE + 140, BASE, -30, CLEAN, prev=v)  # index 56: cleared
    assert v["key"] == "open"
