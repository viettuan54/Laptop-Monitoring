# 💻 Laptop Monitoring

> **Hệ thống giám sát và quản lý thời gian sử dụng laptop cho trẻ em tích hợp trí tuệ nhân tạo**

**Laptop Monitoring** là hệ thống hỗ trợ phụ huynh theo dõi, quản lý và bảo vệ trẻ em trong quá trình sử dụng laptop. Hệ thống thu thập hoạt động sử dụng thiết bị, ứng dụng và website; áp dụng các chính sách kiểm soát; đồng thời tích hợp **AI/Edge AI** để phân loại nội dung, phát hiện rủi ro và hỗ trợ phụ huynh đánh giá thói quen sử dụng máy tính của trẻ.

Dự án được xây dựng theo kiến trúc gồm **Windows Agent – Backend Server – Parent Dashboard – AI Training Workspace**.

---

## 🎯 Mục tiêu dự án

Laptop Monitoring hướng tới xây dựng một hệ thống có khả năng:

* Theo dõi thời gian trẻ sử dụng laptop.
* Ghi nhận ứng dụng và website được sử dụng.
* Thống kê thời gian sử dụng theo ngày và tháng.
* Phân loại ứng dụng và website bằng AI.
* Thiết lập chính sách cho phép/chặn theo từng nhóm nội dung.
* Phát hiện và cảnh báo các hoạt động có nguy cơ.
* Theo dõi khoảng cách và tư thế ngồi bằng webcam và Edge AI.
* Hỗ trợ phụ huynh quản lý nhiều trẻ và nhiều thiết bị.
* Phân tích dữ liệu sử dụng và hỗ trợ đưa ra khuyến nghị.
* Đảm bảo dữ liệu của từng tài khoản phụ huynh được cô lập và bảo vệ.

---

## 🏗️ Kiến trúc hệ thống

