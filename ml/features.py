def features(air, baseline, rate, light):
    """Same feature vector at training and prediction time."""
    baseline = baseline or air
    return [air - baseline, rate, light, (air - baseline) / max(baseline, 1.0)]
