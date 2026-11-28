const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { setTimeout: delay } = require('timers/promises');

const execFileAsync = promisify(execFile);
const FACE_SCRIPT = path.resolve(__dirname, '../../AI/face_embedding_extractor.py');
const policy = require('../../AI/face_verification_policy.json');
const RESULT_PREFIX = 'SAFENEST_FACE_RESULT:';
const REQUIRED_FRAME_COUNT = 5;
const MAX_FRAME_BYTES = 500 * 1024;
const MAX_TOTAL_BYTES = REQUIRED_FRAME_COUNT * MAX_FRAME_BYTES;
const WINDOWS_POLICY_BLOCK = /An Application Control policy has blocked this file/i;
const PYTHON_MAX_RETRIES = 3;
const PYTHON_RETRY_DELAY_MS = 1500;
let activeVerifications = 0;
const DIAGNOSTIC_PATH = path.resolve(__dirname, '../../../.runtime/face-auth-last-error.json');

function pythonFailureDiagnostic(error) {
  // Keep the exception at the END of stderr, not just TensorFlow startup warnings.
  // Do not record stdout: it can contain biometric embeddings.
  return {
    at: new Date().toISOString(),
    code: error.code || null,
    signal: error.signal || null,
    killed: Boolean(error.killed),
    stderr: String(error.stderr || error.message || 'Python failed without a diagnostic').slice(-6000),
  };
}

async function recordPythonFailure(error) {
  const diagnostic = pythonFailureDiagnostic(error);
  console.error('[FaceAuth] Python execution failed:', JSON.stringify(diagnostic));
  try {
    await fs.mkdir(path.dirname(DIAGNOSTIC_PATH), { recursive: true });
    await fs.writeFile(DIAGNOSTIC_PATH, JSON.stringify(diagnostic, null, 2), { mode: 0o600 });
  } catch (_) { /* Diagnostic storage must not change authentication behavior. */ }
}

class FaceAuthUnavailableError extends Error {
  constructor(message = 'Face recognition service is unavailable') {
    super(message);
    this.name = 'FaceAuthUnavailableError';
    this.code = 'FACE_AUTH_UNAVAILABLE';
  }
}

function pythonRuntimeError(error) {
  const failure = new FaceAuthUnavailableError();
  if (WINDOWS_POLICY_BLOCK.test(String(error.stderr || error.message || ''))) {
    failure.code = 'FACE_RUNTIME_BLOCKED';
  }
  return failure;
}

async function runFacePython(args) {
  const pythonBinary = String(process.env.FACE_PYTHON_BIN || 'python').trim();
  const timeout = Math.max(10000, Math.min(120000, Number(process.env.FACE_AUTH_TIMEOUT_MS) || 120000));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const output = await execFileAsync(pythonBinary, args, {
        cwd: path.dirname(FACE_SCRIPT),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
      // The extractor can catch a model exception and exit with code 0.
      if (WINDOWS_POLICY_BLOCK.test(String(output.stderr || ''))) {
        throw Object.assign(new Error('Face runtime blocked by Windows policy'), { stderr: output.stderr });
      }
      return output;
    } catch (error) {
      if (!WINDOWS_POLICY_BLOCK.test(String(error.stderr || '')) || attempt >= PYTHON_MAX_RETRIES) throw error;
      console.warn(`[FaceAuth] Windows Application Control blocked Python; retry ${attempt + 1}/${PYTHON_MAX_RETRIES} in ${PYTHON_RETRY_DELAY_MS}ms.`);
      await delay(PYTHON_RETRY_DELAY_MS);
    }
  }
}

async function warmUpFaceRuntime() {
  console.log('[FaceAuth] Warming up Python face runtime in the background...');
  try {
    await runFacePython(['-c', 'from facenet_runtime import DeepFace, MTCNN; MTCNN(); DeepFace.build_model("Facenet")']);
    console.log('[FaceAuth] Python face runtime warm-up completed.');
    return true;
  } catch (error) {
    await recordPythonFailure(error);
    console.warn('[FaceAuth] Runtime warm-up failed; face requests will retry transient Windows policy blocks.');
    return false;
  }
}

function hasValidMagic(buffer, mime) {
  if (mime === 'jpeg') {
    return buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
  }
  if (mime === 'png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === 'webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function decodeFaceFrames(frames) {
  if (!Array.isArray(frames) || frames.length !== REQUIRED_FRAME_COUNT) {
    throw new TypeError(`Exactly ${REQUIRED_FRAME_COUNT} camera frames are required`);
  }

  let totalBytes = 0;
  const decoded = frames.map((frame) => {
    if (typeof frame !== 'string' || frame.length > 750000) {
      throw new TypeError('Invalid face frame');
    }
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(frame);
    if (!match) throw new TypeError('Face frames must be base64 JPEG, PNG, or WebP data URLs');

    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_FRAME_BYTES || !hasValidMagic(buffer, mime)) {
      throw new TypeError('Invalid or oversized face frame');
    }
    totalBytes += buffer.length;
    return { mime, buffer };
  });

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new TypeError('Combined face frames are too large');
  }
  const uniqueHashes = new Set(decoded.map(({ buffer }) => (
    crypto.createHash('sha256').update(buffer).digest('hex')
  )));
  if (uniqueHashes.size !== REQUIRED_FRAME_COUNT) {
    throw new TypeError('Face frames must be separate live camera captures');
  }
  return decoded;
}