```text
┌─────────────────────────────┐
│      Parent Dashboard       │
│   HTML / CSS / JavaScript   │
└──────────────┬──────────────┘
               │ REST API / JWT
               ▼
┌─────────────────────────────┐
│       Backend Server        │
│     Node.js / Express       │
│                             │
│ Auth • Children • Devices   │
│ Logs • Policies • Alerts    │
│ AI Analysis • Admin         │
└───────┬───────────┬─────────┘
        │           │
        │           ├──────────────► Gemini AI
        │
        ▼
┌───────────────────┐
│    PostgreSQL     │
│       + RLS       │
└───────────────────┘
        ▲
        │ REST API
        │ X-Device-Secret
┌───────┴─────────────────────┐
│     Child Monitor Agent     │
│          Windows            │
│                             │
│  ┌───────────────────────┐  │
│  │ ChildMonitorService   │  │
│  │ Background / Sync     │  │
│  └───────────┬───────────┘  │
│              │ Named Pipe   │
│  ┌───────────▼───────────┐  │
│  │ ChildMonitorCompanion │  │
│  │ Apps • Web • Camera   │  │
│  │       Edge AI         │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

---

## 📁 Cấu trúc dự án

```text
Laptop-Monitoring/
│
├── ai-training/
│   ├── content_classification/
│   ├── data_collection/
│   ├── datasets/
│   ├── evaluation/
│   ├── training/
│   └── tests/
│
├── child-monitor-agent/
│   ├── companion/
│   ├── config/
│   ├── installer/
│   ├── models/
│   ├── service/
│   └── tests/
│
├── child-monitor-backend/
│   ├── AI/
│   ├── src/
│   ├── test/
│   ├── Data.sql
│   ├── migration.sql
│   └── server.js
│
├── child-monitor-web/
│   ├── assets/
│   ├── test/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── server.js
│
├── TESTING.md
└── README.md
```

### `child-monitor-agent`

Agent được cài trên laptop của trẻ và chịu trách nhiệm:

* Theo dõi thời gian hoạt động.
* Ghi nhận ứng dụng đang được sử dụng.
* Theo dõi lịch sử truy cập website trên các trình duyệt được hỗ trợ.
* Lưu dữ liệu tạm thời khi mất kết nối.
* Đồng bộ dữ liệu với Backend.
* Nhận và áp dụng chính sách từ phụ huynh.
* Chạy các chức năng Edge AI liên quan đến webcam.

Agent được chia thành hai tiến trình:

**ChildMonitorService**

* Chạy nền dưới Windows `LocalSystem`.
* Quản lý hàng đợi dữ liệu.
* Đồng bộ dữ liệu với Backend.
* Nhận và thực thi policy.
* Lưu `device_secret` an toàn bằng Windows DPAPI.

**ChildMonitorCompanion**

* Chạy trong phiên đăng nhập của người dùng.
* Theo dõi ứng dụng và trình duyệt.
* Hiển thị cảnh báo.
* Truy cập webcam.
* Chạy các chức năng Edge AI.
* Gửi dữ liệu về Service thông qua Named Pipe.

---

### `child-monitor-backend`

Backend cung cấp REST API và xử lý nghiệp vụ trung tâm của hệ thống.

Các chức năng chính:

* Đăng ký, đăng nhập và xác thực tài khoản.
* Quản lý phụ huynh.
* Quản lý hồ sơ trẻ em.
* Quản lý thiết bị.
* Quản lý cấu hình và policy.
* Tiếp nhận log ứng dụng và website.
* Tổng hợp thời gian sử dụng.
* Quản lý cảnh báo.
* AI Analysis.
* AI Summary và Chat Advisor.
* Quản trị người dùng.
* Audit Log.
* Push Notification.
* Đồng bộ dữ liệu offline từ Agent.

Backend tách riêng hai cơ chế xác thực:

```text
Parent Dashboard → JWT
Child Agent      → X-Device-Secret
```

Dữ liệu giữa các phụ huynh được cô lập bằng **PostgreSQL Row Level Security (RLS)**.

---

### `child-monitor-web`

Parent Dashboard là giao diện dành cho phụ huynh và quản trị viên.

Dashboard hỗ trợ:

* Quản lý tài khoản.
* Quản lý hồ sơ trẻ em.
* Quản lý thiết bị.
* Theo dõi trạng thái thiết bị.
* Xem thời gian sử dụng laptop.
* Theo dõi ứng dụng.
* Theo dõi website.
* Tìm kiếm và lọc lịch sử hoạt động.
* Thiết lập chính sách ứng dụng/website.
* Xem cảnh báo.
* Xem kết quả AI Analysis.
* Sử dụng AI Advisor.
* Quản lý người dùng và hệ thống đối với Admin.
* Xem Audit Log.
* Xuất dữ liệu hoạt động CSV.

---

### `ai-training`

Workspace dành riêng cho quá trình:

```text
Data Collection
      ↓
Data Validation
      ↓
Feature Processing
      ↓
Model Training
      ↓
Evaluation
      ↓
Deployment Gate
      ↓
Edge AI Model
```

Workspace hiện bao gồm các thành phần liên quan đến:

* Phân loại ứng dụng.
* Phân loại website.
* Thu thập landmark tư thế.
* Hiệu chỉnh khoảng cách webcam.
* Huấn luyện baseline posture classifier.
* Đánh giá model.
* Quản lý dataset và taxonomy.

Dữ liệu huấn luyện được tách khỏi dữ liệu vận hành thực tế của Agent.

---

## 🤖 Trí tuệ nhân tạo

### 1. Phân loại ứng dụng

Ứng dụng được phân thành các nhóm:

```text
learning
entertainment
browsers
unknown
```

Hệ thống sử dụng cơ chế hybrid:

```text
Application
     │
     ▼
Exact Lookup
     │
     ├── Found ─────────► Category
     │
     ▼
