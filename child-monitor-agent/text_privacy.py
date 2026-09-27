"""Fail-closed text consent and privacy checks shared by Agent components."""

import math
import base64
import re
import time
import unicodedata
from datetime import datetime
from urllib.parse import urlparse, urlunparse

POLICY_LEASE_SECONDS = 180
SUPPORTED_TEXT_SOURCES = frozenset({"search_query"})  # page collector is not built yet
GOOGLE_SEARCH_HOSTS = frozenset({
    "google.com", "google.com.vn", "google.co.uk", "google.co.jp", "google.co.in",
    "google.com.au", "google.ca", "google.de", "google.fr", "google.sg",
})
SENSITIVE_PATTERNS = (
    re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    re.compile(r"(?<!\w)(?:\+?84|0)(?:[ .-]?\d){8,10}(?!\w)"),
    re.compile(r"\b(?:password|passwd|mật khẩu|api[_ -]?key|token|secret)\s*[:=]", re.I),
    re.compile(r"\bbearer\s+\S+", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"https?://\S+", re.I),
)


def clean_text(value, maximum=1000):
    """Reject, rather than log/store, queries containing obvious private data."""
    if not isinstance(value, str):
        raise ValueError("Invalid text input")
    value = unicodedata.normalize("NFKC", value)
    value = "".join(char for char in value if unicodedata.category(char) != "Cf")
    if any(ord(char) < 32 and char not in "\t\r\n" or ord(char) == 127 for char in value):
        raise ValueError("Invalid text input")
    value = " ".join(value.split()).strip()
    if not value or len(value) > maximum:
        raise ValueError("Invalid text input")
    if any(pattern.search(value) for pattern in SENSITIVE_PATTERNS):
        raise ValueError("Sensitive text rejected")
    return value


def policy_enabled(policy, now=None):
    now = time.time() if now is None else now
    if not isinstance(policy, dict) or policy.get("enabled") is not True:
        return False
    values = [policy.get(key) for key in ("issued_at", "expires_at", "enabled_since")]
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
        return False
    issued, expires, since = values
    return (0 < since <= issued <= now + 1 and issued < expires
            and expires - issued <= POLICY_LEASE_SECONDS and now < expires)


def eligible_timestamp(value, policy, now=None):
    now = time.time() if now is None else now
    if not policy_enabled(policy, now) or not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return False
        return policy["enabled_since"] <= parsed.timestamp() <= now + 30
    except (ValueError, OverflowError, OSError):
        return False


def search_parameter(raw_url):
    """Recognize the source without decoding query text while disabled."""
    if not isinstance(raw_url, str) or len(raw_url) > 8192:
        return None
    try:
        parsed = urlparse(raw_url)
        host = (parsed.hostname or "").lower().rstrip(".")
        if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
            return None
    except ValueError:
        return None
    normalized_host = host[4:] if host.startswith("www.") else host
    path = parsed.path.rstrip("/") or "/"
    if normalized_host in GOOGLE_SEARCH_HOSTS and path == "/search":
        return "q"
    if (host == "bing.com" or host.endswith(".bing.com")) and path == "/search":
        return "q"
    if (host == "search.yahoo.com" or host.endswith(".search.yahoo.com")) and path == "/search":
        return "p"
    if (host == "duckduckgo.com" or host.endswith(".duckduckgo.com")) and path == "/":
        return "q"
    if (host == "coccoc.com" or host.endswith(".coccoc.com")) and path == "/search":
        return "query"
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com"} and path == "/results":
        return "search_query"
    if host == "search.brave.com" and path == "/search":
        return "q"
    return None


def safe_web_metadata(raw_url, title):
    """Do not bypass the text switch through web URL/query or search title."""
    parsed = urlparse(raw_url)
    host = parsed.hostname or ""
    # Web tracking stores origin only: paths can also contain search text/tokens.
    authority = f"[{host}]" if ":" in host else host
    safe_url = urlunparse((parsed.scheme, authority, "/", "", "", ""))
    # Titles may contain search terms even on an unrecognized search engine.
    return safe_url, host


def protect_text(value):
    """Windows machine-scope DPAPI; the Service-only NTFS ACL is also required."""
    import win32crypt
    protected = win32crypt.CryptProtectData(value.encode("utf-8"), None, None, None, None, 0x4)
    return "dpapi:v1:" + base64.b64encode(protected).decode("ascii")


def unprotect_text(value):
    import win32crypt
    if not isinstance(value, str) or not value.startswith("dpapi:v1:"):
        raise ValueError("Unprotected text rejected")
    encrypted = base64.b64decode(value[len("dpapi:v1:"):], validate=True)
    _, plain = win32crypt.CryptUnprotectData(encrypted, None, None, None, 0)
    return plain.decode("utf-8")
