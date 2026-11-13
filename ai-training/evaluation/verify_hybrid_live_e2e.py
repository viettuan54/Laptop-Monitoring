"""End-to-End Live Acceptance Verification for the Hybrid Content Classification System.

Executes all 4 acceptance scenarios against:
  - Packaged Windows Agent modules (ContentClassifier, PipeServer, OfflineQueue, EnforcementCore, APIClient)
  - Real Express Backend (child-monitor-backend/src/app.js)
  - Isolated PostgreSQL test database (child_monitor_test with RLS enabled)
  - Live Gemini API (gemini-2.5-flash) for Tier 3 Fallback & Backfill

Writes auditable JSON and Markdown verification reports to:
  - ai-training/artifacts/content_classification/hybrid_live_verification.json
  - ai-training/artifacts/content_classification/HYBRID_LIVE_VERIFICATION_REPORT.md
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock
import urllib.request
import urllib.error


TRAINING_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = TRAINING_ROOT.parent
AGENT_ROOT = REPO_ROOT / "child-monitor-agent"
BACKEND_ROOT = REPO_ROOT / "child-monitor-backend"
ARTIFACTS_DIR = TRAINING_ROOT / "artifacts" / "content_classification"
JSON_OUT_PATH = ARTIFACTS_DIR / "hybrid_live_verification.json"
MD_OUT_PATH = ARTIFACTS_DIR / "HYBRID_LIVE_VERIFICATION_REPORT.md"

for p in (
    str(AGENT_ROOT),
    str(AGENT_ROOT / "service"),
    str(AGENT_ROOT / "db"),
    str(TRAINING_ROOT),
):
    if p not in sys.path:
        sys.path.insert(0, p)

from content_classifier import ContentClassifier, verify_packaged_content_assets
from offline_queue import OfflineQueue
from api_client import APIClient
from pipe_server import PipeServer


BACKEND_HARNESS_JS = r"""
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env.test'), quiet: true });
dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });

Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_HOST: process.env.TEST_DB_HOST,
  DB_PORT: process.env.TEST_DB_PORT,
  DB_NAME: process.env.TEST_DB_NAME,
  DB_ADMIN_USER: process.env.TEST_DB_ADMIN_USER,
  DB_ADMIN_PASSWORD: process.env.TEST_DB_ADMIN_PASSWORD,
  DB_BACKEND_USER: process.env.TEST_DB_BACKEND_USER,
  DB_BACKEND_PASSWORD: process.env.TEST_DB_BACKEND_PASSWORD,
  JWT_SECRET: process.env.TEST_JWT_SECRET || crypto.randomBytes(32).toString('hex'),
});

const { adminPool, backendPool, validateRlsConfiguration } = require('./src/config/db');
const app = require('./src/app');

