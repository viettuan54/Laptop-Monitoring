const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const FACE_SCRIPT = path.resolve(__dirname, '../../AI/face_recognition_attendance.py');
const RESULT_PREFIX = 'SAFENEST_FACE_RESULT:';
const REQUIRED_FRAME_COUNT = 3;
const MAX_FRAME_BYTES = 500 * 1024;
const MAX_TOTAL_BYTES = 1500 * 1024;
let activeVerifications = 0;

class FaceAuthUnavailableError extends Error {
  constructor(message = 'Face recognition service is unavailable') {
    super(message);
    this.name = 'FaceAuthUnavailableError';
    this.code = 'FACE_AUTH_UNAVAILABLE';
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
  if (!result || typeof result.label !== 'string' || result.label.length > 50) {
    throw new FaceAuthUnavailableError('Face model result is incomplete');
  }
  return {
    label: result.label.trim().toLowerCase(),
    confidence: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : 0,
    matched_frames: Number(result.matched_frames) || 0,
    required_frames: Number(result.required_frames) || 0,
  };
}

async function verifyAdminFace(frames) {
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

    const pythonBinary = String(process.env.FACE_PYTHON_BIN || 'python').trim();
    const timeout = Math.max(10000, Math.min(120000, Number(process.env.FACE_AUTH_TIMEOUT_MS) || 120000));
    let output;
    try {
      output = await execFileAsync(pythonBinary, [FACE_SCRIPT, ...imagePaths], {
        cwd: path.dirname(FACE_SCRIPT),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
        timeout,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (error) {
      const diagnostic = String(error.stderr || error.message || '').slice(0, 500);
      console.error('[FaceAuth] Python execution failed:', diagnostic);
      throw new FaceAuthUnavailableError();
    }
    return parseModelResult(output.stdout);
  } catch (error) {
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
  FaceAuthUnavailableError,
  REQUIRED_FRAME_COUNT,
  decodeFaceFrames,
  parseModelResult,
  verifyAdminFace,
};
