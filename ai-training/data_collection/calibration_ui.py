"""Interactive, privacy-preserving eye-distance camera calibration.

The preview remains in memory. Only scalar eye-separation measurements and the
resulting calibration profile are written to disk.
"""

import argparse
import hashlib
import json
import os
import platform
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

from data_collection.distance_measurement import (
    DEFAULT_MAX_CENTER_OFFSET_X,
    DEFAULT_MAX_CENTER_OFFSET_Y,
    DEFAULT_MAX_EYE_ROLL_DEGREES,
    DEFAULT_MAX_HEAD_PITCH_RATIO,
    DEFAULT_MAX_HEAD_YAW_RATIO,
    DEFAULT_MIN_HEAD_PITCH_RATIO,
    DISTANCE_STANDARD_VERSION,
    MEASUREMENT_METHODS,
    MEASUREMENT_REFERENCE,
    TARGET_DISTANCES_CM,
    analyze_eye_measurement,
    build_calibration_profile,
    normalize_distance_measurement,
)
from mediapipe_runtime import load_mediapipe


WINDOW_TITLE = "Child Monitor - Eye Distance Calibration"
SESSION_VERSION = "1.1.0"

QUALITY_REASON_TEXT = {
    "face_not_detected": "Khong thay khuon mat",
    "eye_geometry_invalid": "Khong xac dinh duoc hai mat",
    "head_yaw": "Hay nhin thang camera",
    "off_center_x": "Di chuyen dau sang trai/phai vao khung xanh",
    "off_center_y": "Nang/ha dau de mat vao khung xanh",
    "head_roll": "Giu hai mat nam ngang",
    "head_pitch": "Khong cui hoac ngua dau",
}


def _parse_distances(value):
    try:
        distances = tuple(float(item.strip()) for item in value.split(","))
    except ValueError as error:
        raise argparse.ArgumentTypeError("distances must be comma-separated numbers") from error
    if len(set(distances)) < 3:
        raise argparse.ArgumentTypeError("at least three distinct distances are required")
    if any(not 20.0 <= distance <= 200.0 for distance in distances):
        raise argparse.ArgumentTypeError("distances must be between 20 and 200 cm")
    return distances


def _default_model_path():
    return REPOSITORY_ROOT / "child-monitor-agent" / "models" / "face_landmarker.task"


def _camera_id(camera_index, frame_width, frame_height):
    source = (
        f"{platform.node()}|opencv-camera:{camera_index}|"
        f"{frame_width}x{frame_height}"
    )
    return f"camera-{hashlib.sha256(source.encode('utf-8')).hexdigest()[:16]}"


def write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def validate_json(payload, schema_path):
    import jsonschema

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(
        schema,
        format_checker=jsonschema.Draft202012Validator.FORMAT_CHECKER,
    )
    validator.validate(payload)


def _draw_lines(cv2, frame, lines, *, color=(255, 255, 255)):
    overlay = frame.copy()
    cv2.rectangle(overlay, (8, 8), (frame.shape[1] - 8, 34 + 27 * len(lines)), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.62, frame, 0.38, 0, frame)
    for index, line in enumerate(lines):
        cv2.putText(
            frame,
            line,
            (18, 32 + index * 27),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            color,
            1,
            cv2.LINE_AA,
        )


def _draw_alignment_guide(cv2, frame, quality):
    height, width = frame.shape[:2]
    center_x = width // 2
    center_y = height // 2
    half_width = int(width * DEFAULT_MAX_CENTER_OFFSET_X)
    half_height = int(height * DEFAULT_MAX_CENTER_OFFSET_Y)
    valid = bool(quality and quality.get("valid"))
    color = (50, 220, 50) if valid else (30, 180, 255)
    cv2.rectangle(
        frame,
        (center_x - half_width, center_y - half_height),
        (center_x + half_width, center_y + half_height),
        color,
        2,
    )
    cv2.line(frame, (center_x - 12, center_y), (center_x + 12, center_y), color, 1)
    cv2.line(frame, (center_x, center_y - 12), (center_x, center_y + 12), color, 1)
    if quality and "eye_center_x" in quality:
        eye_x = int(quality["eye_center_x"] * width)
        eye_y = int(quality["eye_center_y"] * height)
        cv2.circle(frame, (eye_x, eye_y), 6, color, -1)


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