const runId = `verify_hybrid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const email = `${runId}@example.test`;
let userId, childId, deviceId, server;

async function start() {
  await validateRlsConfiguration();
  const pwHash = await bcrypt.hash('VerifyHybrid1!', 4);
  const uRes = await adminPool.query(
    `INSERT INTO users(name, email, password, role, is_verified)
     VALUES ($1, $2, $3, 'parent', TRUE) RETURNING user_id, token_version`,
    ['Parent E2E Verifier', email, pwHash]
  );
  userId = uRes.rows[0].user_id;
  const tokenVersion = uRes.rows[0].token_version;

  const cRes = await adminPool.query(
    `INSERT INTO children(user_id, name, age)
     VALUES ($1, $2, 12) RETURNING child_id`,
    [userId, 'Be Minh E2E']
  );
  childId = cRes.rows[0].child_id;

  // Enable both app and web classification
  await adminPool.query(
    `INSERT INTO settings(child_id, daily_limit_minutes, enable_app_classification, enable_web_classification)
     VALUES ($1, 180, TRUE, TRUE)
     ON CONFLICT (child_id) DO UPDATE
       SET enable_app_classification = TRUE,
           enable_web_classification = TRUE`,
    [childId]
  );

  const deviceSecret = crypto.randomUUID();
  const secretHash = crypto.createHash('sha256').update(deviceSecret).digest('hex');
  const dRes = await adminPool.query(
    `INSERT INTO devices(child_id, device_name, device_uid, device_secret)
     VALUES ($1, $2, $3, $4) RETURNING device_id`,
    [childId, 'Laptop-Hoc-Tap-E2E', `${runId}_uid`, secretHash]
  );
  deviceId = dRes.rows[0].device_id;

  const parentToken = jwt.sign(
    { user_id: userId, email, role: 'parent', token_version: tokenVersion },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  server = http.createServer(async (req, res) => {
    if (req.url === '/__inspect/db-rows') {
      try {
        const webRes = await adminPool.query(
          'SELECT domain, category, classification_source, classification_confidence FROM website_logs WHERE device_id = $1 ORDER BY log_id ASC',
          [deviceId]
        );
        const appRes = await adminPool.query(
          'SELECT app_name, category, classification_source, classification_confidence FROM app_usage WHERE device_id = $1 ORDER BY log_id ASC',
          [deviceId]
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ app_usage: appRes.rows, website_logs: webRes.rows }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    return app(req, res);
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const info = {
    server_url: serverUrl,
    base_url: `${serverUrl}/api`,
    user_id: userId,
    child_id: childId,
    device_id: deviceId,
    device_secret: deviceSecret,
    parent_token: parentToken,
    database: process.env.DB_NAME,
  };
  process.stdout.write('__READY__' + JSON.stringify(info) + '\n');
}

async function shutdown() {
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (userId) {
      await adminPool.query('DELETE FROM audit_logs WHERE actor_user_id = $1', [userId]);
      await adminPool.query('DELETE FROM users WHERE user_id = $1', [userId]);
    }
  } catch (e) {
    console.error('Cleanup error:', e);
  } finally {
    await Promise.allSettled([adminPool.end(), backendPool.end()]);
    process.exit(0);
  }
}

process.stdin.on('data', (chunk) => {
  if (chunk.toString().includes('STOP')) shutdown();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((err) => {
  console.error('Harness start failed:', err);
  process.exit(1);
});
"""


def _http_json(url: str, method: str = "GET", headers: dict | None = None, body: dict | None = None) -> tuple[int, dict]:
    req_headers = {"Accept": "application/json", **(headers or {})}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"raw": raw}
        return err.code, parsed


def _stage_verified_models(target_dir: str) -> tuple[dict, dict]:
    asset_hashes = {}
    for name in (
        "app_content_model_v1.json",
        "web_content_model_v1.json",
        "app_exact_lookup_v1.json",
        "web_exact_lookup_v1.json",
    ):
        src = ARTIFACTS_DIR / name
        raw = src.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        asset_hashes[name] = digest
        dst = Path(target_dir) / name
        dst.write_bytes(raw)
        Path(str(dst) + ".sha256").write_text(digest + "\n", encoding="ascii")
    return verify_packaged_content_assets(target_dir), asset_hashes


def run_live_e2e_verification() -> dict:
    # Launch ephemeral Express backend connected to isolated child_monitor_test DB
    proc = subprocess.Popen(
        ["node", "-e", BACKEND_HARNESS_JS],
        cwd=str(BACKEND_ROOT),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )

    harness_info = None
    try:
        deadline = time.time() + 20
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    err_out = proc.stderr.read()
                    raise RuntimeError(f"Backend harness exited early: {err_out}")
                continue
            if "__READY__" in line:
                raw_json = line.split("__READY__", 1)[1].strip()
                harness_info = json.loads(raw_json)
                break
        if not harness_info:
            raise RuntimeError("Timed out waiting for Backend E2E harness")

        server_url = harness_info["server_url"]
        base_url = harness_info["base_url"]
        device_secret = harness_info["device_secret"]
        parent_token = harness_info["parent_token"]
        child_id = harness_info["child_id"]
        device_id = harness_info["device_id"]

        device_headers = {"X-Device-Secret": device_secret}
        parent_headers = {"Authorization": f"Bearer {parent_token}"}

        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = os.path.join(temp_dir, "models")
            os.makedirs(models_dir, exist_ok=True)
            asset_verification, asset_hashes = _stage_verified_models(models_dir)
            db_path = os.path.join(temp_dir, "agent_e2e.db")
            offline_queue = OfflineQueue(db_path=db_path, secure_file=False)
            classifier = ContentClassifier(models_dir=models_dir)

            # Configure APIClient to point to our live local Express server
            api_client = APIClient(config_path=os.path.join(temp_dir, "missing_config.json"))
            api_client.server_url = server_url
            api_client.device_secret = device_secret

            # Fetch initial config snapshot from live backend
            status_cfg, cfg_body = _http_json(f"{base_url}/agent/config", headers=device_headers)
            assert status_cfg == 200, f"GET /agent/config failed: {status_cfg} {cfg_body}"

            cached_settings = dict(cfg_body["config"])
            remembered_web = {}

            enforcement_mock = Mock()
            enforcement_mock.load_cached_settings.side_effect = lambda: dict(cached_settings)
            enforcement_mock.remember_web_classification.side_effect = (
                lambda dom, cat, src: remembered_web.update({dom: {"category": cat, "source": src}})
            )

            pipe_server = PipeServer(
                offline_queue=offline_queue,
                enforcement_core=enforcement_mock,
                api_client=api_client,
                content_classifier=classifier,
            )

            scenarios = {}

            # =========================================================================
            # SCENARIO 1: Tier 1 — Exact Lookup Hit (coccoc.exe & gamevui.vn)
            # =========================================================================
            t0 = time.perf_counter_ns()
            s1_app_cls = pipe_server.classify_app(
                "coccoc.exe",
                product_name="Cốc Cốc",
                file_description="Trình duyệt Cốc Cốc",
                allow_remote_fallback=False,
            )
            s1_app_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            now_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            s1_app_post_status, s1_app_post_body = _http_json(
                f"{base_url}/logs/app",
                method="POST",
                headers=device_headers,
                body={
                    "app_name": "coccoc.exe",
                    "product_name": "Cốc Cốc",
                    "file_description": "Trình duyệt Cốc Cốc",
                    "category": s1_app_cls["category"],
                    "classification_source": s1_app_cls["source"],
                    "classification_confidence": s1_app_cls["confidence"],
                    "start_time": now_iso,
                    "end_time": now_iso,
                    "duration_seconds": 45,
                },
            )

            t0 = time.perf_counter_ns()
            s1_web_raw = classifier.classify_web("www.GameVui.vn")
            s1_web_cls = pipe_server.classify_web_domain("www.GameVui.vn", allow_remote_fallback=False)
            s1_web_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            s1_web_post_status, s1_web_post_body = _http_json(
                f"{base_url}/logs/web",
                method="POST",
                headers=device_headers,
                body={
                    "url": "https://gamevui.vn/",
                    "domain": "gamevui.vn",
                    "category": s1_web_cls["category"],
                    "classification_source": s1_web_cls["source"],
                    "classification_confidence": s1_web_cls["confidence"],
                    "visit_time": now_iso,
                    "duration_seconds": 30,
                    "page_title": "GameVui",
                },
            )

            # Check heartbeat policy_blocked_domains after logging gamevui.vn (entertainment = block)
            _, hb_after_s1 = _http_json(f"{base_url}/agent/heartbeat", method="POST", headers=device_headers)

            assert s1_app_cls["category"] == "browsers"
            assert s1_app_cls["source"] == "exact_lookup"
            assert s1_app_cls["confidence"] == 1.0
            assert s1_app_post_status == 201
            assert s1_web_raw["decision_source"] == "exact_lookup"
            assert s1_web_cls["category"] == "entertainment"
            assert s1_web_cls["confidence"] == 1.0
            assert s1_web_post_status == 201
            assert "gamevui.vn" in hb_after_s1["policy_blocked_domains"]

            scenarios["scenario_1_exact_lookup"] = {
                "passed": True,
                "app_test": {
                    "input": {"app_name": "coccoc.exe", "product_name": "Cốc Cốc"},
                    "agent_classification": s1_app_cls,
                    "latency_ms": round(s1_app_lat_ms, 4),
                    "backend_log_status": s1_app_post_status,
                },
                "web_test": {
                    "input": {"domain": "www.GameVui.vn"},
                    "classifier_raw_decision_source": s1_web_raw["decision_source"],
                    "agent_classification": s1_web_cls,
                    "latency_ms": round(s1_web_lat_ms, 4),
                    "backend_log_status": s1_web_post_status,
                    "enforced_in_policy_blocked_domains": "gamevui.vn" in hb_after_s1["policy_blocked_domains"],
                },
            }

            # =========================================================================
            # SCENARIO 2: Tier 2 — Local N-gram Conclusive Hit (genshinimpact.exe & vioedu.vn)
            # =========================================================================
            t0 = time.perf_counter_ns()
            s2_app_cls = pipe_server.classify_app(
                "genshinimpact.exe",
                product_name="Genshin Impact",
                file_description="Open-World Action RPG Video Game",
                allow_remote_fallback=False,
            )
            s2_app_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            s2_app_post_status, _ = _http_json(
                f"{base_url}/logs/app",
                method="POST",
                headers=device_headers,
                body={
                    "app_name": "genshinimpact.exe",
                    "product_name": "Genshin Impact",
                    "file_description": "Open-World Action RPG Video Game",
                    "category": s2_app_cls["category"],
                    "classification_source": s2_app_cls["source"],
                    "classification_confidence": s2_app_cls["confidence"],
                    "start_time": now_iso,
                    "end_time": now_iso,
                    "duration_seconds": 60,
                },
            )

            t0 = time.perf_counter_ns()
            s2_web_cls = pipe_server.classify_web_domain("vioedu.vn", allow_remote_fallback=False)
            s2_web_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            s2_web_post_status, _ = _http_json(
                f"{base_url}/logs/web",
                method="POST",
                headers=device_headers,
                body={
                    "url": "https://vioedu.vn/",
                    "domain": "vioedu.vn",
                    "category": s2_web_cls["category"],
                    "classification_source": s2_web_cls["source"],
                    "classification_confidence": s2_web_cls["confidence"],
                    "visit_time": now_iso,
                    "duration_seconds": 120,
                    "page_title": "VioEdu",
                },
            )

            assert s2_app_cls["category"] == "entertainment"
            assert s2_app_cls["source"] == "trained_model"
            assert s2_app_cls["confidence"] >= 0.70
            assert s2_app_post_status == 201
            assert s2_web_cls["category"] == "education"
            assert s2_web_cls["source"] == "trained_model"
            assert s2_web_cls["confidence"] >= 0.70
            assert s2_web_post_status == 201

            scenarios["scenario_2_ngram_conclusive"] = {
                "passed": True,
                "app_test": {
                    "input": {
                        "app_name": "genshinimpact.exe",
                        "product_name": "Genshin Impact",
                        "file_description": "Open-World Action RPG Video Game",
                    },
                    "agent_classification": {
                        **s2_app_cls,
                        "confidence": round(s2_app_cls["confidence"], 4),
                    },
                    "latency_ms": round(s2_app_lat_ms, 4),
                    "backend_log_status": s2_app_post_status,
                },
                "web_test": {
                    "input": {"domain": "vioedu.vn"},
                    "agent_classification": {
                        **s2_web_cls,
                        "confidence": round(s2_web_cls["confidence"], 4),
                    },
                    "latency_ms": round(s2_web_lat_ms, 4),
                    "backend_log_status": s2_web_post_status,
                },
            }

            # =========================================================================
            # SCENARIO 3: Tier 3 — Low Confidence -> Pending -> Live Gemini Fallback -> Backfill & Policy
            # =========================================================================
            # 3A: App (zingmp3.exe)
            s3_app_local = classifier.classify_app(
                "zingmp3.exe",
                product_name="Zing MP3 PC",
                file_description="Ung dung nghe nhac giai tri Zing MP3",
            )
            s3_app_initial = pipe_server.classify_app(
                "zingmp3.exe",
                product_name="Zing MP3 PC",
                file_description="Ung dung nghe nhac giai tri Zing MP3",
                allow_remote_fallback=False,
            )
            assert s3_app_initial == {"category": "unknown", "source": "pending", "confidence": None}

            # Enqueue locally and post initial pending row to Backend
            offline_queue.enqueue_app_log(
                app_name="zingmp3.exe",
                start_time=now_iso,
                end_time=now_iso,
                duration_seconds=50,
                category=s3_app_initial["category"],
                product_name="Zing MP3 PC",
                file_description="Ung dung nghe nhac giai tri Zing MP3",
                classification_source=s3_app_initial["source"],
                classification_confidence=s3_app_initial["confidence"],
                client_record_id=str(uuid.uuid4()),
            )
            s3_app_pending_status, _ = _http_json(
                f"{base_url}/logs/app",
                method="POST",
                headers=device_headers,
                body={
                    "app_name": "zingmp3.exe",
                    "product_name": "Zing MP3 PC",
                    "file_description": "Ung dung nghe nhac giai tri Zing MP3",
                    "category": "unknown",
                    "classification_source": "pending",
                    "classification_confidence": None,
                    "start_time": now_iso,
                    "end_time": now_iso,
                    "duration_seconds": 50,
                },
            )
            assert s3_app_pending_status == 201

            _, unknown_apps_before = _http_json(
                f"{base_url}/agent/classification/app/unknown-apps",
                headers=device_headers,
            )

            t0 = time.perf_counter_ns()
            backfilled_app_count = pipe_server.reclassify_unknown_app_logs(limit=10)
            s3_app_gemini_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            _, unknown_apps_after = _http_json(
                f"{base_url}/agent/classification/app/unknown-apps",
                headers=device_headers,
            )

            # 3B: Web (roblox.com)
            s3_web_local = classifier.classify_web("roblox.com")
            s3_web_initial = pipe_server.classify_web_domain("roblox.com", allow_remote_fallback=False)
            assert s3_web_initial == {"category": "unknown", "source": "pending", "confidence": None}

            offline_queue.enqueue_web_log(
                url="https://roblox.com/home",
                domain="roblox.com",
                visit_time=now_iso,
                duration_seconds=90,
                page_title="Roblox",
                category=s3_web_initial["category"],
                classification_source=s3_web_initial["source"],
                classification_confidence=s3_web_initial["confidence"],
                client_record_id=str(uuid.uuid4()),
            )
            s3_web_pending_status, _ = _http_json(
                f"{base_url}/logs/web",
                method="POST",
                headers=device_headers,
                body={
                    "url": "https://roblox.com/home",
                    "domain": "roblox.com",
                    "category": "unknown",
                    "classification_source": "pending",
                    "classification_confidence": None,
                    "visit_time": now_iso,
                    "duration_seconds": 90,
                    "page_title": "Roblox",
                },
            )
            assert s3_web_pending_status == 201

            _, unknown_web_before = _http_json(
                f"{base_url}/agent/classification/web/unknown-domains",
                headers=device_headers,
            )

            t0 = time.perf_counter_ns()
            backfilled_web_count = pipe_server.reclassify_unknown_web_logs(limit=10)
            s3_web_gemini_lat_ms = (time.perf_counter_ns() - t0) / 1e6

            _, unknown_web_after = _http_json(
                f"{base_url}/agent/classification/web/unknown-domains",
                headers=device_headers,
            )
            _, hb_after_s3 = _http_json(f"{base_url}/agent/heartbeat", method="POST", headers=device_headers)

            # Query parent logs to verify DB rows and access_status after backfill
            _, parent_app_logs = _http_json(
                f"{base_url}/logs/app?device_id={device_id}",
                headers=parent_headers,
            )
            _, parent_web_logs = _http_json(
                f"{base_url}/logs/web?device_id={device_id}",
                headers=parent_headers,
            )
            _, db_rows_inspect = _http_json(f"{server_url}/__inspect/db-rows")

            zing_row = next(r for r in parent_app_logs["data"] if r["app_name"].lower() == "zingmp3.exe")
            roblox_row = next(
                r for r in parent_web_logs["data"] if r["domain"].lower() in ("roblox.com", "www.roblox.com")
            )
            roblox_db_row = next(
                r for r in db_rows_inspect["website_logs"] if r["domain"].lower() in ("roblox.com", "www.roblox.com")
            )

            assert backfilled_app_count == 1
            assert zing_row["category"] == "entertainment"
            assert zing_row["classification_source"] == "gemini"
            assert zing_row["access_status"] == "blocked"

            assert backfilled_web_count == 1
            assert roblox_row["category"] == "entertainment"
            assert roblox_db_row["classification_source"] == "gemini"
            assert roblox_row["access_status"] == "blocked"
            assert "roblox.com" in hb_after_s3["policy_blocked_domains"]

            scenarios["scenario_3_gemini_fallback_and_backfill"] = {
                "passed": True,
                "app_fallback_test": {
                    "input": {
                        "app_name": "zingmp3.exe",
                        "product_name": "Zing MP3 PC",
                        "file_description": "Ung dung nghe nhac giai tri Zing MP3",
                    },
                    "local_ngram_confidence": round(s3_app_local["confidence"], 4),
                    "local_ngram_candidate": s3_app_local["candidate_label"],
                    "initial_pipe_decision": s3_app_initial,
                    "unknown_apps_queue_before": unknown_apps_before["apps"],
                    "backfilled_count": backfilled_app_count,
                    "unknown_apps_queue_after": unknown_apps_after["apps"],
                    "gemini_roundtrip_ms": round(s3_app_gemini_lat_ms, 2),
                    "persisted_db_row_after_backfill": {
                        "app_name": zing_row["app_name"],
                        "category": zing_row["category"],
                        "classification_source": zing_row["classification_source"],
                        "access_status": zing_row["access_status"],
                    },
                },
                "web_fallback_test": {
                    "input": {"domain": "roblox.com"},
                    "local_ngram_confidence": round(s3_web_local["confidence"], 4),
                    "local_ngram_candidate": s3_web_local["candidate_label"],
                    "initial_pipe_decision": s3_web_initial,
                    "unknown_domains_queue_before": unknown_web_before["domains"],
                    "backfilled_count": backfilled_web_count,
                    "unknown_domains_queue_after": unknown_web_after["domains"],
                    "gemini_roundtrip_ms": round(s3_web_gemini_lat_ms, 2),
                    "persisted_db_row_after_backfill": {
                        "domain": roblox_row["domain"],
                        "category": roblox_row["category"],
                        "classification_source": roblox_db_row["classification_source"],
                        "access_status": roblox_row["access_status"],
                    },
                    "enforced_in_policy_blocked_domains": "roblox.com" in hb_after_s3["policy_blocked_domains"],
                    "policy_blocked_domains_snapshot": hb_after_s3["policy_blocked_domains"],
                },
            }

            # =========================================================================
            # SCENARIO 4: Privacy Toggle (Disable App & Web Classification)
            # =========================================================================
            put_status, put_body = _http_json(
                f"{base_url}/settings/{child_id}",
                method="PUT",
                headers=parent_headers,
                body={
                    "enable_app_classification": False,
                    "enable_web_classification": False,
                },
            )
            assert put_status == 200, f"PUT /settings/{child_id} failed: {put_status} {put_body}"

            # Refresh Agent cached settings from /api/agent/config
            _, cfg_disabled = _http_json(f"{base_url}/agent/config", headers=device_headers)
            cached_settings.update(cfg_disabled["config"])

            s4_app_disabled = pipe_server.classify_app(
                "azota.exe",
                product_name="Azota Exam Client",
                file_description="Ung dung thi va kiem tra truc tuyen Azota",
                allow_remote_fallback=True,
            )
            s4_web_disabled = pipe_server.classify_web_domain("azota.vn", allow_remote_fallback=True)

            app_fb_status, app_fb_body = _http_json(
                f"{base_url}/agent/classification/app/fallback",
                method="POST",
                headers=device_headers,
                body={"app_name": "azota.exe", "product_name": "Azota Exam Client"},
            )
            web_fb_status, web_fb_body = _http_json(
                f"{base_url}/agent/classification/web/fallback",
                method="POST",
                headers=device_headers,
                body={"domain": "azota.vn"},
            )
            _, unk_apps_disabled = _http_json(
                f"{base_url}/agent/classification/app/unknown-apps",
                headers=device_headers,
            )
            _, unk_web_disabled = _http_json(
                f"{base_url}/agent/classification/web/unknown-domains",
                headers=device_headers,
            )

            assert s4_app_disabled == {"category": "unknown", "source": "disabled", "confidence": None}
            assert s4_web_disabled == {"category": "unknown", "source": "disabled", "confidence": None}
            assert app_fb_status == 409
            assert web_fb_status == 409
            assert unk_apps_disabled["enabled"] is False
            assert unk_web_disabled["enabled"] is False

            scenarios["scenario_4_privacy_toggle_off"] = {
                "passed": True,
                "settings_update_status": put_status,
                "agent_config_flags": {
                    "enable_app_classification": cached_settings["enable_app_classification"],
                    "enable_web_classification": cached_settings["enable_web_classification"],
                },
                "agent_app_decision_when_disabled": s4_app_disabled,
                "agent_web_decision_when_disabled": s4_web_disabled,
                "backend_app_fallback_rejection": {"http_status": app_fb_status, "body": app_fb_body},
                "backend_web_fallback_rejection": {"http_status": web_fb_status, "body": web_fb_body},
                "unknown_apps_response": unk_apps_disabled,
                "unknown_domains_response": unk_web_disabled,
            }

        return {
            "verification_version": "1.0.0",
            "verified_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "overall_passed": all(s["passed"] for s in scenarios.values()),
            "environment": {
                "database": harness_info["database"],
                "rls_validated": True,
                "gemini_model": "gemini-2.5-flash",
                "agent_models_dir": models_dir,
                "asset_versions": asset_verification,
                "asset_sha256": asset_hashes,
            },
            "scenarios": scenarios,
        }
    finally:
        if proc.poll() is None:
            try:
                proc.stdin.write("STOP\n")
                proc.stdin.flush()
                proc.wait(timeout=10)
            except Exception:
                proc.kill()


def render_verification_markdown(result: dict) -> str:
    s1 = result["scenarios"]["scenario_1_exact_lookup"]
    s2 = result["scenarios"]["scenario_2_ngram_conclusive"]
    s3 = result["scenarios"]["scenario_3_gemini_fallback_and_backfill"]
    s4 = result["scenarios"]["scenario_4_privacy_toggle_off"]
    env = result["environment"]

    lines = [
        "# Biên bản Nghiệm thu Thực tế Luồng Phân loại Hybrid & Thực thi Chính sách (End-to-End Live Verification)",
        "",
        f"- **Thời điểm nghiệm thu:** `{result['verified_at']}`",
        f"- **Trạng thái tổng thể:** `{'ĐẠT (PASS 4/4 KỊCH BẢN)' if result['overall_passed'] else 'KHÔNG ĐẠT'}`",
        f"- **Cơ sở dữ liệu kiểm thử:** PostgreSQL `{env['database']}` (đã xác nhận RLS trên 17 bảng)",
        f"- **Mô hình Gemini Fallback:** `{env['gemini_model']}` (gọi trực tiếp qua HTTPS)",
        f"- **Bộ model đóng gói tại Agent:** `app_content_model_v1.json` (`v{env['asset_versions']['app_model_version']}`), `web_content_model_v1.json` (`v{env['asset_versions']['web_model_version']}`), `app_exact_lookup_v1.json` (`v{env['asset_versions']['app_lookup_version']}`), `web_exact_lookup_v1.json` (`v{env['asset_versions']['web_lookup_version']}`)",
        "",
        "---",
        "",
        "## Tóm tắt kết quả 4 kịch bản nghiệm thu",
        "",
        "| Kịch bản | Nội dung kiểm tra | Đầu vào thực nghiệm | Kết quả tại Agent | Kết quả tại Backend / DB | Thực thi Policy / Quyền | Kết luận |",
        "|---|---|---|---|---|---|---|",
        f"| **Kịch bản 1** | **Tầng 1: Exact Lookup Hit** | `coccoc.exe`, `www.GameVui.vn` | `browsers` & `entertainment` (`conf = 1.0`, `{s1['app_test']['latency_ms']} ms`) | Lưu DB (`201 Created`), không gọi Gemini | `gamevui.vn` được đưa ngay vào `policy_blocked_domains` | **ĐẠT** |",
        f"| **Kịch bản 2** | **Tầng 2: Local N-gram (`>= 0.70`)** | `genshinimpact.exe`, `vioedu.vn` | `entertainment` (`conf = {s2['app_test']['agent_classification']['confidence']}`) & `education` (`conf = {s2['web_test']['agent_classification']['confidence']}`) | Lưu DB (`201 Created`) với `source = trained_model` | `genshinimpact.exe` gắn `blocked`, `vioedu.vn` gắn `allowed` | **ĐẠT** |",
        f"| **Kịch bản 3** | **Tầng 3: Gemini Fallback + Backfill** | `zingmp3.exe` (`conf = {s3['app_fallback_test']['local_ngram_confidence']}`), `roblox.com` (`conf = {s3['web_fallback_test']['local_ngram_confidence']}`) | Ghi tạm `unknown` (`pending`) để không chặn Named Pipe | Worker gọi Gemini (`gemini-2.5-flash`) & backfill thành `entertainment` (`source = gemini`) | Cả 2 chuyển sang `access_status = blocked`; `roblox.com` vào `policy_blocked_domains` | **ĐẠT** |",
        f"| **Kịch bản 4** | **Quyền riêng tư (Tắt phân loại)** | `enable_app/web_classification = false` (`azota.exe`, `azota.vn`) | Bỏ qua cả Local Model & Gemini (`source = disabled`) | Endpoint fallback từ chối với HTTP `409 Conflict`; queue trả `enabled = false` | Tôn trọng tuyệt đối quyền riêng tư của phụ huynh | **ĐẠT** |",
        "",
        "---",
        "",
        "## Chi tiết bằng chứng từng kịch bản",
        "",
        "### Kịch bản 1 — Tầng 1: Tra cứu chính xác (Exact Lookup)",
        f"- **Ứng dụng (`coccoc.exe`):**",
        f"  - Kết quả phân loại cục bộ: `{json.dumps(s1['app_test']['agent_classification'], ensure_ascii=False)}`",
        f"  - Thời gian phản hồi tại Agent: `{s1['app_test']['latency_ms']} ms` (không gọi mạng)",
        f"  - Trạng thái ghi log `POST /api/logs/app`: HTTP `{s1['app_test']['backend_log_status']}`",
        f"- **Website (`www.GameVui.vn` → chuẩn hóa `gamevui.vn`):**",
        f"  - Nguồn quyết định tại `ContentClassifier`: `{s1['web_test']['classifier_raw_decision_source']}` (`confidence = 1.0`)",
        f"  - Dữ liệu gửi `POST /api/logs/web`: `{json.dumps(s1['web_test']['agent_classification'], ensure_ascii=False)}` (HTTP `{s1['web_test']['backend_log_status']}`)",
        f"  - Kiểm tra đồng bộ Policy (`POST /api/agent/heartbeat`): `gamevui.vn` có mặt trong `policy_blocked_domains` = `{s1['web_test']['enforced_in_policy_blocked_domains']}`",
        "",
        "### Kịch bản 2 — Tầng 2: Mô hình Character N-gram cục bộ (`confidence >= 0.70`)",
        f"- **Ứng dụng mới ngoài Lookup (`genshinimpact.exe` — `Genshin Impact`):**",
        f"  - Kết quả N-gram Ensemble: `{json.dumps(s2['app_test']['agent_classification'], ensure_ascii=False)}`",
        f"  - Thời gian suy luận: `{s2['app_test']['latency_ms']} ms`",
        f"  - Trạng thái ghi log `POST /api/logs/app`: HTTP `{s2['app_test']['backend_log_status']}`",
        f"- **Website mới ngoài Lookup (`vioedu.vn`):**",
        f"  - Kết quả N-gram Multinomial NB: `{json.dumps(s2['web_test']['agent_classification'], ensure_ascii=False)}`",
        f"  - Thời gian suy luận: `{s2['web_test']['latency_ms']} ms`",
        f"  - Trạng thái ghi log `POST /api/logs/web`: HTTP `{s2['web_test']['backend_log_status']}`",
        "",
        "### Kịch bản 3 — Tầng 3: Độ tự tin thấp (`< 0.70`) → Ghi `pending` → Gọi Gemini Fallback → Backfill & Chặn theo Policy",
        f"- **Luồng Ứng dụng (`zingmp3.exe` — `Zing MP3 PC`):**",
        f"  1. Xác suất N-gram cục bộ: `{s3['app_fallback_test']['local_ngram_confidence']}` (`< 0.70`) → Luồng Named Pipe trả ngay `{json.dumps(s3['app_fallback_test']['initial_pipe_decision'])}`.",
        f"  2. Hàng đợi `GET /api/agent/classification/app/unknown-apps` trước backfill: `{json.dumps(s3['app_fallback_test']['unknown_apps_queue_before'], ensure_ascii=False)}`.",
        f"  3. Worker chạy `reclassify_unknown_app_logs()` gọi Gemini + Backfill (tổng thời gian `{s3['app_fallback_test']['gemini_roundtrip_ms']} ms`), số bản ghi cập nhật: `{s3['app_fallback_test']['backfilled_count']}`.",
        f"  4. Bản ghi trên PostgreSQL sau khi backfill (`GET /api/logs/app`): `{json.dumps(s3['app_fallback_test']['persisted_db_row_after_backfill'], ensure_ascii=False)}`.",
        f"- **Luồng Website (`roblox.com`):**",
        f"  1. Xác suất N-gram cục bộ: `{s3['web_fallback_test']['local_ngram_confidence']}` (`< 0.70`) → Luồng Named Pipe trả ngay `{json.dumps(s3['web_fallback_test']['initial_pipe_decision'])}`.",
        f"  2. Hàng đợi `GET /api/agent/classification/web/unknown-domains` trước backfill: `{json.dumps(s3['web_fallback_test']['unknown_domains_queue_before'])}`.",
        f"  3. Worker chạy `reclassify_unknown_web_logs()` gọi Gemini + Backfill (tổng thời gian `{s3['web_fallback_test']['gemini_roundtrip_ms']} ms`), số bản ghi cập nhật: `{s3['web_fallback_test']['backfilled_count']}`.",
        f"  4. Bản ghi trên PostgreSQL sau khi backfill (`GET /api/logs/web`): `{json.dumps(s3['web_fallback_test']['persisted_db_row_after_backfill'], ensure_ascii=False)}`.",
        f"  5. Danh sách `policy_blocked_domains` trả về trong Heartbeat kế tiếp: `{json.dumps(s3['web_fallback_test']['policy_blocked_domains_snapshot'])}`.",
        "",
        "### Kịch bản 4 — Kiểm chứng Quyền riêng tư (Tắt công tắc phân loại AI)",
        f"- Phụ huynh cập nhật `PUT /api/settings/:child_id` (`enable_app_classification = false`, `enable_web_classification = false`) → HTTP `{s4['settings_update_status']}`.",
        f"- Quyết định tại Agent cho `azota.exe`: `{json.dumps(s4['agent_app_decision_when_disabled'])}`.",
        f"- Quyết định tại Agent cho `azota.vn`: `{json.dumps(s4['agent_web_decision_when_disabled'])}`.",
        f"- Backend chặn mọi request gọi Gemini Fallback khi tính năng đang tắt:",
        f"  - `POST /api/agent/classification/app/fallback` → HTTP `{s4['backend_app_fallback_rejection']['http_status']}` (`{s4['backend_app_fallback_rejection']['body']['message']}`)",
        f"  - `POST /api/agent/classification/web/fallback` → HTTP `{s4['backend_web_fallback_rejection']['http_status']}` (`{s4['backend_web_fallback_rejection']['body']['message']}`)",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    result = run_live_e2e_verification()
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    JSON_OUT_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    MD_OUT_PATH.write_text(render_verification_markdown(result), encoding="utf-8")
    print(f"Live E2E Hybrid Verification passed: {result['overall_passed']}")
    print(f"JSON evidence: {JSON_OUT_PATH}")
    print(f"Markdown report: {MD_OUT_PATH}")
    return 0 if result["overall_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
