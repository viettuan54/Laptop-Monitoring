// Generic errors only: never include the rejected text or URL in diagnostics.
const PRIVATE_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/u,
  /(?<!\w)(?:\+?84|0)(?:[ .-]?\d){8,10}(?!\w)/u,
  /\b(?:password|passwd|mật khẩu|api[_ -]?key|token|secret)\s*[:=]/iu,
  /\bbearer\s+\S+/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /https?:\/\/\S+/iu,
];

function cleanText(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid text input');
  const normalized = value.normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(normalized)) {
    throw new TypeError('Invalid text input');
  }
  const text = normalized.trim().replace(/\s+/gu, ' ');
  if (!text || [...text].length > 1000) throw new TypeError('Invalid text input');
  if (PRIVATE_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new TypeError('Sensitive text rejected');
  }
  return text;
}

function safeWebMetadata(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('Invalid web URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new TypeError('Invalid web URL');
  }
  return { url: `${parsed.protocol}//${parsed.hostname}/`, domain: parsed.hostname,
    page_title: parsed.hostname };
}

module.exports = { cleanText, safeWebMetadata };
