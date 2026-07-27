# MediaPipe model assets

The Agent bundles the official Google MediaPipe task models so installation and
inference do not download models at runtime.

| File | Official source | SHA-256 |
| --- | --- | --- |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task` | `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF` |
| `pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task` | `59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A` |

Downloaded on 2026-07-27. The installer verifies both hashes before copying the
models into the protected Agent installation directory.
