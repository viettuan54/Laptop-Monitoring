# 💻 LaptopChildren

[![LaptopChildren Multi-Subsystem CI](https://github.com/viettuan54/Laptop-Monitoring/actions/workflows/ci.yml/badge.svg)](https://github.com/viettuan54/Laptop-Monitoring/actions/workflows/ci.yml)

> **Hệ thống giám sát và quản lý thời gian sử dụng laptop cho trẻ em tích hợp trí tuệ nhân tạo (AI / Edge AI)**

**LaptopChildren** là hệ sinh thái hỗ trợ phụ huynh theo dõi, định hướng và bảo vệ trẻ em khi sử dụng máy tính Windows theo hướng **minh bạch và tôn trọng quyền riêng tư (Privacy-by-Design)**. Hệ thống kết hợp đồng bộ **5 phân hệ độc lập**: **Windows Agent (+ Tiện ích trình duyệt MV3)**, **Backend REST API (PostgreSQL RLS + Redis)**, **Parent Web Dashboard & Admin Console**, **Parent Android App (Kotlin/Compose)** và **Dịch vụ AI / Edge AI**.

---

## 🎯 Tính năng trọng tâm

* **Giám sát & thống kê sử dụng thiết bị:** Ghi nhận thời lượng ứng dụng (foreground) và tên miền website theo ngày/tháng (múi giờ `Asia/Ho_Chi_Minh`), tổng hợp biểu đồ trực quan trên Web và Android.
* **Thực thi chính sách bền bỉ cả khi mất mạng:** Hạn mức thời gian ngày, khung giờ cho phép, khóa máy khẩn cấp, chặn ứng dụng cấm (ân hạn 8 giây kèm biên nhận), chặn website đa lớp (`hosts` + HTTP/SNI + tiện ích Manifest V3 chặn ngay trên tab đang mở) và nhắc nghỉ giải lao Win32 không cướp tiêu điểm phím.
* **Chụp màn hình minh bạch theo sự đồng thuận:** Chỉ hoạt động khi phụ huynh bật quyền theo phiên, hiển thị thông báo trước 3 giây trên máy trẻ, xử lý trên RAM và tự dọn ảnh sau 7 ngày.
* **Phân loại nội dung lai 3 tầng (Hybrid Classification v1.2.0):** Phân loại 4 nhóm ứng dụng (`learning`, `entertainment`, `browsers`, `unknown`) và 5 nhóm website (`education`, `entertainment`, `social`, `unsafe`, `unknown`) tại biên với độ trễ trung bình `< 1 ms`, chỉ gọi Gemini Fallback khi độ tin cậy `< 0,70`.
* **Kiểm duyệt truy vấn tìm kiếm tiếng Việt (`text_safety` v13):** Quét truy vấn tìm kiếm mỗi 3 giây khi được cấp quyền, lọc thông tin định danh (PII) tại biên, không lưu nguyên văn mà chỉ lưu nhãn rủi ro (`SAFE`, `RISK`, `HIGH_RISK`) kèm `model_sha256`.
* **Edge AI thị giác trên RAM (`eye_distance_profile_v3` & `posture_baseline_v1`):** Giám sát khoảng cách mắt và tư thế ngồi theo phiên 1–60 phút (bật/tắt độc lập), không lưu hình ảnh webcam xuống ổ cứng.
* **Trợ lý AI Advisor & Báo cáo tổng hợp:** Phân tích hành vi theo thiết bị (24 giờ qua), tạo báo cáo tóm tắt 1 ngày / 7 ngày và hội thoại tư vấn phụ huynh qua Gemini API có phòng chống Prompt Injection.
* **Bảo mật đa tầng & Quản trị vận hành:** Cô lập dữ liệu đa gia đình bằng **PostgreSQL Row Level Security (RLS)**, xoay vòng JWT/Refresh Token, Redis Rate Limit, Audit Log bất biến và **xác thực khuôn mặt 1:1 (FaceNet 128D, 5 khung hình)** cho Quản trị viên.

---

## 🏗️ Kiến trúc tổng thể 5 phân hệ

```text
┌──────────────────────────────┐      ┌──────────────────────────────┐
│     Parent Web Dashboard     │      │     Parent Android App       │
│  HTML5 / CSS3 / Vanilla JS   │      │  Kotlin / Jetpack Compose    │
│  (Phụ huynh & Admin Console) │      │  v0.7.1 • AES-GCM Keystore   │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │ HTTPS / REST API (JWT + Refresh)    │
               └──────────────────┬──────────────────┘
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│               Backend Server (child-monitor-backend)               │
│                     Node.js 20 LTS / Express 5                     │
│  Auth • FaceNet 1:1 • Children • Devices • Policies • Logs         │
│  Screenshots • Break Reminders • Alerts • AI Advisor • Admin       │
└───────┬─────────────────────────┬──────────────────────────┬───────┘
        │                         │                          │
        ▼                         ▼                          ▼
┌───────────────────┐   ┌───────────────────┐    ┌────────────────────────┐
│   PostgreSQL 16   │   │     Redis 7.x     │    │  AI & External APIs    │
│ 22 bảng (v34)     │   │ Distributed Rate  │    │ • text_safety (:8100)  │
│ RLS trên 18 bảng  │   │ Limit             │    │ • FaceNet 128D (1:1)   │
└───────────────────┘   └───────────────────┘    │ • Gemini API / FCM     │
                                                 └────────────────────────┘
                                  ▲
                                  │ HTTPS / X-Device-Secret (SHA-256)
                                  │ Batch Idempotent (unnest)
┌─────────────────────────────────┴──────────────────────────────────┐
│             Windows Agent v1.0.31 (child-monitor-agent)            │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │ ChildMonitorService (System) │  │ ChildMonitorCompanion      │  │
│  │ SQLite DPAPI (10 bảng)       │◄─┤ Apps • Web • GDI Screen    │  │
│  │ Hosts/SNI • AppEnforcer      │  │ Edge AI Webcam (RAM)       │  │
│  │ Watchdog • Offline Sync      │  │ Break Notice Win32         │  │
│  └──────────────┬───────────────┘  └────────────────────────────┘  │
│                 │ Named Pipe (DACL)                                │
│  ┌──────────────▼───────────────────────────────────────────────┐  │
│  │ SafeNestBrowserHost.exe ↔ Tiện ích Chrome/Edge/Cốc Cốc (MV3) │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Cấu trúc kho mã nguồn

```text
Laptop-Monitoring/
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions CI chạy song song 5 phân hệ
├── child-monitor-backend/            # Phân hệ 1: Backend Node.js/Express + PostgreSQL RLS + Redis
│   ├── AI/                           # Trích xuất vector FaceNet 128D & kiểm định chất lượng ảnh
│   ├── scripts/
│   │   └── setup-fresh-db.js         # Khởi tạo sạch 34 tệp SQL (Data.sql → migration_v34.sql) & RLS
│   ├── src/
│   │   ├── config/                   # Cấu hình 2 pool (app_admin / app_backend) & Redis
│   │   ├── controllers/              # 16 bộ điều khiển nghiệp vụ
│   │   ├── middlewares/              # 6 middleware (auth, deviceAuth, role, ownership, rateLimit, rls)
│   │   ├── routes/                   # 10 nhóm REST API routes
│   │   └── services/                 # 15 dịch vụ nghiệp vụ, AI & Push Notification
│   ├── test/                         # 163 ca Unit Test + 25 ca Integration Test (PostgreSQL/Redis thật)
│   ├── Data.sql                      # Lược đồ nền tảng
│   ├── migration_v*.sql              # Chuỗi di trú lược đồ tới migration_v34.sql (22 bảng)
│   └── server.js
├── child-monitor-web/                # Phân hệ 2: Parent Web Dashboard & Admin Console (SPA thuần)
│   ├── assets/                       # Tài nguyên minh họa & favicon
│   ├── test/                         # 343 ca kiểm thử tự động (UI state, security headers, API coverage)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── server.js                     # Static server + reverse proxy /api/* kèm CSP/X-Frame-Options
├── child-monitor-android/            # Phân hệ 3: Parent Android App (Kotlin + Jetpack Compose, v0.7.1)
│   ├── app/src/
│   │   ├── main/java/vn/laptopchildren/parent/  # AppGraph, SessionStore (AES-GCM), ViewModel, UI
│   │   ├── test/                     # 35 ca JUnit 4 + MockWebServer Unit Tests
│   │   └── androidTest/              # Compose Instrumentation Tests (kiểm nghiệm trên Redmi K30)
│   └── TESTING.md                    # Biên bản xác minh và kiểm thử ứng dụng Android
├── child-monitor-agent/              # Phân hệ 4: Windows Agent v1.0.31 & Browser Extension MV3
│   ├── browser-extension/            # Tiện ích Manifest V3 (declarativeNetRequest)
│   ├── build/                        # build-agent.ps1 (PyInstaller + Inno Setup 6)
│   ├── companion/                    # app_tracker, web_tracker, screen_monitor, edge_vision, break_notice
│   ├── installer/                    # install.ps1, provision_agent.py
│   ├── models/                       # Mô hình cục bộ & tệp băm .sha256
│   ├── service/                      # main_service, pipe_server, offline_queue, enforcement_core, watchdog
│   └── tests/                        # 242 ca Python unittest + 6 ca MV3 JS test
├── ai-training/                      # Phân hệ 5: Huấn luyện, đánh giá AI & dịch vụ text_safety (:8100)
│   ├── content_classification/       # Phân loại App/Web lai 3 tầng v1.2.0
│   ├── school_violence/              # Kiểm duyệt tìm kiếm tiếng Việt text_safety v13
│   ├── evaluation/                   # Cổng đánh giá LOSO, khoảng cách mắt v3, hybrid pipeline
│   ├── text_safety/                  # Dịch vụ FastAPI nội bộ (:8100)
│   ├── tests/                        # 215 ca Python unittest (214 pass / 1 skip có ĐK)
│   └── tests_finetune/               # 5 ca kiểm thử mô hình fine-tune
└── README.md
```

---

## 🤖 Kết quả thực nghiệm các mô hình AI & Edge AI

| Mô hình / Phân hệ | Tập dữ liệu & Phương pháp đánh giá | Chỉ số đạt được | Cổng kiểm duyệt |
|---|---|---|---|
| **1. Phân loại Ứng dụng Hybrid v1.2.0** *(4 lớp: Lookup + Multinomial NB n-gram + Temperature Scaling + Gemini)* | Tập đại diện (80 mẫu) & Ngoài Lookup (56 mẫu mới, trùng lặp 0%) | Đại diện: **Acc 98,75%**, Macro-F1 **98,75%**<br>Ngoài Lookup: **Acc 98,21%**, Macro-F1 **98,21%**<br>Xử lý cục bộ **73,75%** ở **0,0817 ms** | Đạt (`deployment_approved = true`) |
| **2. Phân loại Website Hybrid v1.2.0** *(5 lớp: Lookup + Length-Normalized NB n-gram + OOF Calibration + Gemini)* | Tập đại diện (125 mẫu) & Ngoài Lookup (90 mẫu mới) | Đại diện: **Acc 92,80%**, Macro-F1 **92,81%**<br>Ngoài Lookup: **Acc 90,00%**, Macro-F1 **90,02%** (`unsafe` P/R/F1 **100%**)<br>Xử lý cục bộ **50,40%** ở **0,0427 ms** | Đạt (`deployment_approved = true`) |
| **3. Kiểm duyệt văn bản `text_safety` v13** *(3 lớp: `SAFE` / `RISK` / `HIGH_RISK`)* | Kiểm định chéo 5×5 fold (282 câu D1–D4) & Tập phát triển Dulieu5 (90 câu) | Cross-val (282): **Acc 84,82%**, Macro-F1 **0,85258**, Recall `HIGH_RISK` **99,16%**, `HIGH_RISK → SAFE = 0`<br>Dulieu5 (90): **Acc 94,44%** (85/90), Recall `HIGH_RISK` **100%** | Ứng viên nội bộ (giữ `deployment_eligible = false` chờ tập test mù) |
| **4. Ước lượng khoảng cách mắt `eye_distance_profile_v3`** | Kiểm thử độc lập 332 mẫu tại 7 mốc (30–40 cm) | **MAE = 0,79 cm**, **RMSE = 0,95 cm**, Bias = -0,08 cm<br>Vùng đệm `33–<37 cm`: bỏ sót **0,0%**, cảnh báo giả **0,0%** | Đạt 5/5 tiêu chí (`passed = true`) |
| **5. Nhận diện tư thế `posture_baseline_v1`** *(good / bad)* | Kiểm định chéo theo đối tượng LOSO (3 người / 72 cửa sổ) | TB 3 fold LOSO: **Acc 93,33%**, Macro-Recall **95,24%**, Coverage **97,92%**, Conclusive Acc **93,06%** | Đạt cổng LOSO (`passed = true`) |

---

## 🛡️ Kiến trúc Bảo mật & Quyền riêng tư (Privacy-by-Design)

| Lớp bảo vệ | Cơ chế triển khai thực tế |
|---|---|
| **Cô lập dữ liệu đa gia đình** | PostgreSQL **Row Level Security (RLS)** trên 18 bảng với 2 pool tách biệt (`app_admin` và `app_backend` `NOSUPERUSER NOBYPASSRLS`) dùng `SET LOCAL app.current_user_id` theo từng giao dịch. |
| **Xác thực Phụ huynh** | JWT ngắn hạn + **Refresh Token Rotation** chống tái sử dụng token; Web lưu trong `sessionStorage`, Android mã hóa AES-GCM bằng `AndroidKeyStore`. |
| **Xác thực Quản trị viên** | Mật khẩu (`bcrypt`) + **Xác thực khuôn mặt 1:1** (FaceNet 128 chiều, 5 khung hình liên tiếp, mã thử thách TTL 2 phút, chỉ lưu vector đặc trưng, không lưu ảnh gốc). |
| **Xác thực & bảo vệ Windows Agent** | `X-Device-Secret` băm SHA-256 trên máy chủ, mã hóa cục bộ bằng **Windows DPAPI**; giao tiếp nội bộ Service–Companion qua Named Pipe có **DACL** giới hạn SID phiên hiện tại và `LocalSystem`. |
| **Đồng bộ ngoại tuyến bền bỉ** | Store-and-Forward với SQLite `local.db` (10 bảng) và chèn lô lũy đẳng `unnest() ON CONFLICT (device_id, client_record_id) DO NOTHING` (0 bản ghi trùng lặp). |
| **Chống lạm dụng & Kiểm toán** | Redis Distributed Rate Limiting, phòng chống Prompt Injection cho Gemini API và bảng `audit_logs` bất biến. |
| **Minh bạch với trẻ em** | Báo trước 3 giây khi chụp màn hình, ân hạn 8 giây trước khi đóng ứng dụng cấm, hộp thoại nhắc nghỉ `SWP_NOACTIVATE` không cướp tiêu điểm phím, xử lý webcam trên RAM và lọc PII trước khi kiểm duyệt tìm kiếm. |

---

## 🧪 Kiểm thử tự động & GitHub Actions CI

Hệ thống được tích hợp pipeline CI đa phân hệ tại [.github/workflows/ci.yml](.github/workflows/ci.yml), tự động chạy song song **5 jobs** (`ubuntu-latest` và `windows-latest`) trên mỗi lần đẩy mã:

| Job CI / Phân hệ | Phạm vi kiểm thử tự động | Kết quả |
|---|---|---|
| **1. Backend (`child-monitor-backend`)** | Unit/Middleware + Dựng PostgreSQL 16 (34 tệp lược đồ `Data.sql → migration_v34.sql`, kiểm chứng RLS 18 bảng) + Redis 7 thật | **163/163 unit + 25/25 integration pass** |
| **2. Web Dashboard (`child-monitor-web`)** | Syntax check (`app.js`, `server.js`) + 17 bộ test giao diện, biểu đồ, bộ lọc, ảnh màn hình, AI Advisor, Admin Face, bảo mật CSP | **343/343 pass** |
| **3. Windows Agent (`child-monitor-agent`)** | 24 bộ Python unittest (SQLite DPAPI, Named Pipe, chặn app/web, chụp màn hình, múi giờ chính sách, Edge AI) + bộ test MV3 Extension (`browser_policy.test.cjs`) | **242 Python + 6 JS pass** |
| **4. AI Service & FaceNet (`ai-training` & `Backend/AI`)** | 43 bộ test `ai-training/tests/`, 5 ca `tests_finetune/` và 4 ca kiểm định đầu vào FaceNet | **223 pass / 1 skip có ĐK** *(220 AI + 4 Face)* |
| **5. Parent Android App (`child-monitor-android`)** | 8 bộ Gradle JUnit 4 + MockWebServer + Android Lint (`compileSdk 35`, JDK 17) & Instrumentation trên Xiaomi Redmi K30 | **35/35 unit & Lint pass; build APK OK** |

---

## ⚙️ Hướng dẫn cài đặt & chạy cục bộ

### 1. Clone mã nguồn

```bash
git clone https://github.com/viettuan54/Laptop-Monitoring.git
cd Laptop-Monitoring
```

### 2. Backend (Node.js 20 LTS + PostgreSQL 16 + Redis 7)

```bash
cd child-monitor-backend
npm install
# Tạo tệp .env từ .env.example và cấu hình kết nối PostgreSQL / Redis / Gemini API
node scripts/setup-fresh-db.js   # Khởi tạo sạch 34 tệp lược đồ (Data.sql → migration_v34.sql) & RLS
npm run dev                      # Chạy tại http://localhost:3000
```

Chạy kiểm thử Backend:

```bash
npm run test:unit                # 163 ca unit test
npm run test:integration         # 25 ca tích hợp PostgreSQL RLS + Redis thật
```

### 3. Dịch vụ AI kiểm duyệt văn bản (`text_safety` FastAPI)

```powershell
$env:TEXT_SAFETY_ENV = "development"
$env:TEXT_SAFETY_API_KEY = "<shared-local-moderation-secret>"
.\.runtime\text-safety-venv\Scripts\python.exe -m uvicorn text_safety.main:app --app-dir .\ai-training --host 127.0.0.1 --port 8100 --no-access-log
```

### 4. Parent Web Dashboard & Admin Console

```bash
cd child-monitor-web
node server.js                   # Truy cập http://localhost:5173 (tự proxy /api/* tới :3000)
npm test                         # Chạy 343 ca kiểm thử tự động
```

### 5. Parent Android App (`vn.laptopchildren.parent` v0.7.1)

```powershell
cd child-monitor-android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Hỗ trợ cài bản QA cô lập trên thiết bị thật: `.\gradlew.bat assembleDebug -PisolatedQa=true` và `adb install -r ...`.

### 6. Windows Agent (`ChildMonitorSetup-1.0.31.exe`)

Đóng gói bộ cài từ mã nguồn (yêu cầu Python 3.11 64-bit, PyInstaller và Inno Setup 6):

```powershell
cd child-monitor-agent
.\build\build-agent.ps1
```

Quy trình cài đặt trên máy tính của trẻ:
1. Đăng nhập **Web Dashboard** hoặc **Android App** → tạo hồ sơ trẻ → đăng ký thiết bị để nhận mã `Device Secret` (hiển thị 1 lần).
2. Chạy `ChildMonitorSetup-1.0.31.exe` bằng quyền Administrator trên laptop Windows của trẻ.
3. Nhập địa chỉ Backend URL và `Device Secret` để hoàn tất ghép nối và kích hoạt `ChildMonitorService` + `ChildMonitorCompanion` + tiện ích trình duyệt Manifest V3.

Xem thêm biên bản xác minh thiết bị Android tại [child-monitor-android/TESTING.md](child-monitor-android/TESTING.md) và cấu hình pipeline kiểm thử tự động tại [.github/workflows/ci.yml](.github/workflows/ci.yml).

---

## 🚀 Hướng phát triển tiếp theo

* Thu thập tập kiểm thử mù độc lập quy mô lớn cho `text_safety` v13 và mở rộng số lượng đối tượng thu thập dữ liệu để nâng cấp mô hình tư thế LOSO & khoảng cách mắt.
* Bổ sung chống giả mạo ảnh sống (liveness detection) và duy trì worker suy luận nền cho xác thực khuôn mặt Quản trị viên 1:1.
* Tích hợp mô hình Edge AI siêu nhẹ phát hiện/làm mờ nội dung màn hình nhạy cảm (18+) và cảnh báo người lạ sử dụng máy.
* Ký số Authenticode cho bộ cài Windows Agent, nghiệm thu đầu-cuối FCM trên dự án Firebase thương mại và mở rộng sang macOS/iOS.

---

## ⚠️ Phạm vi sử dụng

Dự án được xây dựng phục vụ mục đích **nghiên cứu và Đồ án tốt nghiệp đại học ngành Công nghệ thông tin**. Hệ thống hướng tới việc hỗ trợ phụ huynh đồng hành cùng trẻ sử dụng máy tính an toàn, minh bạch và tuân thủ các nguyên tắc bảo vệ quyền riêng tư cá nhân.