function normalizeEmbedding(vector) {
  if (!Array.isArray(vector) || vector.length !== 128 || !vector.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new FaceAuthUnavailableError('Invalid face embedding');
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-8) throw new FaceAuthUnavailableError('Invalid face embedding');
  return vector.map(v => v / norm);
}

const cosine = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

function hasDuplicateFace(candidate, templates) {
  if (candidate.model_id !== policy.model_id) throw new FaceAuthUnavailableError('Face model mismatch');
  const embedding = normalizeEmbedding(candidate.embedding);
  return templates.some(template => {
    if (template.model_id !== policy.model_id) throw new FaceAuthUnavailableError('Face model changed; administrator reset required');
    return cosine(embedding, normalizeEmbedding(template.embedding)) >= policy.threshold;
  });
}

function evaluateEmbeddings(result, template = null) {
  if (result.model_id !== policy.model_id || (template && template.model_id !== policy.model_id)) {
    throw new FaceAuthUnavailableError('Face model changed; administrator reset required');
  }
  const vectors = result.embeddings.map(normalizeEmbedding);
  if (vectors.length !== REQUIRED_FRAME_COUNT) throw new FaceAuthUnavailableError();
  // One person's face in every frame, for both enrollment and verification.
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      if (cosine(vectors[i], vectors[j]) < policy.enrollment_threshold) return { accepted: false };
    }
  }
  if (template) {
    const reference = normalizeEmbedding(template.embedding);
    const scores = vectors.map(v => cosine(v, reference));
    return { accepted: scores.every(score => score >= policy.threshold), matched_frames: scores.filter(s => s >= policy.threshold).length };
  }
  const embedding = normalizeEmbedding(vectors[0].map((_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length));
  return { accepted: true, embedding, model_id: policy.model_id, matched_frames: vectors.length };
}

function parseModelResult(stdout) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((value) => value.startsWith(RESULT_PREFIX));
  if (!line) throw new FaceAuthUnavailableError('Face model returned an invalid response');

  let result;
  try {
    result = JSON.parse(line.slice(RESULT_PREFIX.length));
  } catch (_) {
    throw new FaceAuthUnavailableError('Face model returned malformed JSON');
  }
  if (result?.reason === 'model_error') {
    throw new FaceAuthUnavailableError();
  }
  if (result?.ok === false && typeof result.reason === 'string') {
    throw new TypeError('Face quality check failed: ' + result.reason);
  }
  if (!result || result.ok !== true || result.model_id !== policy.model_id
      || !Array.isArray(result.embeddings) || result.embeddings.length !== REQUIRED_FRAME_COUNT) {
    throw new FaceAuthUnavailableError('Face model result is incomplete');
  }
  return { model_id: result.model_id, embeddings: result.embeddings.map(normalizeEmbedding) };
}

async function verifyAdminFace(frames, template = null) {
  const decoded = decodeFaceFrames(frames);
  const maxConcurrent = Math.max(1, Math.min(2, Number(process.env.FACE_AUTH_MAX_CONCURRENT) || 1));
  if (activeVerifications >= maxConcurrent) {
    throw new FaceAuthUnavailableError('Face recognition service is busy');
  }

  activeVerifications += 1;
  let tempDirectory;
  try {
    await fs.access(FACE_SCRIPT);
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'safenest-face-'));
    const imagePaths = [];
    for (let index = 0; index < decoded.length; index += 1) {
      const extension = decoded[index].mime === 'jpeg' ? 'jpg' : decoded[index].mime;
      const imagePath = path.join(tempDirectory, `frame-${index + 1}.${extension}`);
      await fs.writeFile(imagePath, decoded[index].buffer, { mode: 0o600 });
      imagePaths.push(imagePath);
    }

    let output;
    try {
      output = await runFacePython([FACE_SCRIPT, ...imagePaths]);
    } catch (error) {
      await recordPythonFailure(error);
      throw pythonRuntimeError(error);
    }
    let extracted;
    try {
      extracted = parseModelResult(output.stdout);
    } catch (error) {
      if (error instanceof FaceAuthUnavailableError) {
        await recordPythonFailure({ code: 'MODEL_PROTOCOL_ERROR', stderr: output.stderr, message: error.message });
        throw pythonRuntimeError({ stderr: output.stderr });
      }
      throw error;
    }
    return evaluateEmbeddings(extracted, template);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    if (error instanceof FaceAuthUnavailableError) throw error;
    console.error('[FaceAuth] Service error:', String(error.message || error).slice(0, 500));
    throw new FaceAuthUnavailableError();
  } finally {
    activeVerifications -= 1;
    if (tempDirectory) {
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

module.exports = {
  warmUpFaceRuntime,
  pythonRuntimeError,
  FaceAuthUnavailableError,
  REQUIRED_FRAME_COUNT,
  decodeFaceFrames,
  parseModelResult,
  verifyAdminFace,
  evaluateEmbeddings,
  normalizeEmbedding,
  hasDuplicateFace,
  pythonFailureDiagnostic,
};
