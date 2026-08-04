"""Interactive, privacy-preserving Face/Pose landmark collection.

The OpenCV preview and source frames remain in memory. Each saved JSONL line is
validated against ``landmark_record.schema.json`` before it is written. This
collector imports the Agent's posture analyzer directly so preview quality and
feature suggestions cannot silently drift from the deployed runtime.
"""

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPOSITORY_ROOT = TRAINING_ROOT.parent
AGENT_COMPANION_ROOT = REPOSITORY_ROOT / "child-monitor-agent" / "companion"
for import_root in (TRAINING_ROOT, AGENT_COMPANION_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from data_collection.calibration_ui import write_json_atomic
from data_collection.distance_measurement import (
    MEASUREMENT_METHODS,
    normalize_distance_measurement,
)
from data_collection.labels import (
    LABEL_ORDER,
    POSTURE_LABELS,
    TAXONOMY_VERSION,
    normalize_posture_annotation,
)
from distance_profile import camera_id as runtime_camera_id
from mediapipe_runtime import load_mediapipe
from vision_metrics import (
    DEFAULT_MAX_NECK_ANGLE_DEGREES,
    DEFAULT_MAX_SHOULDER_TILT_DEGREES,
    DEFAULT_MAX_TORSO_ANGLE_DEGREES,
    analyze_posture,
)


WINDOW_TITLE = "Child Monitor - Landmark Pilot Collection"
LANDMARK_SCHEMA_VERSION = "1.1.0"
COLLECTION_SESSION_VERSION = "1.0.0"
QUALITY_GATE_VERSION = "1.0.0"
DEFAULT_SAMPLE_RATE_HZ = 5.0
LABEL_KEY_MAP = {
    ord("1"): "forward_head",
    ord("2"): "trunk_lean",
    ord("3"): "shoulder_tilt_left",
    ord("4"): "shoulder_tilt_right",
}
VISIBILITY_STATES = ("visible", "partially_visible", "not_visible")
QUALITY_REASON_TEXT = {
    "posture_not_visible": "body landmarks are not fully visible",
    "neck_angle_unavailable": "neck angle is unavailable",
    "forward_head_too_weak": (
        f"neck angle must be > {DEFAULT_MAX_NECK_ANGLE_DEGREES:.0f} deg"
    ),
    "hips_not_visible": "move back until both hips are visible",
    "trunk_lean_too_weak": (
        f"torso angle must be > {DEFAULT_MAX_TORSO_ANGLE_DEGREES:.0f} deg"
    ),
    "shoulder_angle_unavailable": "shoulder angle is unavailable",
    "shoulder_tilt_too_weak": (
        "shoulder tilt must be > "
        f"{DEFAULT_MAX_SHOULDER_TILT_DEGREES:.0f} deg"
    ),
    "shoulder_tilt_wrong_direction": "shoulder tilt direction does not match label",
}


def _default_face_model_path():
    return (
        REPOSITORY_ROOT
        / "child-monitor-agent"
        / "models"
        / "face_landmarker.task"
    )


def _default_pose_model_path():
    return (
        REPOSITORY_ROOT
        / "child-monitor-agent"
        / "models"
        / "pose_landmarker_lite.task"
    )


def _default_output_dir():
    return TRAINING_ROOT / "datasets" / "pilot"


def _new_session_id():
    now = datetime.now(timezone.utc)
    return f"session-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"


def _finite_number(value, field):
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    return number


def _landmark_value(landmark, field, *, required=False):
    if isinstance(landmark, dict):
        if field not in landmark:
            if required:
                raise ValueError(f"landmark.{field} is required")
            return None
        value = landmark[field]
    else:
        if not hasattr(landmark, field):
            if required:
                raise ValueError(f"landmark.{field} is required")
            return None
        value = getattr(landmark, field)
    if value is None:
        if required:
            raise ValueError(f"landmark.{field} is required")
        return None
    return _finite_number(value, f"landmark.{field}")


def serialize_landmarks(landmarks):
    """Convert MediaPipe or dictionary landmarks into schema-safe values."""
    serialized = []
    for landmark in landmarks or []:
        item = {
            "x": round(_landmark_value(landmark, "x", required=True), 8),
            "y": round(_landmark_value(landmark, "y", required=True), 8),
            "z": round(_landmark_value(landmark, "z", required=True), 8),
        }
        for confidence_field in ("visibility", "presence"):
            confidence = _landmark_value(landmark, confidence_field)
            if confidence is not None:
                item[confidence_field] = round(
                    max(0.0, min(1.0, confidence)),
                    6,
                )
        serialized.append(item)
    return serialized


def build_landmark_record(
    *,
    session_id,
    subject_id,
    camera_id,
    timestamp_ms,
    distance_measurement,
    visibility_state,
    posture_labels,
    transition,
    face_landmarks,
    pose_landmarks,
    frame_width,
    frame_height,
):
    """Build one deterministic record before JSON Schema validation."""
    if isinstance(timestamp_ms, bool) or int(timestamp_ms) < 0:
        raise ValueError("timestamp_ms must be a non-negative integer")
    annotation = normalize_posture_annotation(
        visibility_state,
        posture_labels,
    )
    required_distance_fields = {
        "distance_measurement_status",
        "actual_distance_cm",
        "distance_measurement_method",
        "distance_reference",
        "distance_uncertainty_cm",
    }
    missing_distance_fields = required_distance_fields - set(distance_measurement)
    if missing_distance_fields:
        raise ValueError(
            "distance_measurement is missing fields: "
            f"{sorted(missing_distance_fields)!r}"
        )
    return {
        "schema_version": LANDMARK_SCHEMA_VERSION,
        "session_id": session_id,
        "subject_id": subject_id,
        "camera_id": camera_id,
        "timestamp_ms": int(timestamp_ms),
        **{
            field: distance_measurement[field]
            for field in (
                "distance_measurement_status",
                "actual_distance_cm",
                "distance_measurement_method",
                "distance_reference",
                "distance_uncertainty_cm",
            )
        },
        **annotation,
        "transition": bool(transition),
        "face_landmarks": serialize_landmarks(face_landmarks),
        "pose_landmarks": serialize_landmarks(pose_landmarks),
        "frame_width": int(frame_width),
        "frame_height": int(frame_height),
    }


def create_record_validator(schema_path=None):
    import jsonschema

    path = schema_path or (
        TRAINING_ROOT / "datasets" / "schema" / "landmark_record.schema.json"
    )
    schema = json.loads(Path(path).read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


def validate_landmark_record(record, validator):
    errors = sorted(
        validator.iter_errors(record),
        key=lambda error: tuple(str(item) for item in error.absolute_path),
    )
    if not errors:
        return
    error = errors[0]
    path = ".".join(str(item) for item in error.absolute_path) or "<record>"
    raise ValueError(f"landmark record schema error at {path}: {error.message}")


def _distance_measurement_from_args(args):
    status = args.distance_status
    if status is None:
        status = "measured" if args.distance_cm is not None else "not_measured"
    if status == "measured" and args.distance_cm is None:
        raise ValueError("--distance-cm is required when distance-status is measured")
    return normalize_distance_measurement(
        args.distance_cm,
        status=status,
        method=args.method,
        uncertainty_cm=args.uncertainty_cm,
    )


def _toggle_label(selected_labels, label):
    labels = set(selected_labels)
    if label in labels:
        labels.remove(label)
    else:
        labels.add(label)
        if label == "shoulder_tilt_left":
            labels.discard("shoulder_tilt_right")
        elif label == "shoulder_tilt_right":
            labels.discard("shoulder_tilt_left")
    return {
        candidate
        for candidate in labels
        if candidate in POSTURE_LABELS and candidate != "slouching"
    }


def evaluate_capture_quality(posture, selected_labels, *, transition=False):
    """Apply label-specific geometry gates before persisting a static pose."""
    if transition:
        return {"valid": True, "rejection_reasons": []}

    normalized = normalize_posture_annotation("visible", selected_labels)
    labels = set(normalized["posture_labels"])
    if not labels:
        # The operator remains the authority for a human-labelled good pose.
        # Non-visible samples are also useful for detector-quality analysis.
        return {"valid": True, "rejection_reasons": []}
    if posture.get("visibility_state") != "visible":
        return {
            "valid": False,
            "rejection_reasons": ["posture_not_visible"],
        }

    reasons = []
    if "forward_head" in labels:
        neck_angle = posture.get("neck_angle_degrees")
        if neck_angle is None:
            reasons.append("neck_angle_unavailable")
        elif neck_angle <= DEFAULT_MAX_NECK_ANGLE_DEGREES:
            reasons.append("forward_head_too_weak")

    if "trunk_lean" in labels:
        torso_angle = posture.get("torso_angle_degrees")
        if torso_angle is None:
            reasons.append("hips_not_visible")
        elif torso_angle <= DEFAULT_MAX_TORSO_ANGLE_DEGREES:
            reasons.append("trunk_lean_too_weak")

    shoulder_label = None
    if "shoulder_tilt_left" in labels:
        shoulder_label = "shoulder_tilt_left"
    elif "shoulder_tilt_right" in labels:
        shoulder_label = "shoulder_tilt_right"
    if shoulder_label is not None:
        shoulder_angle = posture.get("shoulder_tilt_degrees")
        shoulder_signed = posture.get("shoulder_tilt_signed_degrees")
        if shoulder_angle is None or shoulder_signed is None:
            reasons.append("shoulder_angle_unavailable")
        elif shoulder_angle <= DEFAULT_MAX_SHOULDER_TILT_DEGREES:
            reasons.append("shoulder_tilt_too_weak")
        elif (
            shoulder_label == "shoulder_tilt_left"
            and shoulder_signed >= 0
        ) or (
            shoulder_label == "shoulder_tilt_right"
            and shoulder_signed <= 0
        ):
            reasons.append("shoulder_tilt_wrong_direction")

    return {"valid": not reasons, "rejection_reasons": reasons}


def _open_camera(cv2, camera_index, width, height):
    backend = getattr(cv2, "CAP_DSHOW", 0)
    camera = cv2.VideoCapture(camera_index, backend)
    if not camera.isOpened():
        camera.release()
        camera = cv2.VideoCapture(camera_index)
    if not camera.isOpened():
        camera.release()
        raise RuntimeError(f"Cannot open webcam at camera index {camera_index}")
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return camera


def _draw_connections(
    cv2,
    frame,
    landmarks,
    connections,
    color,
    *,
    mirrored=False,
):
    if not landmarks:
        return
    height, width = frame.shape[:2]

    def point(index):
        landmark = landmarks[index]
        x = _landmark_value(landmark, "x", required=True)
        y = _landmark_value(landmark, "y", required=True)
        if mirrored:
            x = 1.0 - x
        return int(x * width), int(y * height)

    for connection in connections:
        if connection.start >= len(landmarks) or connection.end >= len(landmarks):
            continue
        start = point(connection.start)
        end = point(connection.end)
        cv2.line(frame, start, end, color, 1, cv2.LINE_AA)


def _draw_pose_points(cv2, frame, landmarks, *, mirrored=False):
    if not landmarks:
        return
    height, width = frame.shape[:2]
    for landmark in landmarks:
        x = _landmark_value(landmark, "x", required=True)
        y = _landmark_value(landmark, "y", required=True)
        if mirrored:
            x = 1.0 - x
        cv2.circle(
            frame,
            (int(x * width), int(y * height)),
            2,
            (30, 220, 255),
            -1,
            cv2.LINE_AA,
        )


def _draw_status_panel(cv2, frame, lines, color):
    line_height = 22
    panel_height = 18 + line_height * len(lines)
    overlay = frame.copy()
    cv2.rectangle(
        overlay,
        (8, 8),
        (frame.shape[1] - 8, panel_height),
        (0, 0, 0),
        -1,
    )
    cv2.addWeighted(overlay, 0.68, frame, 0.32, 0, frame)
    for index, line in enumerate(lines):
        cv2.putText(
            frame,
            line,
            (16, 29 + index * line_height),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            color,
            1,
            cv2.LINE_AA,
        )


def _posture_summary(posture):
    labels = ",".join(posture.get("posture_labels") or []) or "none"
    angle_parts = []
    for key, short_name in (
        ("neck_angle_degrees", "neck"),
        ("torso_angle_degrees", "torso"),
        ("shoulder_tilt_degrees", "shoulder"),
    ):
        value = posture.get(key)
        if value is not None:
            angle_parts.append(f"{short_name}={value:.1f}")
    angles = " ".join(angle_parts) or "angles unavailable"
    return f"Agent suggestion: {labels} | {angles}"


def _records_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _create_manifest(
    *,
    args,
    session_id,
    camera_id,
    frame_width,
    frame_height,
    distance_measurement,
    records_path,
):
    now = datetime.now(timezone.utc)
    return {
        "collection_session_version": COLLECTION_SESSION_VERSION,
        "record_schema_version": LANDMARK_SCHEMA_VERSION,
        "taxonomy_version": TAXONOMY_VERSION,
        "session_id": session_id,
        "subject_id": args.subject_id,
        "camera_id": camera_id,
        "camera_index": args.camera_index,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "sample_rate_hz": args.sample_rate_hz,
        "distance_measurement": distance_measurement,
        "feature_logic": "child-monitor-agent/companion/vision_metrics.py",
        "quality_gate_version": QUALITY_GATE_VERSION,
        "quality_thresholds_degrees": {
            "forward_head": DEFAULT_MAX_NECK_ANGLE_DEGREES,
            "trunk_lean": DEFAULT_MAX_TORSO_ANGLE_DEGREES,
            "shoulder_tilt": DEFAULT_MAX_SHOULDER_TILT_DEGREES,
        },
        "records_file": records_path.name,
        "image_storage": "disabled",
        "started_at": now.isoformat(),
        "completed_at": None,
        "status": "running",
        "sample_count": 0,
        "rejected_sample_count": 0,
        "quality_rejection_counts": {},
        "transition_count": 0,
        "visibility_counts": {state: 0 for state in VISIBILITY_STATES},
        "label_counts": {label: 0 for label in LABEL_ORDER},
        "records_sha256": None,
    }


def _update_manifest_counts(manifest, record):
    manifest["sample_count"] += 1
    manifest["transition_count"] += int(record["transition"])
    manifest["visibility_counts"][record["visibility_state"]] += 1
    for label in record["posture_labels"]:
        manifest["label_counts"][label] += 1


def _update_manifest_rejections(manifest, rejection_reasons):
    manifest["rejected_sample_count"] += 1
    counts = manifest["quality_rejection_counts"]
    for reason in rejection_reasons:
        counts[reason] = counts.get(reason, 0) + 1


def _append_jsonl(stream, record):
    stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
    stream.write("\n")
    stream.flush()


def run_capture(args):
    runtime_cache = (
        Path(tempfile.gettempdir())
        / "ChildMonitorLandmarkCapture"
        / "matplotlib"
    )
    runtime_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(runtime_cache))

    import cv2

    mp = load_mediapipe()

    for model_path, model_name in (
        (args.face_model_path, "Face Landmarker"),
        (args.pose_model_path, "Pose Landmarker"),
    ):
        if not model_path.is_file():
            raise FileNotFoundError(f"{model_name} model not found: {model_path}")

    validator = create_record_validator()
    distance_measurement = _distance_measurement_from_args(args)
    camera = _open_camera(
        cv2,
        args.camera_index,
        args.frame_width,
        args.frame_height,
    )
    first_frame = None
    try:
        ok, first_frame = camera.read()
        if not ok:
            raise RuntimeError("Webcam frame read failed")
        actual_height, actual_width = first_frame.shape[:2]
        resolved_camera_id = args.camera_id or runtime_camera_id(
            args.camera_index,
            actual_width,
            actual_height,
        )
        session_id = args.session_id or _new_session_id()
        output_dir = args.output_dir.resolve()
        records_path = output_dir / f"{session_id}.landmarks.jsonl"
        manifest_path = output_dir / f"{session_id}.manifest.json"
        if records_path.exists() or manifest_path.exists():
            raise FileExistsError(
                f"Session output already exists for {session_id}"
            )

        manifest = _create_manifest(
            args=args,
            session_id=session_id,
            camera_id=resolved_camera_id,
            frame_width=actual_width,
            frame_height=actual_height,
            distance_measurement=distance_measurement,
            records_path=records_path,
        )

        face_options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(
                model_asset_path=str(args.face_model_path)
            ),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.55,
            min_face_presence_confidence=0.55,
            min_tracking_confidence=0.55,
        )
        pose_options = mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(
                model_asset_path=str(args.pose_model_path)
            ),
            running_mode=mp.tasks.vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.55,
            min_pose_presence_confidence=0.55,
            min_tracking_confidence=0.55,
        )
        write_json_atomic(manifest_path, manifest)

        recording = False
        selected_labels = set()
        transition = False
        session_started_at = time.monotonic()
        last_sample_attempt_at = 0.0
        last_timestamp_ms = -1
        capture_error = None
        interrupted = False

        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            with (
                records_path.open("x", encoding="utf-8", buffering=1) as stream,
                mp.tasks.vision.FaceLandmarker.create_from_options(
                    face_options
                ) as face_landmarker,
                mp.tasks.vision.PoseLandmarker.create_from_options(
                    pose_options
                ) as pose_landmarker,
            ):
                pending_frame = first_frame
                first_frame = None
                while True:
                    if pending_frame is not None:
                        frame = pending_frame
                        pending_frame = None
                    else:
                        ok, frame = camera.read()
                        if not ok:
                            raise RuntimeError("Webcam frame read failed")

                    now = time.monotonic()
                    timestamp_ms = max(
                        last_timestamp_ms + 1,
                        int((now - session_started_at) * 1000),
                    )
                    last_timestamp_ms = timestamp_ms
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    image = mp.Image(
                        image_format=mp.ImageFormat.SRGB,
                        data=rgb,
                    )
                    face_result = face_landmarker.detect_for_video(
                        image,
                        timestamp_ms,
                    )
                    pose_result = pose_landmarker.detect_for_video(
                        image,
                        timestamp_ms,
                    )
                    face_landmarks = (
                        face_result.face_landmarks[0]
                        if face_result.face_landmarks
                        else None
                    )
                    pose_landmarks = (
                        pose_result.pose_landmarks[0]
                        if pose_result.pose_landmarks
                        else None
                    )
                    pose_world_landmarks = (
                        pose_result.pose_world_landmarks[0]
                        if pose_result.pose_world_landmarks
                        else None
                    )
                    posture = analyze_posture(
                        pose_landmarks,
                        pose_world_landmarks,
                        image_width=frame.shape[1],
                        image_height=frame.shape[0],
                    )
                    visibility_state = posture["visibility_state"]
                    record_labels = (
                        selected_labels
                        if visibility_state == "visible"
                        else set()
                    )
                    capture_quality = evaluate_capture_quality(
                        posture,
                        selected_labels,
                        transition=transition,
                    )

                    if (
                        recording
                        and now - last_sample_attempt_at
                        >= 1.0 / args.sample_rate_hz
                    ):
                        last_sample_attempt_at = now
                        if capture_quality["valid"]:
                            record = build_landmark_record(
                                session_id=session_id,
                                subject_id=args.subject_id,
                                camera_id=resolved_camera_id,
                                timestamp_ms=timestamp_ms,
                                distance_measurement=distance_measurement,
                                visibility_state=visibility_state,
                                posture_labels=record_labels,
                                transition=transition,
                                face_landmarks=face_landmarks,
                                pose_landmarks=pose_landmarks,
                                frame_width=frame.shape[1],
                                frame_height=frame.shape[0],
                            )
                            validate_landmark_record(record, validator)
                            _append_jsonl(stream, record)
                            _update_manifest_counts(manifest, record)
                        else:
                            _update_manifest_rejections(
                                manifest,
                                capture_quality["rejection_reasons"],
                            )
                        attempted_count = (
                            manifest["sample_count"]
                            + manifest["rejected_sample_count"]
                        )
                        if attempted_count % 25 == 0:
                            write_json_atomic(manifest_path, manifest)
                        if (
                            args.max_records > 0
                            and manifest["sample_count"] >= args.max_records
                        ):
                            break

                    mirrored = not args.no_mirror_preview
                    display = cv2.flip(frame, 1) if mirrored else frame.copy()
                    _draw_connections(
                        cv2,
                        display,
                        face_landmarks,
                        mp.tasks.vision.FaceLandmarksConnections.FACE_LANDMARKS_CONTOURS,
                        (80, 220, 80),
                        mirrored=mirrored,
                    )
                    _draw_connections(
                        cv2,
                        display,
                        pose_landmarks,
                        mp.tasks.vision.PoseLandmarksConnections.POSE_LANDMARKS,
                        (30, 180, 255),
                        mirrored=mirrored,
                    )
                    _draw_pose_points(
                        cv2,
                        display,
                        pose_landmarks,
                        mirrored=mirrored,
                    )
                    selected_annotation = normalize_posture_annotation(
                        "visible",
                        selected_labels,
                    )
                    selected_text = (
                        ",".join(selected_annotation["posture_labels"])
                        or "good (no posture labels)"
                    )
                    distance_text = (
                        f"{distance_measurement['actual_distance_cm']:.1f} cm "
                        f"({distance_measurement['distance_measurement_method']})"
                        if distance_measurement["distance_measurement_status"]
                        == "measured"
                        else distance_measurement["distance_measurement_status"]
                    )
                    if capture_quality["valid"]:
                        quality_lines = ["Capture quality: READY"]
                    else:
                        quality_lines = ["Capture quality: BLOCKED"]
                        quality_lines.extend(
                            "Fix: " + QUALITY_REASON_TEXT.get(reason, reason)
                            for reason in capture_quality["rejection_reasons"]
                        )
                    lines = [
                        (
                            f"RECORDING={'ON' if recording else 'OFF'} | "
                            f"records={manifest['sample_count']} | "
                            f"rejected={manifest['rejected_sample_count']} | "
                            f"visibility={visibility_state}"
                        ),
                        f"Human labels: {selected_text}",
                        *quality_lines,
                        _posture_summary(posture),
                        (
                            f"Distance: {distance_text} | "
                            f"transition={'ON' if transition else 'OFF'}"
                        ),
                        "SPACE record | G good | 1 head | 2 trunk | 3 left shoulder | 4 right shoulder",
                        "T transition | Q/ESC finish | left/right are anatomical (preview may be mirrored)",
                    ]
                    if recording and capture_quality["valid"]:
                        panel_color = (70, 230, 70)
                    elif recording:
                        panel_color = (70, 70, 240)
                    else:
                        panel_color = (80, 190, 255)
                    _draw_status_panel(cv2, display, lines, panel_color)
                    cv2.imshow(WINDOW_TITLE, display)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), ord("Q"), 27):
                        break
                    if key == ord(" "):
                        recording = not recording
                        if recording:
                            last_sample_attempt_at = 0.0
                    elif key in (ord("g"), ord("G")):
                        selected_labels.clear()
                    elif key in (ord("t"), ord("T")):
                        transition = not transition
                    elif key in LABEL_KEY_MAP:
                        selected_labels = _toggle_label(
                            selected_labels,
                            LABEL_KEY_MAP[key],
                        )

                    del image, rgb, frame
        except KeyboardInterrupt:
            interrupted = True
        except Exception as error:
            capture_error = error
        finally:
            cv2.destroyAllWindows()

        manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
        manifest["status"] = (
            "failed"
            if capture_error is not None
            else "aborted" if interrupted else "completed"
        )
        if records_path.exists():
            manifest["records_sha256"] = _records_sha256(records_path)
        write_json_atomic(manifest_path, manifest)

        print(f"Landmark records: {records_path}")
        print(f"Session manifest: {manifest_path}")
        print(f"Validated records: {manifest['sample_count']}")
        print(f"Rejected sample attempts: {manifest['rejected_sample_count']}")
        print("Images saved: 0")
        if capture_error is not None:
            raise capture_error
        return 2 if interrupted else 0
    finally:
        camera.release()


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            "Collect schema-validated Face/Pose landmarks without saving images."
        )
    )
    parser.add_argument("--subject-id", default="subject-001")
    parser.add_argument("--session-id")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-id", help="Stable anonymous camera identifier.")
    parser.add_argument("--frame-width", type=int, default=640)
    parser.add_argument("--frame-height", type=int, default=480)
    parser.add_argument(
        "--face-model-path",
        type=Path,
        default=_default_face_model_path(),
    )
    parser.add_argument(
        "--pose-model-path",
        type=Path,
        default=_default_pose_model_path(),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=_default_output_dir(),
    )
    parser.add_argument(
        "--sample-rate-hz",
        type=float,
        default=DEFAULT_SAMPLE_RATE_HZ,
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=0,
        help="Stop after this many records; 0 means unlimited.",
    )
    parser.add_argument("--distance-cm", type=float)
    parser.add_argument(
        "--distance-status",
        choices=("measured", "not_measured", "invalid"),
    )
    parser.add_argument(
        "--method",
        choices=sorted(MEASUREMENT_METHODS),
        default="tape_measure",
    )
    parser.add_argument("--uncertainty-cm", type=float, default=1.0)
    parser.add_argument(
        "--no-mirror-preview",
        action="store_true",
        help="Show the camera preview without horizontal mirroring.",
    )
    return parser