Trained Model
     │
     ├── Confidence OK ─► Category
     │
     ▼
Gemini Fallback
     │
     ▼
Final Category
```

Cách tiếp cận này giúp giảm số lần phải gọi AI bên ngoài trong khi vẫn xử lý được các ứng dụng mới chưa có trong dataset.

---

### 2. Phân loại website

Website được phân loại theo domain và được sử dụng để hỗ trợ phụ huynh thiết lập chính sách truy cập.

Luồng xử lý:

```text
Domain
   ↓
Local Classification
   ↓
Confidence Check
   ↓
Gemini Fallback
   ↓
Category
   ↓
Allow / Block Policy
```

Kết quả phân loại có thể được lưu lại để phục vụ quá trình backfill và giảm việc phân loại lại những domain đã biết.

---

### 3. Phát hiện khoảng cách

Webcam được sử dụng để ước lượng khoảng cách giữa trẻ và màn hình.

Quy trình:

```text
Webcam
   ↓
Face / Landmark
   ↓
Eye Separation Feature
   ↓
Personal Calibration Profile
   ↓
Distance Estimation
   ↓
Safety Policy
```

Ví dụ chính sách:

```text
distance < 33 cm        → Warning
33 cm ≤ distance < 37 cm → Continue sampling
distance ≥ 37 cm        → Safe
```

---

### 4. Phân tích tư thế

Edge AI sử dụng landmark để phát hiện một số tư thế như:

```text
good
forward_head
trunk_lean
shoulder_tilt_left
shoulder_tilt_right
slouching
```

Model được đánh giá theo hướng **Leave-One-Subject-Out (LOSO)** nhằm kiểm tra khả năng tổng quát hóa trên người chưa xuất hiện trong tập huấn luyện.

Nếu model không đạt yêu cầu hoặc confidence thấp, Agent có thể quay về **rule-based safety fallback**.

---
### 5. AI Analysis & Advisor

Backend hỗ trợ AI để:

* Phân tích xu hướng sử dụng thiết bị.
* Tổng hợp hoạt động.
* Hỗ trợ phụ huynh hiểu dữ liệu.
* Đưa ra gợi ý quản lý phù hợp.
* Xử lý các trường hợp phân loại mà model cục bộ chưa đủ độ tin cậy.

---

## 🛡️ Bảo mật

Hệ thống áp dụng nhiều lớp bảo vệ:

| Thành phần            | Cơ chế                  |
| --------------------- | ----------------------- |
| Parent Authentication | JWT + Refresh Token     |
| Agent Authentication  | Device Secret           |
| Device Secret Storage | SHA-256 / Windows DPAPI |
| Database Isolation    | PostgreSQL RLS          |
| Password              | bcrypt                  |
| Rate Limiting         | Redis                   |
| Sensitive Operations  | Audit Log               |
| Offline Sync          | Idempotent Batch        |
| Account deletion      | Cascade deletion        |
| Agent communication   | REST API + Named Pipe   |
| AI Dataset            | Không lưu ảnh mặc định  |

Agent chỉ gửi các dữ liệu kỹ thuật cần thiết cho chức năng phân loại và giám sát, hạn chế thu thập dữ liệu không cần thiết.

---

## 🛠️ Công nghệ sử dụng

### Backend

* Node.js
* Express.js
* PostgreSQL
* Redis
* JWT
* bcrypt
* Gemini API
* RESTful API

### Windows Agent

* Python
* Windows Service
* SQLite
* OpenCV
* MediaPipe
* Edge AI
* Windows DPAPI
* Named Pipe

### Parent Dashboard

* HTML5
* CSS3
* JavaScript
* REST API

### AI / Machine Learning

* Python
* Scikit-learn
* MediaPipe
* OpenCV
* Custom dataset
* Hybrid classification
* Gemini fallback

---

## ⚙️ Cài đặt

### 1. Clone repository

```bash
git clone https://github.com/viettuan54/Laptop-Monitoring.git
cd Laptop-Monitoring
```

---

### 2. Backend

```bash
cd child-monitor-backend
npm install
```

Tạo file `.env` dựa trên:

```text
.env.example
```

Khởi tạo PostgreSQL database và chạy các migration theo thứ tự.

Sau đó chạy:

```bash
npm run dev
```

Backend mặc định:

```text
http://localhost:3000
```

---

### 3. Parent Dashboard

Mở terminal mới:

```bash
cd child-monitor-web
node server.js
```

Truy cập:

```text
http://localhost:5173
```

Dashboard tự proxy các request `/api/*` tới Backend ở cổng `3000`.

---

### 4. Child Monitor Agent

Cách khuyến nghị là sử dụng bộ cài:

```text
ChildMonitorSetup-<version>.exe
```

Trước khi cài Agent:

1. Đăng nhập Parent Dashboard.
2. Tạo hồ sơ trẻ em.
3. Đăng ký thiết bị.
4. Lấy `device_secret`.
5. Chạy bộ cài Agent bằng quyền Administrator.
6. Nhập Backend URL và Device Secret.
7. Hoàn tất cài đặt.

Máy được giám sát không cần cài Python nếu sử dụng bản Agent đã build.

---

## 🧪 Testing

### Backend

Backend integration test sử dụng PostgreSQL và Redis test riêng.

```bash
cd child-monitor-backend
npm test
```

Các bài test bao gồm:

* Authentication.
* Refresh token rotation.
* PostgreSQL RLS isolation.
* Classification policies.
* Batch synchronization.
* Idempotency.
* Redis distributed rate limiting.

### Agent

```powershell
cd child-monitor-agent
.\run_tests.ps1
```

Xem hướng dẫn chi tiết tại:

```text
TESTING.md
```

---

## 🔄 Luồng hoạt động tổng quát

```text
              ┌─────────────────┐
              │      Parent     │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Dashboard    │
              └────────┬────────┘
                       │ JWT
                       ▼
              ┌─────────────────┐
              │     Backend     │
              └───┬─────────┬───┘
                  │         │
          PostgreSQL       AI Services
                  │
                  │
                  ▲
                  │ X-Device-Secret
                  │
              ┌───┴─────────────┐
              │      Agent      │
              └───┬─────────┬───┘
                  │         │
             Activity     Edge AI
                  │         │
                  ▼         ▼
              Apps/Web   Webcam
```

---

## 🚀 Hướng phát triển

Một số hướng mở rộng của dự án:

* Hoàn thiện và mở rộng dataset AI.
* Nâng cao độ chính xác của posture detection.
* Mở rộng số lượng người tham gia đánh giá LOSO.
* Cải thiện khả năng phân loại website và ứng dụng mới.
* Xây dựng dashboard bằng framework frontend hiện đại.
* Phát triển ứng dụng mobile dành cho phụ huynh.
* Bổ sung báo cáo tuần/tháng trực quan hơn.
* Cải thiện hệ thống cảnh báo thời gian thực.
* Mở rộng Edge AI nhằm giảm dữ liệu phải gửi lên server.
* Đóng gói và triển khai hệ thống trong môi trường production.

---

## ⚠️ Phạm vi sử dụng

Dự án được xây dựng phục vụ mục đích **nghiên cứu và đồ án tốt nghiệp**.

Hệ thống hướng tới việc hỗ trợ phụ huynh quản lý việc sử dụng laptop của trẻ một cách minh bạch và có trách nhiệm. Các chức năng giám sát cần được triển khai phù hợp với quy định về quyền riêng tư và bảo vệ dữ liệu cá nhân.

---

## 📌 Project

**Laptop Monitoring — AI-powered Child Laptop Monitoring System**

> Xây dựng hệ thống giám sát và quản lý thời gian sử dụng laptop cho trẻ em tích hợp trí tuệ nhân tạo.
