# Screenshot monitoring — development direction and evidence

Updated 2026-10-13. Scope: the existing Parent Dashboard in `child-monitor-web/app.js`, preserving the incumbent `child-monitor-web/styles.css`.

## Direction contract — stop and resume, 2026-10-13

THESIS: Parents can stop the recurring screenshot schedule from the gallery, including while a requested image is pending, and start it again there.

OWN-WORLD: Preserve the existing blue dashboard, shared primary/secondary buttons, typography, filters, gallery and confirmation dialogs.

STORY: Select a device, read that capture settings apply to every device in the same child profile, then start or stop. Stopping keeps saved images. Show request progress, errors and the need for Agent synchronization honestly.

FIRST VIEWPORT: Place one pair of start/stop buttons below the device/date filters and above the gallery, followed by the current capture status and profile scope. The same controls appear with empty and populated history. Preserve filter drafts and keyboard focus during polling.

FORM: Local extension of the existing Operate surface; code-led, no concept seed or new visual world. The visible device selection determines the action even before Apply.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

The direction contract above is retained. This ordinary extension records documentation in the surface brief; the visual verdict remains `recapture`. No `DESIGN.md`, `.impeccable/design.json`, or raster assets are introduced.

**Operate.** **Giám sát màn hình** remains within **Hoạt động**, beside **Ứng dụng** and **Website**. A paired **Bắt đầu chụp ảnh** / **Dừng chụp ảnh** section sits below the device/date filters and above both empty and populated galleries. Start enables screenshot monitoring when needed, then requests one fresh image from the selected device. Stop disables the recurring schedule, including while an accepted image request is pending, and keeps saved images and filter values. The scope copy explains that enabling or stopping applies to every device in the selected device's child profile and takes effect when the Agent receives the setting. The existing default schedule remains five minutes.

The visible device selection determines the action before **Áp dụng**. Device/date filtering, newest-first thumbnails, device and capture time, enlargement, pagination, deletion controls, and metadata polling remain available.

Preserve the dashboard's blue palette, typography, navigation, buttons, forms, and shared modal behavior. Use three/two/one thumbnail columns for desktop/intermediate/mobile widths. This ordinary extension establishes no new identity, comp, or artwork.

`PRODUCT.md` remains the product context. This stop/resume follow-up changes frontend behavior using existing API contracts; it introduces no backend or Agent production changes. The existing Agent already supports stopping through the screenshot setting. Operational behavior and installation instructions live in `child-monitor-agent/docs/screenshot_monitoring.md`; that document and the frontend README are owned by the main implementation handoff.

## Source comparison

Compared the current screenshot functions and existing caption rules with the incumbent activity-screen and shared-component patterns. This follow-up reuses the blue visual system, shared buttons and form-action layout; it leaves `styles.css` unchanged. Caption deletion controls belong to the earlier implementation.

