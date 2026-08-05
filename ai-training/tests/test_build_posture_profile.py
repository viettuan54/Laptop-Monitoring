import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


TRAINING_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if TRAINING_ROOT not in sys.path:
    sys.path.insert(0, TRAINING_ROOT)
AGENT_COMPANION_ROOT = os.path.join(
    os.path.dirname(TRAINING_ROOT),
    "child-monitor-agent",
    "companion",
)
if AGENT_COMPANION_ROOT not in sys.path:
    sys.path.insert(0, AGENT_COMPANION_ROOT)

from data_collection.build_posture_profile import build_personal_profile
from posture_model import FRAME_FEATURE_NAMES


def _pose():
    points = [
        {"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 1.0}
        for _ in range(33)
    ]
    points[7].update(x=0.43, y=0.25)
    points[8].update(x=0.57, y=0.25)
    points[11].update(x=0.35, y=0.45)
    points[12].update(x=0.65, y=0.45)
    points[23].update(x=0.40, y=0.80)
    points[24].update(x=0.60, y=0.80)
    return points


class BuildPostureProfileTest(unittest.TestCase):
    def test_builds_profile_from_two_checksum_pinned_good_sessions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            accepted = []
            for session_index in range(2):
                session_id = f"session-good-{session_index}"
                records_path = root / f"{session_id}.landmarks.jsonl"
                records = []
                for sample_index in range(30):
                    records.append(
                        json.dumps(
                            {
                                "timestamp_ms": sample_index * 200,
                                "transition": False,
                                "pose_landmarks": _pose(),
                                "frame_width": 640,
                                "frame_height": 480,
                            },
                            separators=(",", ":"),
                        )
                    )
                records_path.write_text("\n".join(records) + "\n", encoding="utf-8")
                digest = hashlib.sha256(records_path.read_bytes()).hexdigest()
                (root / f"{session_id}.manifest.json").write_text(
                    json.dumps(
                        {
                            "session_id": session_id,
                            "subject_id": "subject-test",
                            "camera_id": "camera-test",
                            "frame_width": 640,
                            "frame_height": 480,
                            "quality_gate_version": "2.0.0",
                        }
                    ),
                    encoding="utf-8",
                )
                accepted.append(
                    {
                        "session_id": session_id,
                        "primary_class": "good",
                        "expected_records_sha256": digest,
                    }
                )
            selection_path = root / "accepted_sessions.json"
            selection_path.write_text(
                json.dumps({"accepted_sessions": accepted}),
                encoding="utf-8",
            )

            _, profile = build_personal_profile(
                selection_path,
                "subject-test",
                root / "profile.json",
            )
            self.assertEqual(profile["sample_count"], 60)
            self.assertEqual(len(profile["source_session_ids"]), 2)
            self.assertEqual(
                len(profile["baseline_frame_features"]),
                len(FRAME_FEATURE_NAMES),
            )


if __name__ == "__main__":
    unittest.main()
