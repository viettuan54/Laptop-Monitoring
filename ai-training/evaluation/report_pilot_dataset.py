"""Audit the selected posture-pilot sessions and render JSON/Markdown reports."""

import argparse
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
if str(TRAINING_ROOT) not in sys.path:
    sys.path.insert(0, str(TRAINING_ROOT))

from data_collection.calibration_ui import write_json_atomic
from data_collection.labels import LABEL_ORDER


REPORT_VERSION = "1.0.0"
SELECTION_VERSION = "1.0.0"
EXPECTED_FACE_LANDMARKS = 478
EXPECTED_POSE_LANDMARKS = 33
MIN_KEYPOINT_VISIBILITY = 0.55
SESSION_ID_PATTERN = re.compile(r"^session-[A-Za-z0-9_-]+$")
EXPECTED_LABELS_BY_CLASS = {
    "good": frozenset(),
    "forward_head": frozenset({"forward_head"}),
    "trunk_lean": frozenset({"trunk_lean"}),
    "shoulder_tilt_left": frozenset({"shoulder_tilt_left"}),
    "shoulder_tilt_right": frozenset({"shoulder_tilt_right"}),
    "slouching": frozenset({"forward_head", "trunk_lean", "slouching"}),
}
KEYPOINT_GROUPS = {
    "ears": (7, 8),
    "shoulders": (11, 12),
    "hips": (23, 24),
}


def _ratio(numerator, denominator):
    return round(numerator / denominator, 4) if denominator else None


def _format_percent(value):
    return "n/a" if value is None else f"{value:.2%}"


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_text_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)


def _ordered_counts(counter, preferred=()):
    ordered = {}
    for key in preferred:
        if key in counter:
            ordered[key] = counter[key]
    for key in sorted(set(counter) - set(ordered)):
        ordered[key] = counter[key]
    return ordered


def _labels_key(labels):
    label_set = set(labels or [])
    for primary_class, expected in EXPECTED_LABELS_BY_CLASS.items():
        if label_set == expected:
            return primary_class
    return "+".join(sorted(label_set)) or "good"


def _record_conflicts(record):
    labels = set(record.get("posture_labels") or [])
    visibility = record.get("visibility_state")
    posture_state = record.get("posture_state")
    conflicts = []
    if {"shoulder_tilt_left", "shoulder_tilt_right"} <= labels:
        conflicts.append("both_shoulder_directions")
    has_components = {"forward_head", "trunk_lean"} <= labels
    if "slouching" in labels and not has_components:
        conflicts.append("slouching_missing_components")
    if has_components and "slouching" not in labels:
        conflicts.append("slouching_not_derived")
    if visibility != "visible" and labels:
        conflicts.append("labels_while_not_visible")
    expected_state = (
        "unknown"
        if visibility != "visible"
        else "bad" if labels else "good"
    )
    if posture_state != expected_state:
        conflicts.append("posture_state_mismatch")
    return conflicts


def _keypoint_group_is_low(pose_landmarks, indices):
    if len(pose_landmarks) <= max(indices):
        return True
    return any(
        float(pose_landmarks[index].get("visibility", 1.0))
        < MIN_KEYPOINT_VISIBILITY
        for index in indices
    )


def _shoulder_tilt_signed_degrees(record, pose_landmarks):
    if len(pose_landmarks) <= 12:
        return None
    left = pose_landmarks[11]
    right = pose_landmarks[12]
    try:
        dx = (float(right["x"]) - float(left["x"])) * float(
            record["frame_width"]
        )
        dy = (float(right["y"]) - float(left["y"])) * float(
            record["frame_height"]
        )
    except (KeyError, TypeError, ValueError):
        return None
    return math.degrees(math.atan2(dy, max(abs(dx), 1e-9)))