| Area | Observed implementation |
| --- | --- |
| Visual system | Screen-history rules reuse existing blue `--forest`/`--primary-ring`, `--ink-soft`, `--line`, `--cream`, `--paper`, and `--radius-md` tokens. Existing body/display fonts and shared button treatments continue to apply. No new palette or typography system is introduced. |
| Navigation and controls | `activityTabs()` retains the three existing views. The same labeled capture section follows the device/date filters in empty and populated galleries: primary **Bắt đầu chụp ảnh**, secondary **Dừng chụp ảnh**, live status, then child-profile scope. Refresh and **Xóa tất cả ảnh** remain secondary toolbar buttons. Each caption retains its small ghost **Xóa ảnh** action, labeled with device and capture time. |
| Grid and captions | CSS defines three columns above 1200px, two at 1200px and below, and one at 610px and below, with a 24px gap. Thumbnails use a 16:10 box with `object-fit: contain`. Captions use a flex row with a 12px gap; the device/time group can shrink and wrap, while the delete button does not shrink. Filters and tabs adapt at the added breakpoints. These are source observations, not rendered verification. |
| Enlargement and access | `viewScreenshot()` uses the shared dialog, enlarged to at most 1200px. Shared modal behavior includes inert background, focus trapping/return, Escape and backdrop closing. Images arrive through the authenticated API helper with `cache: 'no-store'`; the renderer accepts JPEG base64 data URLs and escapes labels. This documents frontend behavior, not an independent backend security audit. |
| Target and scope | `screenshotCaptureTarget()` reads the visible device selection before **Áp dụng**; it resolves the sole monitored device when there is only one. Start/stop use that device's `child_id`. The adjacent scope text and button group's accessible description explain that the setting applies to all devices in that child profile. With multiple devices and no selection, the controls require a device. |
| Start and resume | `setScreenshotCapture()` sends `PUT /settings/:child_id` with only `{ enable_screenshot_review: true }` when monitoring is disabled, then `POST /logs/screenshots/request` for the selected device. It does not require monitoring to be enabled beforehand. After an accepted request, date filters and pagination reset to reveal a fresh image, unless a newer Refresh/filter render has superseded that view. A pending immediate request retains its existing three-minute lifetime. |
| Stop | **Dừng chụp ảnh** sends the same existing settings endpoint only `{ enable_screenshot_review: false }`. Saved rows, applied filters and visible filter drafts remain. Stop stays available while an accepted image request is pending. Both actions are temporarily disabled while a start/stop operation is being submitted. Status and success copy explain that the Agent stops when it receives the configuration. |
| Errors and completion | If enabling succeeds but requesting the immediate image fails, the toast explicitly says periodic capture is enabled but the immediate request failed. A failed stop reports that stopping failed and restores usable controls. Operation identity separates settings completion from view versions: Refresh cannot strand disabled controls, and an older completion cannot reset a newer selection. Logout clears operation ownership, screenshot rows, device state and polling metadata so late completions cannot restore the previous session. |
| Individual deletion | `confirmScreenshotDelete()` opens the shared confirmation dialog with device and capture time, irreversible-deletion wording, **Hủy**, and a danger-styled **Xóa ảnh** action. Confirmation sends `DELETE /logs/screenshots/:id`. On success the modal closes, a deleted-count toast appears, pagination resets, and the gallery reloads. |
| Clear-all scope | `confirmClearScreenshots()` reads the visible device selection before **Áp dụng**. A selected device limits deletion to that device; **Tất cả thiết bị** includes all devices owned by the account. It fetches fresh scope metadata without date filters and shows the count, scope, inclusion of images outside the time filter, and irreversible effect. The dialog states that deletion does not change the automatic-capture setting, including when capture is stopped. Loading, empty-scope, and failure/retry states use the shared dialog. |
| New-arrival protection | Clear-all confirmation captures the scope's latest ID from the metadata response and sends it as `through_id` with `confirm_all: true`. The confirmed device scope and upper ID travel with the confirmation button. Images arriving with a higher ID after that snapshot are preserved; date filters and page size do not narrow the confirmed clear-all scope. |
| States and pagination | The live status distinguishes no device, selection required, monitoring disabled/enabled, submission in progress, waiting online/offline, expired requests, and interrupted connection. Start is disabled while an image is pending; Stop remains available for an enabled profile. List errors offer retry; enlargement has loading and expired/error messages. Pagination requests 12 images and corrects an offset that no longer has rows after deletion. |
| Metadata polling | `scheduleScreenshotRefresh()` checks metadata every 2 seconds when any returned device has a pending request, every 15 seconds otherwise, and every 30 seconds after an error. A signature compares counts, latest IDs, scope metadata, and device status. The gallery reloads thumbnails only after a signature change or recovery from an error. Background failures preserve loaded content; successful full refresh clears the error state. Stale responses are guarded. These intervals describe implementation, not measured end-to-end latency. |
| Interaction preservation | Hidden documents, open modals, active start/stop operations, focused form fields, and keyboard-focused buttons/links (`:focus-visible`) defer background replacement. Visible device/date values are compared with applied state to preserve drafts after blur. The guard runs before polling and background rendering. Control-only updates preserve focus on the same enabled action, another enabled action, or the labeled capture section; accepted-start rendering restores focus when it still owns the view. |

Evidence locations: `child-monitor-web/app.js` functions `renderScreenshotActivity`, `screenshotCaptureTarget`, `screenshotCaptureControls`, `updateScreenshotCaptureControls`, `updateScreenshotCapturePolicy`, `setScreenshotCapture`, polling/deletion helpers, `clearSession`, and start/stop action handlers; existing shared and screen-history rules in `styles.css`; `child-monitor-web/test/screenshots.test.js`; and the operational document above. This documentation pass changes only this surface brief.

## Drift and review status

Pre-existing naming drift remains: committed frontend titles/auth copy still use **SafeNest**, while `PRODUCT.md` establishes **LaptopChildren**. Legacy token names such as `--forest` and `--mint` already represent the blue palette. These observations are recorded without renaming or repairing the incumbent system.

**Finish review disposition: `recapture`. Visual review remains unresolved.** Browser `getForUrl` failed; after troubleshooting, discovery returned `browsers.list() = []`. No current desktop (1440px) or mobile (390px) capture is available. Earlier screenshots do not verify the paired controls. Required visual evidence covers empty/populated and pending/stopped states, responsive wrapping, filters, deletion dialogs and keyboard focus. Source review and automated checks do not constitute visual approval.

The source reviewer verified both findings resolved: the Refresh-plus-failed-stop race now completes control cleanup by operation identity, and accepted-start rendering restores keyboard focus only while it owns the view and focus has returned to the document body. Targeted regressions passed independently. This resolves the source findings without granting whole-surface visual approval.

The 2026-10-13 implementation handoff reports 57 frontend tests plus `npm.cmd run check`, 18 core integration tests on isolated PostgreSQL/Redis, and 16 Agent screenshot tests passing. The documenter did not rerun those checks. `http://localhost:5173/app.js` returned HTTP 200 with the Stop label and handler. The changed-file detector report `.runtime/screenshot-stop-ui-detect.json` is `[]`. These are source, delivery and automated-test observations; no current visual pass or VMware validation is claimed.

Previous delivery test counts and executable packaging notes are not current stop/resume validation. Source snapshot SHA-256 at this handoff (recheck after later source edits):

- `app.js`: `B72C0B50666700E4BD83E52600886B95408CCD37775A26F45C871D0D131E488E`
- `styles.css`: `2BE82F4541CDA4D6857D2D88D30101CC278F61430ECCE8732EA51A4C46F3A890`
