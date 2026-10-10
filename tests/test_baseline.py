from device.hw import RollingMin

HOUR = 3600


def test_tracks_minimum():
    m = RollingMin()
    for x in [120, 100, 110]:
        m.update(x, now=0)
    assert m.value == 100


def test_low_outlier_ages_out_after_the_window():
    m = RollingMin(window=24 * HOUR, bucket=HOUR)
    m.update(40, now=0)  # one freak low reading
    for h in range(1, 26):
        m.update(100, now=h * HOUR)
    assert m.value == 100


def test_reset_replaces_history():
    m = RollingMin()
    m.update(40, now=0)
    m.reset(90, now=10)
    assert m.value == 90


def test_empty_is_none():
    assert RollingMin().value is None
