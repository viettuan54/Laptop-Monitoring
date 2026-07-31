"""Privacy-preserving MediaPipe/OpenCV monitoring in the user session."""

import logging
import os
import tempfile
import threading
import time
from collections import deque

from distance_profile import (
    PROFILE_FILENAME,
    assert_profile_compatible,
    load_distance_profile,
)
from vision_metrics import (
    analyze_calibrated_eye_distance,
    analyze_posture,
    estimate_eye_distance_cm,
)


DEFAULT_CONFIG = {
    "enabled": False,
    "camera_index": 0,
    "sample_interval_seconds": 0.5,
    "alert_hold_seconds": 5.0,
    "alert_cooldown_seconds": 300.0,
    "min_eye_distance_cm": 35.0,
    "camera_horizontal_fov_degrees": 60.0,
    "assumed_ipd_cm": 6.3,
    "eye_distance_calibration_scale_cm": 0.0,
    "max_neck_angle_degrees": 25.0,
    "max_torso_angle_degrees": 18.0,
    "max_shoulder_tilt_degrees": 12.0,
}


def _bounded_number(value, default, minimum, maximum):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def normalize_vision_config(config):
    source = config if isinstance(config, dict) else {}
    return {
        "enabled": source.get("enabled") is True,
        "camera_index": int(_bounded_number(source.get("camera_index"), 0, 0, 8)),
        "sample_interval_seconds": _bounded_number(
            source.get("sample_interval_seconds"), 0.5, 0.2, 5.0
        ),
        "alert_hold_seconds": _bounded_number(
            source.get("alert_hold_seconds"), 5.0, 2.0, 60.0
        ),
        "alert_cooldown_seconds": _bounded_number(
            source.get("alert_cooldown_seconds"), 300.0, 60.0, 3600.0
        ),
        "min_eye_distance_cm": _bounded_number(
            source.get("min_eye_distance_cm"), 35.0, 20.0, 80.0
        ),
        "camera_horizontal_fov_degrees": _bounded_number(
            source.get("camera_horizontal_fov_degrees"), 60.0, 20.0, 140.0
        ),
        "assumed_ipd_cm": _bounded_number(
            source.get("assumed_ipd_cm"), 6.3, 4.0, 8.5
        ),
        "eye_distance_calibration_scale_cm": _bounded_number(
            source.get("eye_distance_calibration_scale_cm"), 0.0, 0.0, 20.0
        ),
        "max_neck_angle_degrees": _bounded_number(
            source.get("max_neck_angle_degrees"), 25.0, 5.0, 60.0
        ),
        "max_torso_angle_degrees": _bounded_number(
            source.get("max_torso_angle_degrees"), 18.0, 5.0, 60.0
        ),
        "max_shoulder_tilt_degrees": _bounded_number(
            source.get("max_shoulder_tilt_degrees"), 12.0, 3.0, 45.0
        ),
    }


class SustainedAlertGate:
    """Use a time-window vote, then apply an alert cooldown.

    ``active=None`` means that landmarks were unavailable. Such a sample is
    ignored instead of resetting an otherwise stable observation window.
    """

    def __init__(self, active_ratio=0.8, minimum_samples=3):
        self.active_ratio = active_ratio
        self.minimum_samples = minimum_samples
        self.observations = {}
        self.last_alerted = {}

    def observe(self, key, active, now, hold_seconds, cooldown_seconds):
        samples = self.observations.setdefault(key, deque())
        cutoff = now - hold_seconds
        while samples and samples[0][0] < cutoff:
            samples.popleft()
        if active is not None:
            samples.append((now, bool(active)))

        if len(samples) < self.minimum_samples:
            return False
        if samples[-1][0] - samples[0][0] < hold_seconds * 0.8:
            return False
        active_count = sum(1 for _, value in samples if value)
        if active_count / len(samples) < self.active_ratio:
            return False

        last_alert = self.last_alerted.get(key)
        if last_alert is not None and now - last_alert < cooldown_seconds:
            return False
        self.last_alerted[key] = now
        return True

    def reset(self, key):
        self.observations.pop(key, None)