def _create_session(args, camera_id, actual_width, actual_height):
    now = datetime.now(timezone.utc)
    return {
        "session_version": SESSION_VERSION,
        "distance_standard_version": DISTANCE_STANDARD_VERSION,
        "session_id": f"calibration-{now.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        "subject_id": args.subject_id,
        "camera_id": camera_id,
        "camera_index": args.camera_index,
        "frame_width": actual_width,
        "frame_height": actual_height,
        "distance_reference": MEASUREMENT_REFERENCE,
        "distance_measurement_method": args.method,
        "distance_uncertainty_cm": args.uncertainty_cm,
        "target_distances_cm": list(args.distances),
        "sample_interval_seconds": round(1.0 / args.sample_rate_hz, 3),
        "capture_seconds_per_distance": args.capture_seconds,
        "quality_limits": {
            "max_head_yaw_ratio": DEFAULT_MAX_HEAD_YAW_RATIO,
            "max_center_offset_x": DEFAULT_MAX_CENTER_OFFSET_X,
            "max_center_offset_y": DEFAULT_MAX_CENTER_OFFSET_Y,
            "max_eye_roll_degrees": DEFAULT_MAX_EYE_ROLL_DEGREES,
            "min_head_pitch_ratio": DEFAULT_MIN_HEAD_PITCH_RATIO,
            "max_head_pitch_ratio": DEFAULT_MAX_HEAD_PITCH_RATIO,
        },
        "started_at": now.isoformat(),
        "completed_at": None,
        "status": "running",
        "samples": [],
        "distance_summaries": [],
    }


def _finish_and_save(session, output_dir, *, aborted=False):
    session["status"] = "aborted" if aborted else "completed"
    session["completed_at"] = datetime.now(timezone.utc).isoformat()
    session_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_session.schema.json"
    )
    validate_json(session, session_schema)
    session_path = output_dir / f"{session['session_id']}.session.json"
    write_json_atomic(session_path, session)
    return session_path