def load_selection(path):
    selection = _load_json(path)
    if selection.get("selection_version") != SELECTION_VERSION:
        raise ValueError(
            f"selection_version must be {SELECTION_VERSION!r}"
        )
    sessions = selection.get("accepted_sessions")
    if not isinstance(sessions, list) or not sessions:
        raise ValueError("accepted_sessions must be a non-empty list")

    seen = set()
    for entry in sessions:
        session_id = entry.get("session_id")
        if not isinstance(session_id, str) or not SESSION_ID_PATTERN.fullmatch(
            session_id
        ):
            raise ValueError(f"Invalid accepted session_id: {session_id!r}")
        if session_id in seen:
            raise ValueError(f"Duplicate accepted session_id: {session_id}")
        seen.add(session_id)
        if entry.get("primary_class") not in EXPECTED_LABELS_BY_CLASS:
            raise ValueError(
                f"Unknown primary_class for {session_id}: "
                f"{entry.get('primary_class')!r}"
            )
        expected_count = entry.get("expected_sample_count")
        if isinstance(expected_count, bool) or not isinstance(
            expected_count, int
        ) or expected_count <= 0:
            raise ValueError(
                f"expected_sample_count must be positive for {session_id}"
            )
        expected_hash = entry.get("expected_records_sha256")
        if not isinstance(expected_hash, str) or not re.fullmatch(
            r"[0-9a-f]{64}", expected_hash
        ):
            raise ValueError(
                f"Invalid expected_records_sha256 for {session_id}"
            )

    exclusions = selection.get("excluded_sessions", [])
    if not isinstance(exclusions, list):
        raise ValueError("excluded_sessions must be a list")
    excluded_seen = set()
    for entry in exclusions:
        session_id = entry.get("session_id")
        if not isinstance(session_id, str) or not SESSION_ID_PATTERN.fullmatch(
            session_id
        ):
            raise ValueError(f"Invalid excluded session_id: {session_id!r}")
        if session_id in seen or session_id in excluded_seen:
            raise ValueError(f"Session selected more than once: {session_id}")
        excluded_seen.add(session_id)
        if not str(entry.get("reason", "")).strip():
            raise ValueError(f"Exclusion reason is required for {session_id}")
    return selection


