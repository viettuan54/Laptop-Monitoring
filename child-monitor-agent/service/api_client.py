import os
import json
import time
import logging
import requests
import win32crypt
import base64
from urllib.parse import urlparse

from runtime_paths import agent_root

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

DEFAULT_SERVER_URL = "https://api.tuansosad.id.vn"
WEB_CATEGORIES = {"education", "entertainment", "social", "unsafe", "unknown"}


class APIClient:
    CRYPTPROTECT_LOCAL_MACHINE = 0x4

    def __init__(self, config_path=None):
        if config_path is None:
            config_path = os.path.join(agent_root(), "config", "local_config.json")
        
        self.config_path = config_path
        self.server_url = DEFAULT_SERVER_URL
        self.device_secret = None
        self.vision_subject_id = None
        self.suspended = False
        self.last_config_mtime = 0
        
        self.load_config()

    @staticmethod
    def encrypt_secret(plain_secret: str) -> str:
        """Mã hóa chuỗi secret bằng Windows DPAPI và trả về chuỗi Base64."""
        if not plain_secret:
            return ""
        # Agent chạy dưới LocalSystem nhưng provisioning chạy dưới tài khoản
        # quản trị. Machine-scope cho phép Service giải mã; ACL của file config
        # ngăn người dùng thường đọc ciphertext.
        encrypted_bytes = win32crypt.CryptProtectData(
            plain_secret.encode('utf-8'),
            None,
            None,
            None,
            None,
            APIClient.CRYPTPROTECT_LOCAL_MACHINE,
        )
        return base64.b64encode(encrypted_bytes).decode('utf-8')

    @staticmethod
    def decrypt_secret(cipher_b64: str) -> str:
        """Giải mã chuỗi Base64 DPAPI trở lại plaintext."""
        if not cipher_b64:
            return ""
        try:
            cipher_bytes = base64.b64decode(cipher_b64.encode('utf-8'))
            _, decrypted_bytes = win32crypt.CryptUnprotectData(cipher_bytes, None, None, None, 0)
            return decrypted_bytes.decode('utf-8')
        except Exception as e:
            logging.error(f"DPAPI Decrypt error: {e}")
            return ""

    def load_config(self):
        """Đọc và giải mã cấu hình từ file local_config.json."""
        if not os.path.exists(self.config_path):
            logging.warning(f"Config file not found at {self.config_path}")
            return False

        try:
            self.last_config_mtime = os.path.getmtime(self.config_path)
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            configured_url = data.get("server_url", DEFAULT_SERVER_URL).rstrip("/")
            self.server_url = self.validate_server_url(configured_url)
            
            raw_secret = data.get("device_secret", "")
            subject_id = data.get("vision_subject_id")
            self.vision_subject_id = (
                subject_id
                if isinstance(subject_id, str) and subject_id.startswith("subject-")
                else None
            )
            # Nếu secret dạng plaintext UUID (chưa mã hóa), tiến hành mã hóa DPAPI rồi lưu lại
            if raw_secret and not data.get("is_encrypted", False):
                encrypted_b64 = self.encrypt_secret(raw_secret)
                data["device_secret"] = encrypted_b64
                data["is_encrypted"] = True
                with open(self.config_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                self.device_secret = raw_secret
            else:
                self.device_secret = self.decrypt_secret(raw_secret)

            logging.info("Config loaded successfully.")
            return True
        except Exception as e:
            logging.error(f"Failed to load config: {e}")
            return False

    @staticmethod
    def validate_server_url(server_url: str) -> str:
        """Bắt buộc HTTPS; chỉ cho phép HTTP với loopback để phát triển local."""
        parsed = urlparse(server_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("server_url must be an absolute HTTP(S) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("server_url must not contain credentials, query, or fragment")
        if parsed.path not in ("", "/"):
            raise ValueError("server_url must not contain a path")

        loopback_hosts = {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and parsed.hostname.lower() not in loopback_hosts:
            raise ValueError("HTTPS is required for every non-loopback server_url")
        if parsed.scheme == "http":
            logging.warning("Using insecure HTTP for loopback development only.")
        return server_url

    def check_config_reload(self):
        """Kiểm tra nếu file local_config.json được ghi mới thì tự động nạp lại và gỡ cờ suspend nếu thành công."""
        if not os.path.exists(self.config_path):
            return
        
        current_mtime = os.path.getmtime(self.config_path)
        if current_mtime > self.last_config_mtime:
            logging.info("Detected local_config.json change. Reloading credentials...")
            if self.load_config():
                # Thử nghiệm gọi Heartbeat để xác nhận secret mới
                test_res = self.post("/api/agent/heartbeat", data={})
                if test_res and test_res.status_code == 200:
                    logging.info("Re-authenticated successfully with new device secret!")
                    self.suspended = False
                else:
                    logging.warning("New device secret validation failed.")

    def _get_headers(self):
        return {
            "Content-Type": "application/json",
            "X-Device-Secret": self.device_secret or ""
        }

    def request(self, method, endpoint, payload=None, timeout=10, max_retries=3):
        """Gửi HTTP request có hỗ trợ retry (exponential backoff) và xử lý 401."""
        self.check_config_reload()

        if self.suspended:
            logging.warning("API calls are currently SUSPENDED due to invalid device secret (HTTP 401).")
            return None

        url = f"{self.server_url}{endpoint}"
        headers = self._get_headers()

        for attempt in range(1, max_retries + 1):
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    json=payload if payload is not None else None,
                    timeout=timeout,
                    # Không tự đi theo redirect có thể hạ cấp HTTPS xuống HTTP.
                    allow_redirects=False
                )

                # Nếu bị 401 Unauthorized -> Secret không hợp lệ / đã bị thu hồi
                if response.status_code == 401:
                    logging.error(f"HTTP 401 Unauthorized from {endpoint}. Device secret is invalid/revoked!")
                    self.suspended = True
                    return response

                # Thành công hoặc lỗi nghiệp vụ bình thường
                if response.status_code < 500:
                    return response

                logging.warning(f"Server error {response.status_code} (Attempt {attempt}/{max_retries})")

            except requests.RequestException as e:
                logging.warning(f"Network error on {endpoint}: {e} (Attempt {attempt}/{max_retries})")

            # Delay exponential backoff nếu cần retry
            if attempt < max_retries:
                time.sleep(2 ** attempt)

        return None

    def get(self, endpoint, timeout=10):
        return self.request("GET", endpoint, timeout=timeout)

    def post(self, endpoint, data=None, timeout=10):
        return self.request("POST", endpoint, payload=data, timeout=timeout)

    def get_config(self, timeout=10):
        """Lấy thông tin cấu hình và danh sách tên miền bị chặn từ /api/agent/config."""
        res = self.get("/api/agent/config", timeout=timeout)
        if res and res.status_code == 200:
            try:
                return res.json()
            except Exception as e:
                logging.error(f"Error parsing json from /api/agent/config: {e}")
        return None

    def classify_web_domain(self, domain, timeout=20):
        """Call Gemini fallback with only the normalized domain."""
        res = self.post(
            "/api/agent/classification/web/fallback",
            data={"domain": domain},
            timeout=timeout,
        )
        if not res or res.status_code != 200:
            return None
        try:
            payload = res.json()
            category = payload.get("category")
            return category if category in WEB_CATEGORIES else None
        except (ValueError, AttributeError):
            logging.error("Invalid web classification fallback response.")
            return None

    def get_unknown_web_domains(self, limit=25, timeout=10):
        """Fetch distinct unknown domains belonging to this authenticated device."""
        safe_limit = max(1, min(int(limit), 100))
        res = self.get(
            f"/api/agent/classification/web/unknown-domains?limit={safe_limit}",
            timeout=timeout,
        )
        if not res or res.status_code != 200:
            return []
        try:
            domains = res.json().get("domains", [])
            return [domain for domain in domains if isinstance(domain, str)][:safe_limit]
        except (ValueError, AttributeError):
            logging.error("Invalid unknown-domain response.")
            return []

    def backfill_web_domain(
        self, domain, category, classification_source, classification_confidence=None,
        timeout=10
    ):
        """Apply one final category to old unknown logs for this device."""
        if category not in WEB_CATEGORIES:
            return False
        if classification_source not in {"trained_model", "gemini"}:
            return False
        res = self.post(
            "/api/agent/classification/web/backfill",
            data={
                "domain": domain,
                "category": category,
                "classification_source": classification_source,
                "classification_confidence": classification_confidence,
            },
            timeout=timeout,
        )
        return bool(res and res.status_code == 200)