def run_calibration(args):
    runtime_cache = Path(tempfile.gettempdir()) / "ChildMonitorCalibration" / "matplotlib"
    runtime_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("MPLCONFIGDIR", str(runtime_cache))

    import cv2

    mp = load_mediapipe()

    if not args.model_path.is_file():
        raise FileNotFoundError(f"Face Landmarker model not found: {args.model_path}")

    camera = _open_camera(
        cv2,
        args.camera_index,
        args.frame_width,
        args.frame_height,
    )
    actual_width = int(camera.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_height = int(camera.get(cv2.CAP_PROP_FRAME_HEIGHT))
    camera_id = args.camera_id or _camera_id(
        args.camera_index,
        actual_width,
        actual_height,
    )
    session = _create_session(args, camera_id, actual_width, actual_height)
    output_dir = args.output_dir.resolve()

    face_options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model_path)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.6,
        min_face_presence_confidence=0.6,
        min_tracking_confidence=0.6,
    )

    distance_index = 0
    session_started_at = time.monotonic()
    state = "waiting"
    state_started = time.monotonic()
    last_sample_at = 0.0
    current_samples = []
    message = ""
    aborted = False
    latest_quality = {"valid": False, "rejection_reason": "face_not_detected"}

    try:
        with mp.tasks.vision.FaceLandmarker.create_from_options(face_options) as landmarker:
            while distance_index < len(args.distances):
                ok, frame = camera.read()
                if not ok:
                    raise RuntimeError("Webcam frame read failed")

                now = time.monotonic()
                target_distance = args.distances[distance_index]

                should_detect = now - last_sample_at >= 1.0 / args.sample_rate_hz
                if should_detect:
                    last_sample_at = now
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                    result = landmarker.detect_for_video(image, int(now * 1000))
                    landmarks = result.face_landmarks[0] if result.face_landmarks else None
                    latest_quality = analyze_eye_measurement(
                        landmarks,
                        frame.shape[1],
                        frame.shape[0],
                    )

                    if state == "settling" and not latest_quality["valid"]:
                        # Require a full, continuously valid settling period.
                        state_started = now

                    if state == "capturing" and latest_quality["valid"]:
                        normalized = normalize_distance_measurement(
                            target_distance,
                            method=args.method,
                            uncertainty_cm=args.uncertainty_cm,
                        )
                        sample = {
                            "timestamp_ms": int((now - session_started_at) * 1000),
                            **normalized,
                            **{
                                key: value
                                for key, value in latest_quality.items()
                                if key not in {"valid", "rejection_reason"}
                            },
                        }
                        current_samples.append(sample)

                if state == "settling":
                    remaining = args.settle_seconds - (now - state_started)
                    if remaining <= 0:
                        state = "capturing"
                        state_started = now
                        last_sample_at = 0.0
                        current_samples = []
                        message = ""
                elif state == "capturing":
                    elapsed = now - state_started
                    if elapsed >= args.capture_seconds:
                        expected = max(1, int(args.capture_seconds * args.sample_rate_hz))
                        required = max(6, int(expected * args.minimum_valid_ratio))
                        if len(current_samples) < required:
                            state = "waiting"
                            message = (
                                f"Khong du mau hop le ({len(current_samples)}/{required}). "
                                "Nhan SPACE de thu lai."
                            )
                            current_samples = []
                        else:
                            session["samples"].extend(current_samples)
                            session["distance_summaries"].append(
                                {
                                    "actual_distance_cm": target_distance,
                                    "valid_sample_count": len(current_samples),
                                    "expected_sample_count": expected,
                                    "valid_ratio": round(
                                        min(1.0, len(current_samples) / expected),
                                        3,
                                    ),
                                }
                            )
                            distance_index += 1
                            state = "waiting"
                            current_samples = []
                            message = "Da thu xong khoang cach truoc."
                            if distance_index >= len(args.distances):
                                break

                if state == "waiting":
                    alignment_text = (
                        "Mat da can chinh - nhan SPACE de bat dau"
                        if latest_quality["valid"]
                        else QUALITY_REASON_TEXT.get(
                            latest_quality.get("rejection_reason"),
                            "Can chinh lai khuon mat",
                        )
                    )
                    lines = [
                        f"Khoang cach {distance_index + 1}/{len(args.distances)}: {target_distance:.1f} cm",
                        "Do tu TAM ONG KINH den DIEM GIUA HAI MAT.",
                        alignment_text,
                        "Q/ESC: huy | R: thu lai khoang cach hien tai",
                    ]
                elif state == "settling":
                    remaining = max(0.0, args.settle_seconds - (now - state_started))
                    lines = [
                        f"Khoang cach: {target_distance:.1f} cm",
                        f"GIU NGUYEN - bat dau sau {remaining:.1f} giay",
                        QUALITY_REASON_TEXT.get(
                            latest_quality.get("rejection_reason"),
                            "Mat hop le - tiep tuc giu nguyen",
                        )
                        if not latest_quality["valid"]
                        else "Mat hop le - tiep tuc giu nguyen",
                    ]
                else:
                    elapsed = now - state_started
                    lines = [
                        f"Dang thu: {target_distance:.1f} cm",
                        f"Thoi gian: {elapsed:.1f}/{args.capture_seconds:.1f} giay",
                        f"Mau hop le: {len(current_samples)}",
                        "Mat hop le"
                        if latest_quality["valid"]
                        else QUALITY_REASON_TEXT.get(
                            latest_quality.get("rejection_reason"),
                            "Can chinh lai khuon mat",
                        ),
                    ]
                if message:
                    lines.append(message)

                _draw_alignment_guide(cv2, frame, latest_quality)
                _draw_lines(
                    cv2,
                    frame,
                    lines,
                    color=(70, 220, 70)
                    if latest_quality["valid"]
                    else (80, 180, 255),
                )
                cv2.imshow(WINDOW_TITLE, frame)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("q"), 27):
                    aborted = True
                    break
                if key == ord("r"):
                    state = "waiting"
                    current_samples = []
                    message = "Da dat lai khoang cach hien tai."
                elif key == ord(" ") and state == "waiting":
                    if latest_quality["valid"]:
                        state = "settling"
                        state_started = now
                        last_sample_at = 0.0
                        current_samples = []
                        message = ""
                    else:
                        message = "Can chinh mat vao khung xanh truoc khi bat dau."
    finally:
        camera.release()
        cv2.destroyAllWindows()

    if aborted:
        session_path = _finish_and_save(session, output_dir, aborted=True)
        print(f"Calibration aborted. Session metadata: {session_path}")
        return 2

    if args.session_only:
        session_path = _finish_and_save(session, output_dir)
        print(f"Calibration session completed: {session_path}")
        print("Session-only mode: no profile was fitted or written.")
        return 0

    profile = build_calibration_profile(
        session["samples"],
        camera_id=camera_id,
        subject_id=args.subject_id,
        frame_width=actual_width,
        frame_height=actual_height,
        source_session_ids=[session["session_id"]],
    )
    profile_schema = (
        TRAINING_ROOT / "datasets" / "schema" / "calibration_profile.schema.json"
    )
    validate_json(profile, profile_schema)
    session_path = _finish_and_save(session, output_dir)
    profile_path = output_dir / f"{camera_id}-{args.subject_id}.profile.json"
    write_json_atomic(profile_path, profile)

    print(f"Calibration completed: {profile_path}")
    print(f"Session samples: {session_path}")
    coefficients = profile["coefficients"]
    print(
        "Coefficients [slope, intercept]: "
        f"[{coefficients['slope']:.8f}, "
        f"{coefficients['intercept']:.8f}]"
    )
    print(f"Training MAE: {profile['training_metrics']['mae_cm']:.2f} cm")
    print("Training metrics are not independent validation results.")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(
        description="Collect real eye-distance measurements and create a local profile."
    )
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-id", help="Stable anonymous camera identifier.")
    parser.add_argument("--subject-id", default="subject-001")
    parser.add_argument(
        "--model-path",
        type=Path,
        default=_default_model_path(),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=TRAINING_ROOT / "datasets" / "calibration",
    )
    parser.add_argument(
        "--distances",
        type=_parse_distances,
        default=TARGET_DISTANCES_CM,
        help="Comma-separated measured distances in cm.",
    )
    parser.add_argument(
        "--method",
        choices=sorted(MEASUREMENT_METHODS),
        default="tape_measure",
    )
    parser.add_argument("--uncertainty-cm", type=float, default=1.0)
    parser.add_argument("--capture-seconds", type=float, default=20.0)
    parser.add_argument("--settle-seconds", type=float, default=3.0)
    parser.add_argument("--sample-rate-hz", type=float, default=5.0)
    parser.add_argument("--minimum-valid-ratio", type=float, default=0.6)
    parser.add_argument("--frame-width", type=int, default=640)
    parser.add_argument("--frame-height", type=int, default=480)
    parser.add_argument(
        "--session-only",
        action="store_true",
        help="Collect a session without fitting a profile (for final testing).",
    )
    return parser