def _validate_args(args):
    if not 0 <= args.camera_index <= 8:
        raise ValueError("camera-index must be between 0 and 8")
    if not re.fullmatch(r"subject-[A-Za-z0-9_-]+", args.subject_id):
        raise ValueError("subject-id must use the form subject-<safe-id>")
    if args.session_id and not re.fullmatch(
        r"session-[A-Za-z0-9_-]+",
        args.session_id,
    ):
        raise ValueError("session-id must use the form session-<safe-id>")
    if args.camera_id and not re.fullmatch(
        r"camera-[A-Za-z0-9_-]{1,120}",
        args.camera_id,
    ):
        raise ValueError("camera-id must use the form camera-<safe-id>")
    if args.frame_width <= 0 or args.frame_height <= 0:
        raise ValueError("frame dimensions must be positive")
    if not 1.0 <= args.sample_rate_hz <= 10.0:
        raise ValueError("sample-rate-hz must be between 1 and 10")
    if args.max_records < 0:
        raise ValueError("max-records cannot be negative")
    if not 0.1 <= args.uncertainty_cm <= 5.0:
        raise ValueError("uncertainty-cm must be between 0.1 and 5")
    _distance_measurement_from_args(args)


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        _validate_args(args)
        return run_capture(args)
    except (
        FileNotFoundError,
        FileExistsError,
        ImportError,
        OSError,
        RuntimeError,
        ValueError,
    ) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
