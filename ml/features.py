N_FEATURES = 5


def features(air, baseline, rate, light, sun_elevation):
    """Same feature vector at training and prediction time. Sun elevation lets the model tell a
    covered light sensor apart from dusk or night."""
    baseline = baseline or air
    return [air - baseline, rate, light, (air - baseline) / max(baseline, 1.0), sun_elevation]
