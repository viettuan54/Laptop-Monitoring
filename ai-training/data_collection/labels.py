"""Canonical posture-label normalization for data collection."""

TAXONOMY_VERSION = "1.0.0"

VISIBILITY_STATES = frozenset(
    {
        "visible",
        "partially_visible",
        "not_visible",
    }
)

POSTURE_LABELS = frozenset(
    {
        "forward_head",
        "trunk_lean",
        "shoulder_tilt_left",
        "shoulder_tilt_right",
        "slouching",
    }
)

LABEL_ORDER = (
    "forward_head",
    "trunk_lean",
    "shoulder_tilt_left",
    "shoulder_tilt_right",
    "slouching",
)


def normalize_posture_annotation(visibility_state, posture_labels):
    """Validate labels and return deterministic labels plus posture state."""
    if visibility_state not in VISIBILITY_STATES:
        raise ValueError(f"Unknown visibility_state: {visibility_state!r}")

    labels = set(posture_labels or [])
    unknown = labels - POSTURE_LABELS
    if unknown:
        raise ValueError(f"Unknown posture labels: {sorted(unknown)!r}")

    if visibility_state != "visible":
        if labels:
            raise ValueError(
                "posture_labels must be empty when visibility_state is not visible"
            )
        return {
            "visibility_state": visibility_state,
            "posture_state": "unknown",
            "posture_labels": [],
        }

    if {"shoulder_tilt_left", "shoulder_tilt_right"} <= labels:
        raise ValueError("Left and right shoulder tilt are mutually exclusive")

    if {"forward_head", "trunk_lean"} <= labels:
        labels.add("slouching")
    else:
        labels.discard("slouching")

    ordered_labels = [label for label in LABEL_ORDER if label in labels]
    return {
        "visibility_state": visibility_state,
        "posture_state": "bad" if ordered_labels else "good",
        "posture_labels": ordered_labels,
    }
