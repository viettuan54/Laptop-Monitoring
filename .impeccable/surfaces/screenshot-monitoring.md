# Screenshot monitoring — development direction and evidence

Recorded 2026-10-08. Scope: the existing Parent Dashboard in `child-monitor-web/app.js` and `child-monitor-web/styles.css`.

## Direction

**Operate.** Extend **Hoạt động** with **Giám sát màn hình**, beside **Ứng dụng** and **Website**. Parents opt in through the existing device controls; the Agent captures the main screen every five minutes by default. The requested **Bắt đầu chụp ảnh** action asks the selected device for one fresh image; it does not enable consent or replace the regular schedule. Preserve the dashboard's blue palette, typography, navigation, buttons, forms, and modal behavior. Present device/date filters, newest-first thumbnails with device and capture time, enlargement, pagination, and useful empty/error/loading feedback. Refresh every 30 seconds when interaction permits. Use three/two/one thumbnail columns for desktop/intermediate/mobile widths. This ordinary extension establishes no new identity, comp, or artwork.

`PRODUCT.md` remains the product context. Its general UI-only constraints do not describe the separately requested Agent/backend feature work in this delivery. Operational behavior and installation instructions live in `child-monitor-agent/docs/screenshot_monitoring.md`.

## Source comparison

Compared the bounded capture-action implementation with the incumbent activity screen and shared components. The capture-action follow-up reuses existing controls and leaves the stylesheet byte-for-byte unchanged from the previous recorded snapshot; the earlier stylesheet comparison found no root-token changes.

| Area | Observed implementation |
| --- | --- |
| Visual system | The stylesheet adds 35 lines after the existing rules; root tokens are unchanged. It reuses blue `--forest`/`--primary-ring`, `--ink-soft`, `--line`, `--cream`, `--paper`, and `--radius-md`. Existing body/display fonts continue to apply. |
| Navigation and controls | `activityTabs()` shares the existing tab classes and selected treatment across all three views. Filters use the incumbent field/input/select and primary/secondary/ghost buttons. The new capture action uses the existing primary button in the empty state or populated-page actions; it replaces the misleading empty-state link to controls. The opt-in switch remains in device controls. |
| Grid | CSS defines three columns above 1200px, two at 1200px and below, and one at 610px and below, with a 24px gap. Thumbnails use a 16:10 box with `object-fit: contain`; captions keep device name and capture time. Filters and tabs adapt at the same added breakpoints. These are source observations, not rendered verification. |
| Enlargement and access | `viewScreenshot()` uses the shared dialog, enlarged to at most 1200px. Shared code supplies inert background, focus trapping/return, Escape and backdrop closing. Images arrive through the authenticated API helper with `cache: 'no-store'`; the renderer accepts JPEG base64 data URLs and escapes labels. This documents frontend behavior, not an independent backend security audit. |
| Capture behavior | `startScreenshotCapture()` reads the visible device selection, even before applying filters; the only device is selected automatically when applicable. It sends `POST /logs/screenshots/request`, clears date filters and pagination after acceptance so a fresh image can appear, and guards late responses. Agent 1.0.17 receives a one-capture command through heartbeat with a three-minute lifetime; consent must already be enabled and the default five-minute schedule continues. Backend/Agent details are recorded in the operational document. |
| States and refresh | Empty results offer **Bắt đầu chụp ảnh**. A status region distinguishes no device, device selection required, monitoring disabled/enabled, waiting online/offline, and expired requests. Capture is disabled when unavailable or pending; failed submissions restore the action and show the existing error toast. List errors offer retry; the enlargement dialog has loading and expired/error messages. Full-page navigation uses the existing spinner and busy state. Tab/filter/list refresh requests retain current content while awaiting the response, following the incumbent activity pattern. Pagination requests 12 images. Polling pauses for hidden documents, open modals, or focused interactive controls; stale responses are guarded. |

Evidence locations: `app.js` functions `renderDeviceControls`, `renderActivity`, `activityTabs`, `renderScreenshotActivity`, `startScreenshotCapture`, the `start-screenshot` action handler, `scheduleScreenshotRefresh`, `viewScreenshot`, `api`, `showModal`, `closeModal`, and `navigate`; `styles.css` root tokens, shared button/tab/filter/modal rules, reduced-motion rule, and appended screen-history rules; `test/screenshots.test.js`; and the operational document linked above. No application or incumbent design-system files were changed by this documentation pass. No root `DESIGN.md` or `.impeccable/design.json` was created.

## Drift and review status

Pre-existing naming drift remains: committed frontend titles/auth copy still use **SafeNest**, while `PRODUCT.md` establishes **LaptopChildren**. Legacy token names such as `--forest` and `--mint` already represent the blue palette. These observations were reported without renaming or repairing the incumbent system. No new palette or type-system divergence was found in the inspected source.

**Finish review disposition: `recapture`. Visual review remains unresolved.** The build session repeatedly received `agent.browsers.list() = []`, including a fresh runtime initialization, and the fresh finish reviewer retained `recapture`. The user supplied an earlier screenshot showing the misleading empty-state controls link; it does not verify the updated capture action. No updated desktop/mobile or user-width screenshots were available; source comparison and passing tests cannot establish visual approval. Required remaining evidence is a full-page desktop capture at 1440px and mobile capture at 390px, plus the user's viewport if available, checked for correct content/loading/overflow and submitted for a full review. No visual pass is claimed.

The build handoff reports 144 Agent Python tests, 75 backend unit/middleware tests, 13 backend integration tests, and 34 frontend tests passing; installer 1.0.17 built successfully with SHA-256 `85e993cb7b3de3c6abc504b0f0d95029ec69b0c5c58af953bf516a1e8ab7dba0`. These checks were not rerun by the documenter. A real capture from the user's VMware guest remains unverified, as the operational document states.

Source snapshot SHA-256 (recheck this comparison after later source edits):

- `app.js`: `5BF3A554189DCED8E5E21AEF507376E090E1521F16D07608B3D8D3733F6EA31F`
- `styles.css`: `20DE356C7541E1DBF995DB214AAEFC81C50A4FB84AEE9BCDD2E9560C19C7088E`
