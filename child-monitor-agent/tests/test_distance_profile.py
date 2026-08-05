import copy
import os
import sys
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from distance_profile import (
    EXPECTED_PROFILE_SHA256,
    PROFILE_FILENAME,
    assert_profile_compatible,
    camera_id,
    expected_hash_from_sidecar,
    load_distance_profile,
    validate_distance_profile,
)


class DistanceProfileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile_path = os.path.join(
            AGENT_ROOT,
            "models",
            PROFILE_FILENAME,
        )
        expected_hash = expected_hash_from_sidecar(cls.profile_path)
        cls.profile, cls.profile_sha256 = load_distance_profile(
            cls.profile_path,
            expected_sha256=expected_hash,
        )

    def test_packaged_frozen_profile_passes_integrity_and_schema_checks(self):
        self.assertEqual(self.profile_sha256, EXPECTED_PROFILE_SHA256)
        self.assertEqual(self.profile["profile_version"], "3.0.0")
        self.assertEqual(
            self.profile["model_type"],
            "monotonic_inverse_eye_separation_linear",
        )

    def test_integrity_check_rejects_a_different_hash(self):
        with self.assertRaisesRegex(ValueError, "integrity check failed"):
            load_distance_profile(self.profile_path, expected_sha256="0" * 64)

    def test_profile_compatibility_is_bound_to_camera_resolution_and_threshold(self):
        profile = copy.deepcopy(self.profile)
        profile["camera_id"] = camera_id(
            2,
            640,
            480,
            hostname="unit-host",
        )
        result = assert_profile_compatible(
            profile,
            camera_index=2,
            frame_width=640,
            frame_height=480,
            threshold_cm=35.0,
            hostname="unit-host",
        )
        self.assertEqual(result, profile["camera_id"])

        with self.assertRaisesRegex(ValueError, "frame_width"):
            assert_profile_compatible(
                profile,
                camera_index=2,
                frame_width=1280,
                frame_height=480,
                threshold_cm=35.0,
                hostname="unit-host",
            )
        with self.assertRaisesRegex(ValueError, "threshold_cm"):
            assert_profile_compatible(
                profile,
                camera_index=2,
                frame_width=640,
                frame_height=480,
                threshold_cm=40.0,
                hostname="unit-host",
            )
        with self.assertRaisesRegex(ValueError, "subject_id"):
            assert_profile_compatible(
                profile,
                camera_index=2,
                frame_width=640,
                frame_height=480,
                threshold_cm=35.0,
                subject_id="subject-other",
                hostname="unit-host",
            )

    def test_profile_validator_rejects_non_monotonic_coefficients(self):
        profile = copy.deepcopy(self.profile)
        profile["coefficients"]["slope"] = 0
        with self.assertRaisesRegex(ValueError, "slope must be positive"):
            validate_distance_profile(profile)


if __name__ == "__main__":
    unittest.main()
