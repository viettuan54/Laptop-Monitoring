# MediaPipe model assets

The Agent bundles the official Google MediaPipe task models so installation and
inference do not download models at runtime.

| File | Official source | SHA-256 |
| --- | --- | --- |
| `face_landmarker.task` | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task` | `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF` |
| `pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task` | `59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A` |
| `eye_distance_profile_v3.json` | Frozen subject-camera profile from `ai-training` | `815FB3E281EB68D55FC45D513F215A53676519161C5A5CEA20A5EA7FEEB4B472` |

`eye_distance_profile_v3.json.sha256` pins the exact personal distance profile
installed on a device. The installer regenerates this sidecar when
`-EyeDistanceProfilePath` is supplied.

After at least three subjects have been collected and LOSO evaluation has
completed, these optional JSON assets can also be installed:

- `posture_baseline_v1.json`: population baseline classifier.
- `posture_profile_v1.json`: neutral-posture baseline for one subject/camera.

The installer writes a `.sha256` sidecar for each optional asset. If either
asset is missing, malformed, incompatible or low-confidence, Agent keeps the
geometry rule layer active.

The MediaPipe tasks were downloaded on 2026-07-27. The installer verifies every
listed hash before copying these assets into the protected Agent installation
directory. The v3 distance profile passed its independent final test on
2026-07-31. Its JSON is stored with LF line endings so the integrity hash is
stable across Windows checkouts.
