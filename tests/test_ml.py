from ml.features import N_FEATURES, features
from ml.train import sessions


def test_feature_vector_length():
    assert len(features(150, 100, 5, 400, 30)) == N_FEATURES


def test_sessions_split_on_label_change_and_time_gap():
    rows = [  # (ts, label)
        (0, "normal"), (2, "normal"), (4, "normal"),
        (6, "chemical"), (8, "chemical"),
        (300, "chemical"),  # same label, 5 min later -> new session
        (302, "normal"),
    ]
    assert sessions(rows) == [0, 0, 0, 1, 1, 2, 3]