def create_record_validator(schema_path=None):
    import jsonschema

    path = schema_path or (
        TRAINING_ROOT / "datasets" / "schema" / "landmark_record.schema.json"
    )
    schema = _load_json(path)
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def audit_pilot_dataset(dataset_dir, selection, *, validator=None):
    dataset_dir = Path(dataset_dir).resolve()
    validator = validator or create_record_validator()
    accepted_entries = selection["accepted_sessions"]
    accepted_ids = {entry["session_id"] for entry in accepted_entries}
    exclusion_reasons = {
        entry["session_id"]: entry["reason"]
        for entry in selection.get("excluded_sessions", [])
    }

    manifest_paths = sorted(dataset_dir.glob("*.manifest.json"))
    records_paths = sorted(dataset_dir.glob("*.landmarks.jsonl"))
    discovered_manifest_ids = {
        path.name.removesuffix(".manifest.json") for path in manifest_paths
    }
    discovered_records_ids = {
        path.name.removesuffix(".landmarks.jsonl") for path in records_paths
    }

    errors = []
    warnings = []
    sessions = []
    record_total = 0
    schema_valid = 0
    posture_usable = 0
    transition_count = 0
    face_counts = Counter()
    pose_counts = Counter()
    keypoint_low = Counter()
    required_keypoint_low = Counter()
    label_counts = Counter()
    annotation_counts = Counter()
    primary_class_counts = Counter()
    visibility_counts = Counter()
    posture_state_counts = Counter()
    subject_counts = Counter()
    camera_counts = Counter()
    distance_status_counts = Counter()
    distance_value_counts = Counter()
    conflict_counts = Counter()
    geometry_violation_counts = Counter()
    rejection_counts = Counter()
    rejected_attempts = 0

    for entry in accepted_entries:
        session_id = entry["session_id"]
        manifest_path = dataset_dir / f"{session_id}.manifest.json"
        session_errors = []
        session_warnings = []
        if not manifest_path.is_file():
            message = f"{session_id}: manifest is missing"
            errors.append(message)
            sessions.append(
                {
                    "session_id": session_id,
                    "primary_class": entry["primary_class"],
                    "status": "failed",
                    "errors": ["manifest is missing"],
                }
            )
            continue

        try:
            manifest = _load_json(manifest_path)
        except (OSError, json.JSONDecodeError) as error:
            message = f"{session_id}: invalid manifest: {error}"
            errors.append(message)
            sessions.append(
                {
                    "session_id": session_id,
                    "primary_class": entry["primary_class"],
                    "status": "failed",
                    "errors": [f"invalid manifest: {error}"],
                }
            )
            continue

        records_name = manifest.get("records_file")
        if not isinstance(records_name, str) or Path(records_name).name != records_name:
            session_errors.append("manifest records_file is invalid")
            records_path = dataset_dir / f"{session_id}.landmarks.jsonl"
        else:
            records_path = dataset_dir / records_name
        if manifest.get("session_id") != session_id:
            session_errors.append("manifest session_id does not match selection")
        if manifest.get("status") != "completed":
            session_errors.append("manifest status is not completed")
        if not records_path.is_file():
            session_errors.append("records file is missing")
            errors.extend(f"{session_id}: {item}" for item in session_errors)
            sessions.append(
                {
                    "session_id": session_id,
                    "primary_class": entry["primary_class"],
                    "status": "failed",
                    "errors": session_errors,
                }
            )
            continue

        actual_hash = _sha256(records_path)
        if actual_hash != entry["expected_records_sha256"]:
            session_errors.append("records SHA-256 differs from selection")
        if actual_hash != manifest.get("records_sha256"):
            session_errors.append("records SHA-256 differs from manifest")

        local_records = 0
        local_schema_valid = 0
        local_schema_invalid = 0
        local_parse_errors = 0
        local_identity_errors = 0
        local_timestamp_errors = 0
        local_primary_mismatches = 0
        local_face_complete = 0
        local_face_missing = 0
        local_pose_complete = 0
        local_pose_missing = 0
        local_labels = Counter()
        local_visibility = Counter()
        previous_timestamp = None
        expected_labels = EXPECTED_LABELS_BY_CLASS[entry["primary_class"]]

        with records_path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, start=1):
                if not line.strip():
                    continue
                local_records += 1
                record_total += 1
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    local_parse_errors += 1
                    continue

                record_schema_errors = list(validator.iter_errors(record))
                if record_schema_errors:
                    local_schema_invalid += 1
                else:
                    local_schema_valid += 1
                    schema_valid += 1

                if (
                    record.get("session_id") != session_id
                    or record.get("subject_id") != manifest.get("subject_id")
                    or record.get("camera_id") != manifest.get("camera_id")
                ):
                    local_identity_errors += 1

                timestamp = record.get("timestamp_ms")
                if (
                    not isinstance(timestamp, int)
                    or isinstance(timestamp, bool)
                    or (
                        previous_timestamp is not None
                        and timestamp <= previous_timestamp
                    )
                ):
                    local_timestamp_errors += 1
                if isinstance(timestamp, int) and not isinstance(timestamp, bool):
                    previous_timestamp = timestamp

                labels = set(record.get("posture_labels") or [])
                if labels != expected_labels:
                    local_primary_mismatches += 1
                for label in labels:
                    label_counts[label] += 1
                    local_labels[label] += 1
                annotation_counts[_labels_key(labels)] += 1
                primary_class_counts[entry["primary_class"]] += 1

                visibility = record.get("visibility_state", "missing")
                posture_state = record.get("posture_state", "missing")
                visibility_counts[visibility] += 1
                posture_state_counts[posture_state] += 1
                local_visibility[visibility] += 1
                subject_counts[str(record.get("subject_id", "missing"))] += 1
                camera_counts[str(record.get("camera_id", "missing"))] += 1
                distance_status = str(
                    record.get("distance_measurement_status", "missing")
                )
                distance_status_counts[distance_status] += 1
                distance = record.get("actual_distance_cm")
                distance_key = (
                    "not_measured"
                    if distance is None
                    else f"{float(distance):.1f}_cm"
                )
                distance_value_counts[distance_key] += 1
                transition = bool(record.get("transition"))
                transition_count += int(transition)

                face = record.get("face_landmarks")
                pose = record.get("pose_landmarks")
                face = face if isinstance(face, list) else []
                pose = pose if isinstance(pose, list) else []
                if not face:
                    face_counts["missing"] += 1
                    local_face_missing += 1
                elif len(face) == EXPECTED_FACE_LANDMARKS:
                    face_counts["complete_478"] += 1
                    local_face_complete += 1
                else:
                    face_counts["unexpected_count"] += 1
                if not pose:
                    pose_counts["missing"] += 1
                    local_pose_missing += 1
                elif len(pose) == EXPECTED_POSE_LANDMARKS:
                    pose_counts["complete_33"] += 1
                    local_pose_complete += 1
                else:
                    pose_counts["unexpected_count"] += 1

                for group, indices in KEYPOINT_GROUPS.items():
                    if _keypoint_group_is_low(pose, indices):
                        keypoint_low[group] += 1
                required_groups = {"ears", "shoulders"}
                if labels & {"trunk_lean", "slouching"}:
                    required_groups.add("hips")
                if labels & {"shoulder_tilt_left", "shoulder_tilt_right"}:
                    required_groups.add("shoulders")
                for group in required_groups:
                    if _keypoint_group_is_low(pose, KEYPOINT_GROUPS[group]):
                        required_keypoint_low[group] += 1

                for conflict in _record_conflicts(record):
                    conflict_counts[conflict] += 1

                shoulder_angle = _shoulder_tilt_signed_degrees(record, pose)
                if labels & {"shoulder_tilt_left", "shoulder_tilt_right"}:
                    if shoulder_angle is None:
                        geometry_violation_counts[
                            "shoulder_angle_unavailable"
                        ] += 1
                    elif abs(shoulder_angle) <= 12.0:
                        geometry_violation_counts[
                            "shoulder_tilt_not_above_12_degrees"
                        ] += 1
                    elif (
                        "shoulder_tilt_left" in labels
                        and shoulder_angle >= 0
                    ) or (
                        "shoulder_tilt_right" in labels
                        and shoulder_angle <= 0
                    ):
                        geometry_violation_counts[
                            "shoulder_tilt_wrong_direction"
                        ] += 1

                if (
                    not record_schema_errors
                    and visibility == "visible"
                    and len(pose) == EXPECTED_POSE_LANDMARKS
                    and not transition
                ):
                    posture_usable += 1

        if local_records != entry["expected_sample_count"]:
            session_errors.append(
                "records count differs from selection "
                f"({local_records} != {entry['expected_sample_count']})"
            )
        if local_records != manifest.get("sample_count"):
            session_errors.append("records count differs from manifest")
        if local_parse_errors:
            session_errors.append(
                f"{local_parse_errors} record(s) are not valid JSON"
            )
        if local_schema_invalid:
            session_errors.append(
                f"{local_schema_invalid} record(s) fail JSON Schema"
            )
        if local_identity_errors:
            session_errors.append(
                f"{local_identity_errors} record(s) have identity mismatch"
            )
        if local_timestamp_errors:
            session_errors.append(
                f"{local_timestamp_errors} timestamp ordering error(s)"
            )
        if local_primary_mismatches:
            session_errors.append(
                f"{local_primary_mismatches} record(s) do not match "
                f"primary_class={entry['primary_class']}"
            )

        manifest_labels = {
            key: value
            for key, value in (manifest.get("label_counts") or {}).items()
            if value
        }
        calculated_labels = {
            key: local_labels[key] for key in LABEL_ORDER if local_labels[key]
        }
        if manifest_labels != calculated_labels:
            session_errors.append("manifest label_counts do not match records")
        manifest_visibility = {
            key: value
            for key, value in (manifest.get("visibility_counts") or {}).items()
            if value
        }
        calculated_visibility = {
            key: local_visibility[key]
            for key in ("visible", "partially_visible", "not_visible")
            if local_visibility[key]
        }
        if manifest_visibility != calculated_visibility:
            session_errors.append(
                "manifest visibility_counts do not match records"
            )

        gate_version = manifest.get("quality_gate_version")
        if not gate_version:
            session_warnings.append("collected before quality gate v1")
        rejected = int(manifest.get("rejected_sample_count") or 0)
        rejected_attempts += rejected
        rejection_counts.update(manifest.get("quality_rejection_counts") or {})
        errors.extend(f"{session_id}: {item}" for item in session_errors)
        sessions.append(
            {
                "session_id": session_id,
                "primary_class": entry["primary_class"],
                "status": "failed" if session_errors else "accepted",
                "sample_count": local_records,
                "schema_valid_count": local_schema_valid,
                "schema_invalid_count": local_schema_invalid,
                "parse_error_count": local_parse_errors,
                "face_complete_count": local_face_complete,
                "face_missing_count": local_face_missing,
                "pose_complete_count": local_pose_complete,
                "pose_missing_count": local_pose_missing,
                "quality_gate_version": gate_version,
                "rejected_sample_count": rejected,
                "records_sha256": actual_hash,
                "errors": session_errors,
                "warnings": session_warnings,
            }
        )

    registered_ids = accepted_ids | set(exclusion_reasons)
    unregistered_manifests = sorted(discovered_manifest_ids - registered_ids)
    missing_registered_exclusions = sorted(
        set(exclusion_reasons) - discovered_manifest_ids
    )
    orphan_records = sorted(discovered_records_ids - discovered_manifest_ids)
    manifests_without_records = sorted(
        discovered_manifest_ids - discovered_records_ids
    )
    if unregistered_manifests:
        warnings.append(
            "Unregistered manifest(s): " + ", ".join(unregistered_manifests)
        )
    if missing_registered_exclusions:
        warnings.append(
            "Registered exclusion file(s) are absent: "
            + ", ".join(missing_registered_exclusions)
        )
    if orphan_records:
        warnings.append("Orphan records file(s): " + ", ".join(orphan_records))

    accepted_without_gate = sum(
        1 for session in sessions if not session.get("quality_gate_version")
    )
    if accepted_without_gate:
        warnings.append(
            f"Có {accepted_without_gate} session accepted được thu trước "
            "quality gate v1 và đã được chấp nhận bằng kiểm tra thủ công."
        )
    if face_counts["missing"]:
        warnings.append(
            f"Thiếu Face Landmarks trong {face_counts['missing']} record "
            "accepted; dữ liệu vẫn dùng được để huấn luyện posture chỉ dùng pose."
        )
    if len(subject_counts) < 2:
        warnings.append(
            "Pilot hiện chỉ có một subject; cần thu thêm 1-2 subject trước khi "
            "mở rộng dataset."
        )
    if conflict_counts:
        errors.append(
            f"Detected {sum(conflict_counts.values())} label conflict(s)."
        )
    if geometry_violation_counts:
        errors.append(
            "Detected "
            f"{sum(geometry_violation_counts.values())} reproducible geometry "
            "violation(s)."
        )
    if required_keypoint_low:
        errors.append(
            "Required posture keypoints have low visibility in "
            f"{sum(required_keypoint_low.values())} record/group occurrence(s)."
        )

    excluded_sessions = []
    for manifest_path in manifest_paths:
        session_id = manifest_path.name.removesuffix(".manifest.json")
        if session_id in accepted_ids:
            continue
        try:
            manifest = _load_json(manifest_path)
            excluded_sessions.append(
                {
                    "session_id": session_id,
                    "sample_count": manifest.get("sample_count"),
                    "status": manifest.get("status"),
                    "quality_gate_version": manifest.get(
                        "quality_gate_version"
                    ),
                    "label_counts": {
                        key: value
                        for key, value in (
                            manifest.get("label_counts") or {}
                        ).items()
                        if value
                    },
                    "reason": exclusion_reasons.get(
                        session_id, "not registered in selection"
                    ),
                }
            )
        except (OSError, json.JSONDecodeError) as error:
            excluded_sessions.append(
                {
                    "session_id": session_id,
                    "reason": exclusion_reasons.get(
                        session_id, "not registered in selection"
                    ),
                    "manifest_error": str(error),
                }
            )

    report_status = "failed" if errors else "pass_with_warnings" if warnings else "pass"
    return {
        "report_version": REPORT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": report_status,
        "dataset_directory": str(dataset_dir),
        "selection_dataset_id": selection.get("dataset_id"),
        "summary": {
            "discovered_session_count": len(discovered_manifest_ids),
            "accepted_session_count": len(accepted_entries),
            "excluded_session_count": len(excluded_sessions),
            "accepted_record_count": record_total,
            "schema_valid_record_count": schema_valid,
            "schema_valid_record_rate": _ratio(schema_valid, record_total),
            "posture_usable_record_count": posture_usable,
            "posture_usable_record_rate": _ratio(posture_usable, record_total),
            "transition_record_count": transition_count,
            "rejected_capture_attempt_count": rejected_attempts,
            "subject_count": len(subject_counts),
            "camera_count": len(camera_counts),
        },
        "distribution": {
            "primary_class_counts": _ordered_counts(
                primary_class_counts, EXPECTED_LABELS_BY_CLASS
            ),
            "posture_label_counts": _ordered_counts(label_counts, LABEL_ORDER),
            "annotation_combination_counts": _ordered_counts(
                annotation_counts, EXPECTED_LABELS_BY_CLASS
            ),
            "visibility_counts": _ordered_counts(
                visibility_counts,
                ("visible", "partially_visible", "not_visible"),
            ),
            "posture_state_counts": _ordered_counts(
                posture_state_counts, ("good", "bad", "unknown")
            ),
            "subject_counts": _ordered_counts(subject_counts),
            "camera_counts": _ordered_counts(camera_counts),
            "distance_status_counts": _ordered_counts(distance_status_counts),
            "distance_value_counts": _ordered_counts(distance_value_counts),
        },
        "landmark_quality": {
            "face_landmark_counts": _ordered_counts(
                face_counts, ("complete_478", "missing", "unexpected_count")
            ),
            "face_available_rate": _ratio(
                record_total - face_counts["missing"], record_total
            ),
            "pose_landmark_counts": _ordered_counts(
                pose_counts, ("complete_33", "missing", "unexpected_count")
            ),
            "pose_complete_rate": _ratio(
                pose_counts["complete_33"], record_total
            ),
            "low_visibility_keypoint_group_counts": _ordered_counts(
                keypoint_low, KEYPOINT_GROUPS
            ),
            "required_low_visibility_keypoint_group_counts": _ordered_counts(
                required_keypoint_low, KEYPOINT_GROUPS
            ),
            "minimum_visibility_threshold": MIN_KEYPOINT_VISIBILITY,
        },
        "quality_gate": {
            "rejected_capture_attempt_count": rejected_attempts,
            "rejection_reason_counts": _ordered_counts(rejection_counts),
        },
        "label_conflict_counts": _ordered_counts(conflict_counts),
        "geometry_violation_counts": _ordered_counts(
            geometry_violation_counts
        ),
        "sessions": sessions,
        "excluded_sessions": excluded_sessions,
        "file_inventory": {
            "manifest_count": len(manifest_paths),
            "records_file_count": len(records_paths),
            "orphan_records_session_ids": orphan_records,
            "manifest_without_records_session_ids": manifests_without_records,
            "unregistered_manifest_session_ids": unregistered_manifests,
        },
        "errors": errors,
        "warnings": warnings,
        "limitations": [
            "Ngưỡng cổ và thân dùng pose_world_landmarks khi thu trực tiếp. "
            "Trường này không được lưu, vì vậy báo cáo kiểm tra metadata của "
            "quality gate và visibility của keypoint bắt buộc nhưng không thể "
            "tính lại chính xác góc đã dùng lúc thu."
        ],
    }


