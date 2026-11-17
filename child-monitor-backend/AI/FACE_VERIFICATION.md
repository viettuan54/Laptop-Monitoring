# Account-bound Face Verification

## Login and reset

- After migration v32, existing administrators (including the original account, regardless of its ID) start with `face_enrolled=false`. No training label is automatically assigned to any account. Existing admin sessions are invalidated once.
- `POST /auth/login` checks password, active status and verified email, then returns a one-use, short-lived challenge with `faceMode=enroll|verify`. No admin token exists yet. The old `FACE_AUTH_REQUIRED_FOR_ADMIN=false` bypass is ignored.
- First login captures 5 distinct frames. The server computes the embeddings; browser-supplied user IDs, embeddings, purpose or thresholds are ignored. A normalized mean template is inserted under the challenge's `user_id`, the enrolled flag/version changes, an audit entry is recorded and the session is issued in one transaction.
- Later logins compare all 5 frames to that user's saved template using cosine similarity. No SVM/class label is used. All frames must pass, including the consistency check. Existing templates are never overwritten by login.
- Before enrollment is saved, the normalized candidate template is compared with all other saved templates (including disabled accounts). A cosine score at or above the configured threshold returns `409 FACE_ALREADY_ENROLLED`, without disclosing another account's identity. No template/session is created. The challenge can be retried within its remaining attempts and expiry. Enrollment uses the same transaction advisory lock as reset/account deletion so concurrent enrollments cannot both pass a stale uniqueness check. This is approximate biometric deduplication, not a mathematical guarantee of identity; it shares the provisional threshold and requires live validation. Existing duplicate enrollments are not silently deleted; use the authorized reset flow for the later account.
- Another authenticated, enrolled Admin can use `POST /admin/users/:id/reset-face`, confirming their own password. It removes the target template, increments face/token versions, deletes refresh tokens and pending challenges, and records `user.face_reset`. Self-reset is rejected. Next login requires email verification, password and new enrollment again.
- The supported re-enrollment route is reset by another Admin. A password-only self-service fallback is intentionally absent. A sole Admin who loses access requires a controlled operator recovery procedure; do not bypass verification through frontend changes.
- Challenge purpose, account status, token version, face version and expiry are rechecked after inference under a user-row lock. Concurrent enrollment/replay cannot overwrite the winning template. Reset or password changes invalidate in-flight challenges.

## Model, quality and data

`face_embedding_extractor.py` loads the pinned FaceNet weights through `facenet_runtime.py`: RGB crop, 160×160, per-image mean/std standardization, 128-dimensional output, L2 normalization. This matches the preprocessing of the existing embedding dataset. A model/pipeline fingerprint binds both policy and stored templates; mismatches fail closed.

Every frame must contain exactly one MTCNN detection **before** filtering by confidence. The detection must have confidence ≥0.98, be at least 80 pixels in both dimensions and fully inside the image. File hashes must differ. Zero faces, a second low-confidence face, malformed files, inconsistent faces or invalid embeddings are rejected.

Raw frames exist only in bounded temporary files during inference and are removed in `finally`. The normalized template is biometric data stored in `admin_face_templates`, with RLS enabled and no grants to `app_backend` or PUBLIC. User list/detail APIs expose only enrollment status. Images and embeddings are not included in audit metadata or responses. Deployment storage/backups should protect biometric templates with the same access controls as authentication data.

Distinct files and single-face checks are **not liveness or anti-spoofing**. The current implementation does not claim presentation-attack detection against printed photographs or replayed video.

## Offline calibration (17 November 2026)

Run `.venv-face\Scripts\python.exe AI/calibrate_face_verification.py`.

The script uses 301 embeddings across 9 identities (138 `admin`). A seeded per-identity split uses 179 calibration images and 122 holdout images. Threshold selection sees only calibration comparisons; holdout results do not change the selected threshold. The cosine threshold is **0.713**, not the old SVM probability 0.75. Enrollment consistency uses the same pairwise threshold conservatively.

At the single-frame-to-template level the holdout has 0 observed false accepts in 97,600 correlated comparisons and a 5.36% false-reject rate. These are not independent trials or a production FAR guarantee.

The archived report evaluates the previous 3-frame quality/consistency/matching policy. For the `admin` holdout, 20/100 randomly sampled enrollment batches were rejected; among 80 accepted enrollments, 17 genuine verification batches were rejected, with 0/640 foreign batches accepted. These batch results do not validate the current 5-frame flow. The stricter end-to-end rejection rate matters more for usability than single-frame scores. Other identities vary substantially; see `face_verification_calibration.json`.

**The threshold is provisional, not webcam-validated.** Image-level splits may share capture sessions; sample sizes and identities are limited. Random archived images differ more in pose than adjacent webcam enrollment frames, but this does not establish live usability. Do not silently lower the threshold simply to make a failed login pass.

## Required live validation before production acceptance

1. Use separate test Admin accounts for at least two consenting people; enroll each with normal lighting, one person in frame, then verify them on separate capture sessions.
2. Test genuine attempts with glasses/no glasses when relevant, moderate head angle, indoor light, different days/devices. Record rejected enrollment and rejected genuine batches separately.
3. Test person B against account A and vice versa, plus people not enrolled. Also test blank frames, two faces, partial faces and duplicate image files. No wrong-person acceptance is acceptable in this small acceptance set.
4. Exercise expired/replayed challenges, password change, disabled accounts, and reset while inference is running. Confirm no session is issued and that reset removes old templates/sessions.
5. Record camera, lighting, trial counts and errors without storing raw face images by default. Recalibrate on separate development samples if necessary and evaluate a fresh holdout. Only then mark the policy `webcam_validated=true` as a documented operator acceptance result; the flag is descriptive and does not bypass checks.

## Deployment

Deploy the backend, frontend, Python runtime and policy together. Run `migration_v32.sql` before starting the new backend. Back up the database first. The migration is transactional and rerunnable; repeat execution does not revoke newly enrolled sessions. No face is seeded for user 1 or user 9.

Required settings: `FACE_PYTHON_BIN` pointing to the Python environment with `AI/requirements.txt`, `FACE_AUTH_TIMEOUT_MS`, and `FACE_AUTH_MAX_CONCURRENT`. Cosine/MTCNN thresholds are in the versioned policy JSON. Legacy `FACE_CLASSIFICATION_THRESHOLD` and `FACE_DETECTION_THRESHOLD` do not configure the new extractor.

Tests: backend unit tests; `test/adminFaceFlow.integration.test.js` on a separate TEST_DB using temporary tables; `AI/test_face_embedding_extractor.py`; frontend face-flow tests. Tests with synthetic embeddings check ownership/transactions, not real recognition accuracy.