class EdgeVisionMonitor:
    def __init__(self, pipe_client, warning_callback=None, models_dir=None):
        self.pipe_client = pipe_client
        self.warning_callback = warning_callback
        self.models_dir = models_dir or os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "models",
        )
        self.face_model_path = os.path.join(self.models_dir, "face_landmarker.task")
        self.pose_model_path = os.path.join(self.models_dir, "pose_landmarker_lite.task")
        self.distance_profile_path = os.path.join(
            self.models_dir,
            PROFILE_FILENAME,
        )
        self._config = DEFAULT_CONFIG.copy()
        self._config_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread = None
        self._gate = SustainedAlertGate()

    def update_config(self, response_or_config):
        if not isinstance(response_or_config, dict):
            return
        source = response_or_config
        if "vision_config" in source:
            config = source["vision_config"]
        elif "enabled" in source:
            config = source
        else:
            return
        normalized = normalize_vision_config(config)
        with self._config_lock:
            changed = normalized != self._config
            self._config = normalized
        if changed:
            logging.info(
                "Edge vision policy updated: %s",
                "enabled" if normalized["enabled"] else "disabled",
            )

    def _get_config(self):
        with self._config_lock:
            return self._config.copy()

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="EdgeVisionMonitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)

    def _send_alert(self, alert_type, message, metrics):
        response = self.pipe_client.send_vision_alert(alert_type, message, metrics)
        if response is None:
            logging.warning("Vision alert could not be persisted by the Service.")
            return
        logging.warning("Queued local Edge AI alert: %s", message)
        if self.warning_callback:
            self.warning_callback(alert_type, message)

    def _load_compatible_distance_profile(self, config, width, height):
        if not os.path.isfile(self.distance_profile_path):
            logging.warning(
                "Eye-distance profile is missing; using the geometric fallback."
            )
            return None, None
        try:
            profile, profile_sha256 = load_distance_profile(
                self.distance_profile_path
            )
            assert_profile_compatible(
                profile,
                camera_index=config["camera_index"],
                frame_width=width,
                frame_height=height,
                threshold_cm=config["min_eye_distance_cm"],
            )
        except (OSError, ValueError) as error:
            logging.warning(
                "Eye-distance profile is unavailable for this runtime (%s); "
                "using the geometric fallback.",
                error,
            )
            return None, None

        policy = profile["decision_policy"]
        logging.info(
            "Eye-distance profile v%s enabled for %s; zones: "
            "warning < %.1f cm, uncertain %.1f-%.1f cm, safe >= %.1f cm.",
            profile["profile_version"],
            profile["camera_id"],
            policy["warning_below_cm"],
            policy["warning_below_cm"],
            policy["safe_at_or_above_cm"],
            policy["safe_at_or_above_cm"],
        )
        return profile, profile_sha256

    def _evaluate(
        self,
        face_result,
        pose_result,
        width,
        height,
        config,
        distance_profile=None,
        distance_profile_sha256=None,
    ):
        now = time.monotonic()
        face_landmarks = (
            face_result.face_landmarks[0]
            if face_result and face_result.face_landmarks
            else None
        )
        if distance_profile is not None:
            eye_metrics = analyze_calibrated_eye_distance(
                face_landmarks,
                width,
                height,
                distance_profile,
            )
            eye_metrics["profile_sha256"] = distance_profile_sha256
            policy = distance_profile["decision_policy"]
            eye_zone = eye_metrics["decision_zone"]
            # "uncertain" implements continue_sampling: it neither adds a
            # warning vote nor clears warning observations in the hold window.
            eye_too_close = (
                True
                if eye_zone == "warning"
                else False if eye_zone == "safe" else None
            )
        else:
            eye_distance = estimate_eye_distance_cm(
                face_landmarks,
                width,
                image_height=height,
                horizontal_fov_degrees=config["camera_horizontal_fov_degrees"],
                assumed_ipd_cm=config["assumed_ipd_cm"],
                calibration_scale_cm=config["eye_distance_calibration_scale_cm"],
            )
            eye_too_close = (
                None
                if eye_distance is None
                else eye_distance < config["min_eye_distance_cm"]
            )
            eye_metrics = {
                "reliable": eye_distance is not None,
                "estimated_distance_cm": eye_distance,
                "estimation_method": (
                    "calibrated_eye_scale"
                    if config["eye_distance_calibration_scale_cm"] >= 1.0
                    else "pinhole_fov_ipd"
                ),
                "profile_version": None,
                "decision_zone": (
                    "unknown"
                    if eye_distance is None
                    else "warning" if eye_too_close else "safe"
                ),
                "outside_feature_range": None,
            }
            policy = {
                "threshold_cm": config["min_eye_distance_cm"],
                "warning_below_cm": config["min_eye_distance_cm"],
                "safe_at_or_above_cm": config["min_eye_distance_cm"],
                "uncertain_action": "not_available_in_fallback",
            }

        if self._gate.observe(
            "eye_distance",
            eye_too_close,
            now,
            config["alert_hold_seconds"],
            config["alert_cooldown_seconds"],
        ):
            eye_distance = eye_metrics["estimated_distance_cm"]
            message = (
                f"Khoảng cách mắt ước tính {eye_distance:.1f} cm, "
                f"thấp hơn vùng cảnh báo {policy['warning_below_cm']:.1f} cm."
            )
            # Keep landmark-derived geometry in memory. Only the minimum
            # diagnostic metadata crosses the local Named Pipe.
            alert_metrics = {
                "estimated_distance_cm": eye_distance,
                "estimation_method": eye_metrics["estimation_method"],
                "decision_zone": eye_metrics["decision_zone"],
                "profile_version": eye_metrics["profile_version"],
                "profile_sha256": eye_metrics.get("profile_sha256"),
                "outside_feature_range": eye_metrics["outside_feature_range"],
                "decision_policy": policy.copy(),
            }
            self._send_alert(
                "eye_distance_warning",
                message,
                alert_metrics,
            )

        pose_landmarks = (
            pose_result.pose_landmarks[0]
            if pose_result and pose_result.pose_landmarks
            else None
        )
        world_landmarks = (
            pose_result.pose_world_landmarks[0]
            if pose_result and pose_result.pose_world_landmarks
            else None
        )
        posture = analyze_posture(
            pose_landmarks,
            world_landmarks,
            image_width=width,
            image_height=height,
            max_neck_angle_degrees=config["max_neck_angle_degrees"],
            max_torso_angle_degrees=config["max_torso_angle_degrees"],
            max_shoulder_tilt_degrees=config["max_shoulder_tilt_degrees"],
        )
        if self._gate.observe(
            "posture",
            posture["is_bad"] if posture["reliable"] else None,
            now,
            config["alert_hold_seconds"],
            config["alert_cooldown_seconds"],
        ):
            neck = posture.get("neck_angle_degrees")
            torso = posture.get("torso_angle_degrees")
            shoulder = posture.get("shoulder_tilt_degrees")
            details = []
            if neck is not None:
                details.append(f"cổ {neck:.1f}°")
            if torso is not None:
                details.append(f"thân {torso:.1f}°")
            if shoulder is not None:
                details.append(f"vai {shoulder:.1f}°")
            message = "Tư thế ngồi chưa phù hợp"
            if details:
                message += f" ({', '.join(details)})"
            message += "."
            self._send_alert("posture_warning", message, posture)

    def _run_enabled(self, config):
        if not os.path.isfile(self.face_model_path) or not os.path.isfile(self.pose_model_path):
            logging.error("MediaPipe model assets are missing from %s", self.models_dir)
            self._stop_event.wait(30)
            return

        try:
            runtime_base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
            matplotlib_cache = os.path.join(
                runtime_base,
                "ChildMonitorAgent",
                "matplotlib",
            )
            os.makedirs(matplotlib_cache, exist_ok=True)
            os.environ.setdefault("MPLCONFIGDIR", matplotlib_cache)
            import cv2
            import mediapipe as mp
        except ImportError as error:
            logging.error("Edge vision dependencies are unavailable: %s", error)
            self._stop_event.wait(30)
            return

        base_options = mp.tasks.BaseOptions
        vision = mp.tasks.vision
        face_options = vision.FaceLandmarkerOptions(
            base_options=base_options(model_asset_path=self.face_model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.55,
            min_face_presence_confidence=0.55,
            min_tracking_confidence=0.55,
        )
        pose_options = vision.PoseLandmarkerOptions(
            base_options=base_options(model_asset_path=self.pose_model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.55,
            min_pose_presence_confidence=0.55,
            min_tracking_confidence=0.55,
        )

        backend = getattr(cv2, "CAP_DSHOW", 0)
        camera = cv2.VideoCapture(config["camera_index"], backend)
        if not camera.isOpened():
            camera.release()
            camera = cv2.VideoCapture(config["camera_index"])
        if not camera.isOpened():
            camera.release()
            logging.warning("Webcam is unavailable; Edge AI will retry.")
            self._stop_event.wait(15)
            return

        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        logging.info("Edge AI camera pipeline started; frames remain in memory only.")
        last_sample = 0.0
        distance_profile = None
        distance_profile_sha256 = None
        distance_profile_checked = False
        self._gate.reset("eye_distance")
        try:
            with (
                vision.FaceLandmarker.create_from_options(face_options) as face_landmarker,
                vision.PoseLandmarker.create_from_options(pose_options) as pose_landmarker,
            ):
                while not self._stop_event.is_set():
                    current_config = self._get_config()
                    if not current_config["enabled"]:
                        break
                    if current_config["camera_index"] != config["camera_index"]:
                        logging.info("Camera selection changed; reopening Edge AI camera.")
                        break
                    if (
                        current_config["min_eye_distance_cm"]
                        != config["min_eye_distance_cm"]
                    ):
                        logging.info(
                            "Eye-distance threshold changed; "
                            "reloading calibration policy."
                        )
                        break

                    now = time.monotonic()
                    wait_seconds = current_config["sample_interval_seconds"] - (
                        now - last_sample
                    )
                    if wait_seconds > 0 and self._stop_event.wait(wait_seconds):
                        break

                    ok, frame = camera.read()
                    if not ok:
                        logging.warning("Webcam frame read failed; reopening camera.")
                        break
                    now = time.monotonic()
                    last_sample = now
                    if not distance_profile_checked:
                        distance_profile, distance_profile_sha256 = (
                            self._load_compatible_distance_profile(
                                current_config,
                                frame.shape[1],
                                frame.shape[0],
                            )
                        )
                        distance_profile_checked = True
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                    timestamp_ms = int(now * 1000)
                    face_result = face_landmarker.detect_for_video(image, timestamp_ms)
                    pose_result = pose_landmarker.detect_for_video(image, timestamp_ms)
                    self._evaluate(
                        face_result,
                        pose_result,
                        frame.shape[1],
                        frame.shape[0],
                        current_config,
                        distance_profile,
                        distance_profile_sha256,
                    )
                    # No image/frame is written to disk or sent over IPC/network.
                    del image, rgb, frame
        finally:
            camera.release()
            logging.info("Edge AI camera pipeline stopped.")

    def _run(self):
        while not self._stop_event.is_set():
            config = self._get_config()
            if not config["enabled"]:
                self._stop_event.wait(1)
                continue
            try:
                self._run_enabled(config)
            except Exception:
                logging.exception("Edge AI pipeline failed and will retry.")
                self._stop_event.wait(10)