def render_markdown(report):
    summary = report["summary"]
    distribution = report["distribution"]
    landmark = report["landmark_quality"]
    low_visibility = landmark["low_visibility_keypoint_group_counts"]
    required_low_visibility = landmark[
        "required_low_visibility_keypoint_group_counts"
    ]
    lines = [
        "# Báo cáo kiểm tra posture pilot",
        "",
        f"- Trạng thái: **{report['status'].upper()}**",
        f"- Sinh lúc: `{report['generated_at']}`",
        f"- Dataset: `{report.get('selection_dataset_id')}`",
        "",
        "## Tổng quan",
        "",
        "| Chỉ số | Giá trị |",
        "|---|---:|",
        f"| Session phát hiện | {summary['discovered_session_count']} |",
        f"| Session accepted | {summary['accepted_session_count']} |",
        f"| Session excluded | {summary['excluded_session_count']} |",
        f"| Record accepted | {summary['accepted_record_count']} |",
        "| Tỷ lệ đúng JSON Schema | "
        f"{_format_percent(summary['schema_valid_record_rate'])} |",
        "| Tỷ lệ dùng được cho posture | "
        f"{_format_percent(summary['posture_usable_record_rate'])} |",
        f"| Subject | {summary['subject_count']} |",
        f"| Camera | {summary['camera_count']} |",
        f"| Lần thu bị quality gate chặn | {summary['rejected_capture_attempt_count']} |",
        "",
        "## Phân bố lớp thu",
        "",
        "| Lớp | Record |",
        "|---|---:|",
    ]
    for label, count in distribution["primary_class_counts"].items():
        lines.append(f"| `{label}` | {count} |")

    lines.extend(
        [
            "",
            "## Chất lượng landmark",
            "",
            "| Chỉ số | Giá trị |",
            "|---|---:|",
            f"| Pose đủ 33 điểm | {landmark['pose_landmark_counts'].get('complete_33', 0)} |",
            "| Tỷ lệ pose đầy đủ | "
            f"{_format_percent(landmark['pose_complete_rate'])} |",
            f"| Face đủ 478 điểm | {landmark['face_landmark_counts'].get('complete_478', 0)} |",
            f"| Face không phát hiện | {landmark['face_landmark_counts'].get('missing', 0)} |",
            "| Tỷ lệ có face | "
            f"{_format_percent(landmark['face_available_rate'])} |",
            f"| Tai visibility thấp | {low_visibility.get('ears', 0)} |",
            f"| Vai visibility thấp | {low_visibility.get('shoulders', 0)} |",
            f"| Hông visibility thấp | {low_visibility.get('hips', 0)} |",
            "| Keypoint bắt buộc visibility thấp | "
            f"{sum(required_low_visibility.values())} |",
            "",
            "## Phân bố metadata",
            "",
            "| Trường | Phân bố |",
            "|---|---|",
            "| Subject | "
            + ", ".join(
                f"`{key}`: {value}"
                for key, value in distribution["subject_counts"].items()
            )
            + " |",
            "| Camera | "
            + ", ".join(
                f"`{key}`: {value}"
                for key, value in distribution["camera_counts"].items()
            )
            + " |",
            "| Trạng thái khoảng cách | "
            + ", ".join(
                f"`{key}`: {value}"
                for key, value in distribution[
                    "distance_status_counts"
                ].items()
            )
            + " |",
            "",
            "## Session accepted",
            "",
            "| Primary class | Session | Record | Gate | Kết quả |",
            "|---|---|---:|---|---|",
        ]
    )
    for session in report["sessions"]:
        lines.append(
            f"| `{session['primary_class']}` | `{session['session_id']}` | "
            f"{session.get('sample_count', 0)} | "
            f"{session.get('quality_gate_version') or 'pre-v1'} | "
            f"{session['status']} |"
        )

    lines.extend(
        [
            "",
            "## Session excluded",
            "",
            "| Session | Record | Lý do |",
            "|---|---:|---|",
        ]
    )
    for session in report["excluded_sessions"]:
        lines.append(
            f"| `{session['session_id']}` | "
            f"{session.get('sample_count', '?')} | {session['reason']} |"
        )

    lines.extend(["", "## Nhãn và xung đột", ""])
    conflicts = report["label_conflict_counts"]
    if conflicts:
        for name, count in conflicts.items():
            lines.append(f"- `{name}`: {count}")
    else:
        lines.append("Không phát hiện nhãn xung đột.")
    geometry_violations = report["geometry_violation_counts"]
    if geometry_violations:
        for name, count in geometry_violations.items():
            lines.append(f"- Vi phạm geometry `{name}`: {count}")
    else:
        lines.append("Không phát hiện vi phạm hướng/ngưỡng nghiêng vai.")

    lines.extend(["", "## Giới hạn kiểm tra", ""])
    lines.extend(f"- {item}" for item in report["limitations"])

    lines.extend(["", "## Cảnh báo", ""])
    if report["warnings"]:
        lines.extend(f"- {warning}" for warning in report["warnings"])
    else:
        lines.append("Không có cảnh báo.")
    lines.extend(["", "## Lỗi", ""])
    if report["errors"]:
        lines.extend(f"- {error}" for error in report["errors"])
    else:
        lines.append("Không có lỗi integrity hoặc schema.")
    lines.append("")
    return "\n".join(lines)


def build_parser():
    parser = argparse.ArgumentParser(
        description="Audit accepted posture-pilot landmark sessions."
    )
    default_dataset = TRAINING_ROOT / "datasets" / "pilot"
    parser.add_argument("--dataset-dir", type=Path, default=default_dataset)
    parser.add_argument(
        "--selection",
        type=Path,
        default=default_dataset / "accepted_sessions.json",
    )
    parser.add_argument(
        "--output-json",
        type=Path,
        default=default_dataset / "pilot_dataset_report.json",
    )
    parser.add_argument(
        "--output-markdown",
        type=Path,
        default=default_dataset / "pilot_dataset_report.md",
    )
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    selection = load_selection(args.selection)
    report = audit_pilot_dataset(args.dataset_dir, selection)
    write_json_atomic(args.output_json, report)
    _write_text_atomic(args.output_markdown, render_markdown(report))
    print(f"Pilot report status: {report['status']}")
    print(f"Accepted sessions: {report['summary']['accepted_session_count']}")
    print(f"Accepted records: {report['summary']['accepted_record_count']}")
    print(f"JSON report: {args.output_json.resolve()}")
    print(f"Markdown report: {args.output_markdown.resolve()}")
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
