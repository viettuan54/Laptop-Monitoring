import os
import sys
import unittest

AGENT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPANION_ROOT = os.path.join(AGENT_ROOT, "companion")
if COMPANION_ROOT not in sys.path:
    sys.path.insert(0, COMPANION_ROOT)

from mediapipe_runtime import load_mediapipe


class MediaPipeRuntimeTest(unittest.TestCase):
    def test_loads_tasks_without_native_matplotlib_extension(self):
        mediapipe = load_mediapipe()
        self.assertEqual(mediapipe.__version__, "0.10.33")
        self.assertTrue(hasattr(mediapipe.tasks.vision, "FaceLandmarker"))
        self.assertTrue(hasattr(mediapipe.tasks.vision, "PoseLandmarker"))
        self.assertNotIn("matplotlib._c_internal_utils", sys.modules)


if __name__ == "__main__":
    unittest.main()
