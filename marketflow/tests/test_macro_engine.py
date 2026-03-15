from build_macro_snapshot import (
    DEFAULT_POLICY,
    compute_shock_probability,
    derive_shock_quality,
    evaluate_defensive,
    evaluate_phase,
    state_from_score,
    status_from_percentile_100,
    shock_state,
    weighted_score,
)


def test_shock_high_case():
    policy = dict(DEFAULT_POLICY)
    weights = policy["shock_weights"]
    score, _, _ = weighted_score(
        {"VRI": 90.0, "CSI": 90.0, "RV20": 80.0, "DD_VEL": 70.0},
        weights,
        zero_if_missing=["CSI"],
    )
    prob = compute_shock_probability(score, policy["shock_prob_caps"])
    assert prob > 40.0


def test_shock_low_case():
    policy = dict(DEFAULT_POLICY)
    weights = policy["shock_weights"]
    score, _, _ = weighted_score(
        {"VRI": 10.0, "CSI": 10.0, "RV20": 8.0, "DD_VEL": 12.0},
        weights,
        zero_if_missing=["CSI"],
    )
    prob = compute_shock_probability(score, policy["shock_prob_caps"])
    assert prob < 15.0


def test_defensive_watch_when_phase_slowdown():
    policy = dict(DEFAULT_POLICY)
    mode, _ = evaluate_defensive(phase="Slowdown", mps=50.0, csi=40.0, stale_blocked=False, policy=policy)
    assert mode == "WATCH"


def test_defensive_on_when_phase_contraction():
    policy = dict(DEFAULT_POLICY)
    mode, _ = evaluate_defensive(phase="Contraction", mps=45.0, csi=30.0, stale_blocked=False, policy=policy)
    assert mode == "ON"


def test_shock_quality_partial_when_csi_missing():
    q = derive_shock_quality(vri_quality_effective="OK", csi_quality_effective="PARTIAL", csi_available=False)
    assert q == "PARTIAL"

def test_shock_weight_zero_when_csi_missing():
    policy = dict(DEFAULT_POLICY)
    weights = policy["shock_weights"]
    score, contrib, missing = weighted_score(
        {"VRI": 60.0, "CSI": None, "RV20": 50.0, "DD_VEL": 40.0},
        weights,
        zero_if_missing=["CSI"],
    )
    assert missing is False
    assert contrib.get("CSI", 0.0) == 0.0
    assert score == round(0.35 * 60.0 + 0.20 * 50.0 + 0.15 * 40.0, 2)


def test_phase_transition_thresholds():
    policy = dict(DEFAULT_POLICY)
    phase, gate = evaluate_phase(lpi=40, rpi=50, vri=70, csi=60, stale_blocked=False, policy=policy)
    assert phase in ("Slowdown", "Contraction")
    assert gate >= 55


def test_shock_state_mapping():
    th = DEFAULT_POLICY["shock_state_thresholds"]
    assert shock_state(10, th) == "Low"
    assert shock_state(20, th) == "Moderate"
    assert shock_state(35, th) == "Elevated"
    assert shock_state(55, th) == "High"


def test_sensor_state_thresholds_from_policy():
    th = {"watch": 40, "stress": 70}
    assert state_from_score(39.9, th) == "Normal"
    assert state_from_score(40.0, th) == "Watch"
    assert state_from_score(70.0, th) == "Stress"


def test_percentile_band_thresholds_from_policy():
    th = {"watch": 50, "risk": 90}
    assert status_from_percentile_100(49.9, th) == "Normal"
    assert status_from_percentile_100(50.0, th) == "Watch"
    assert status_from_percentile_100(90.0, th) == "Risk"
