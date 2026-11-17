import unittest
from unittest.mock import patch
import numpy as np
from face_embedding_extractor import extract_frame


class Detector:
    def __init__(self, faces): self.faces = faces
    def detect_faces(self, _): return self.faces


class FaceQualityTests(unittest.TestCase):
    def setUp(self):
        self.policy = dict(detection_threshold=.98, min_face_pixels=80)
        self.good = dict(box=[30, 30, 100, 100], confidence=.999)

    def extract(self, faces):
        with patch('face_embedding_extractor.cv2.imread', return_value=np.zeros((240, 320, 3), dtype=np.uint8)), \
             patch('face_embedding_extractor.create_embedding', return_value=np.ones(128) / np.sqrt(128)):
            return extract_frame('test.jpg', Detector(faces), None, self.policy)

    def test_one_high_confidence_face(self):
        self.assertEqual(len(self.extract([self.good])), 128)

    def test_no_face_and_multiple_faces(self):
        for faces in [[], [self.good, self.good], [self.good, dict(box=[1,1,20,20], confidence=.1)]]:
            with self.assertRaisesRegex(ValueError, 'exactly_one_face'):
                self.extract(faces)

    def test_low_confidence(self):
        with self.assertRaisesRegex(ValueError, 'confidence_low'):
            self.extract([dict(self.good, confidence=.8)])

    def test_small_or_clipped(self):
        for box in [[0,0,40,40], [-1,20,100,100], [300,20,100,100]]:
            with self.assertRaisesRegex(ValueError, 'too_small_or_cropped'):
                self.extract([dict(self.good, box=box)])


if __name__ == '__main__': unittest.main()