def _validate_args(args):
    if not 0 <= args.camera_index <= 8:
        raise ValueError("camera-index must be between 0 and 8")
    if not re.fullmatch(r"subject-[A-Za-z0-9_-]+", args.subject_id):
        raise ValueError("subject-id must use the form subject-<safe-id>")
    if args.camera_id and not re.fullmatch(
        r"camera-[A-Za-z0-9_-]{1,120}",
        args.camera_id,
    ):
        raise ValueError("camera-id must use the form camera-<safe-id>")
    if not 0.1 <= args.uncertainty_cm <= 5.0:
        raise ValueError("uncertainty-cm must be between 0.1 and 5")
    if not 5.0 <= args.capture_seconds <= 120.0:
        raise ValueError("capture-seconds must be between 5 and 120")
    if not 0.0 <= args.settle_seconds <= 15.0:
        raise ValueError("settle-seconds must be between 0 and 15")
    if not 1.0 <= args.sample_rate_hz <= 10.0:
        raise ValueError("sample-rate-hz must be between 1 and 10")
    if args.capture_seconds * args.sample_rate_hz < 6:
        raise ValueError("capture duration and sample rate must yield at least 6 samples")
    if not 0.5 <= args.minimum_valid_ratio <= 1.0:
        raise ValueError("minimum-valid-ratio must be between 0.5 and 1")
    if args.frame_width <= 0 or args.frame_height <= 0:
        raise ValueError("frame dimensions must be positive")


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        _validate_args(args)
        return run_calibration(args)
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    raise SystemExit(main())
