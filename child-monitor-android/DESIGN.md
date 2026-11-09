---
name: LaptopChildren Android Parent
description: The LaptopChildren blue identity expressed through native Material 3 phone screens.
colors:
  light-primary: "#174EA6"
  light-on-primary: "#FFFFFF"
  light-primary-container: "#DBEAFE"
  light-on-primary-container: "#0F2E53"
  light-secondary: "#32675F"
  light-secondary-container: "#D9EEE8"
  light-on-secondary-container: "#143E36"
  light-background: "#F4F7FB"
  light-on-background: "#11233F"
  light-surface: "#FCFDFF"
  light-on-surface: "#11233F"
  light-surface-variant: "#E8EEF6"
  light-on-surface-variant: "#52617A"
  light-outline: "#74829A"
  light-outline-variant: "#D5DFEB"
  light-error: "#B42318"
  light-error-container: "#FFDAD5"
  light-on-error-container: "#680600"
  dark-primary: "#ADC7FF"
  dark-on-primary: "#002E6D"
  dark-primary-container: "#17477F"
  dark-on-primary-container: "#D8E5FF"
  dark-secondary: "#9FD3C5"
  dark-secondary-container: "#244D44"
  dark-on-secondary-container: "#D1F2E6"
  dark-background: "#101822"
  dark-on-background: "#E2E9F4"
  dark-surface: "#151F2D"
  dark-on-surface: "#E2E9F4"
  dark-surface-variant: "#283547"
  dark-on-surface-variant: "#B7C4D7"
  dark-outline: "#8C9BB1"
  dark-outline-variant: "#3D4B60"
typography:
  headline-medium:
    fontFamily: "Roboto (Android system sans-serif)"
    fontWeight: 700
  headline-small:
    fontFamily: "Roboto (Android system sans-serif)"
  title-large:
    fontFamily: "Roboto (Android system sans-serif)"
  title-medium:
    fontFamily: "Roboto (Android system sans-serif)"
  title-small:
    fontFamily: "Roboto (Android system sans-serif)"
  body-large:
    fontFamily: "Roboto (Android system sans-serif)"
  body-medium:
    fontFamily: "Roboto (Android system sans-serif)"
  body-small:
    fontFamily: "Roboto (Android system sans-serif)"
  label-large:
    fontFamily: "Roboto (Android system sans-serif)"
  label-medium:
    fontFamily: "Roboto (Android system sans-serif)"
  label-small:
    fontFamily: "Roboto (Android system sans-serif)"
rounded:
  chart-top: "5dp"
  field-alert-selector: "12dp"
  brand-usage: "16dp"
spacing:
  detail: "4dp"
  compact-inset: "6dp"
  small: "8dp"
  alert-content: "10dp"
  section-gap: "12dp"
  content: "16dp"
  editor-gap: "18dp"
  page: "20dp"
  form-page: "24dp"
  auth-horizontal: "28dp"
components:
  button-primary-light:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.light-on-primary}"
    typography: "{typography.label-large}"
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-on-primary}"
    typography: "{typography.label-large}"
  button-outlined-light:
    textColor: "{colors.light-primary}"
    typography: "{typography.label-large}"
  button-outlined-dark:
    textColor: "{colors.dark-primary}"
    typography: "{typography.label-large}"
  button-text-light:
    textColor: "{colors.light-primary}"
    typography: "{typography.label-large}"
  button-text-dark:
    textColor: "{colors.dark-primary}"
    typography: "{typography.label-large}"
  field:
    rounded: "{rounded.field-alert-selector}"
    typography: "{typography.body-large}"
  usage-light:
    backgroundColor: "{colors.light-primary-container}"
    textColor: "{colors.light-on-primary-container}"
    rounded: "{rounded.brand-usage}"
    padding: "{spacing.page}"
  usage-dark:
    backgroundColor: "{colors.dark-primary-container}"
    textColor: "{colors.dark-on-primary-container}"
    rounded: "{rounded.brand-usage}"
    padding: "{spacing.page}"
  alert-unread-light:
    backgroundColor: "{colors.light-primary-container}"
    rounded: "{rounded.field-alert-selector}"
    padding: "{spacing.content}"
  alert-unread-dark:
    backgroundColor: "{colors.dark-primary-container}"
    rounded: "{rounded.field-alert-selector}"
    padding: "{spacing.content}"
---

# Design System: LaptopChildren Android Parent

## Overview

**Creative North Star: "LaptopChildren blue, native Material 3"**

This is a direct extension of the established LaptopChildren identity, as recorded in [DIRECTION.md](DIRECTION.md). Blue actions, quiet surfaces, readable Vietnamese text and familiar Android controls support parents checking a child's laptop use. This descriptive direction records the accepted implementation; it introduces no new visual metaphor.

Use a compact, single-column phone interface. Show the selected child before dependent information, let parents scan use and alerts, and name the child affected by policy changes. Brand expression lives in the color scheme, outlined laptop mark and measured spacing; structure and interaction use Jetpack Compose Material 3.

**Key Characteristics:**

- Blue emphasis with subdued green connection and selection roles.
- System typography, visible labels and content that grows with font scale.
- Native controls, quiet separators and tonal surfaces.
- Clear selected-child context and honest loading, empty and unavailable states.

Source authority is `ui/Theme.kt`, `ui/ParentApp.kt` and `ui/SettingsScreens.kt` under `app/src/main/java/vn/laptopchildren/parent/`. This document applies only to this Android client. It does not replace the root web design or product documents.

## Colors

The palette translates the existing web blue, dark ink and pale background into two explicit Material schemes. Frontmatter lists the actual overrides in `Theme.kt`; roles omitted there retain the dependency's `lightColorScheme` or `darkColorScheme` defaults. In particular, dark error colors and newer surface-container levels are inherited defaults, not bespoke project tokens.

### Primary

Use the primary/on-primary pair for filled actions and the primary color for actionable icons and usage bars. Primary-container/on-primary-container gives the usage summary and unread alerts their quiet emphasis. The light scheme retains the established identity blue; the dark scheme uses a lighter blue foreground against a deeper blue container.

### Secondary

Muted green distinguishes connected devices. Material selection controls such as the navigation indicator and selected filter chips use the secondary-container pair through their defaults. Connection state also has a text label; color is never its only signal.

### Neutral

Background is the main canvas. Surface distinguishes device and navigation rows; on-surface-variant handles secondary explanations and timestamps. Outlines describe fields; outline-variant supports quiet dividers. Error roles identify validation failures, dismissible error banners and destructive account actions.

**The Semantic Color Rule.** UI code reads `MaterialTheme.colorScheme` roles; it does not copy palette literals into individual screens.

Theme selection follows `isSystemInDarkTheme()`. Wallpaper-derived Dynamic Color and an in-app theme switch are not implemented. Both schemes are code-defined. Only dark mode has physical-device visual evidence in this pass: MIUI retained night mode when light mode was requested. Do not represent the light scheme as visually verified.

## Typography

The app uses the default Material 3 `Typography` supplied by its Compose dependency, with Android system sans-serif (normally Roboto); it bundles no font. Sizes, line heights and tracking inherit the Material role definitions, in scalable `sp`, rather than a custom type scale. Frontmatter records only used roles and the consistently explicit headline-medium weight; absent numerical properties mean inherited defaults, not missing custom tokens.

| Material role | Observed purpose and local weight overrides |
| --- | --- |
| headlineMedium | LaptopChildren wordmark and today's usage; bold (700). |
| headlineSmall | Login purpose statement; overview and family headings use semibold (600). |
| titleLarge | App-bar, form and policy headings; many headings use semibold (600); account identity retains the role default. |
| titleMedium | Selected child/device and section headings; section headings use semibold (600). |
| titleSmall | Usage label and policy switch titles. |
| bodyLarge | Alert message; explicit medium (500). Other text may inherit the surrounding Material style. |
| bodyMedium | Explanations, dates, monthly totals and errors. |
| bodySmall | Timestamps, secondary guidance and policy explanations. |
| labelLarge | Material action labels and app version. |
| labelMedium | Alert status and activity duration. |
| labelSmall | Selector caption, chart values and day labels. |

No display role, custom font pairing, monospaced data face or all-caps label system is established. Preserve Vietnamese diacritics. Do not replace role styles with per-screen fixed pixel sizes.

## Layout

The current shipping target is a compact Android phone, reviewed on a connected Redmi K30. A `Scaffold` supplies top-bar context, snackbar hosting and four bottom destinations. Main content consumes scaffold insets and IME padding; `MainActivity` enables edge-to-edge. There is no tablet rail, expanded-width layout or defined breakpoint system. A tablet release needs an additional adaptive-layout pass.

Main overview, family, alerts and policy content use the page inset token. Authentication uses the auth-horizontal inset and form-page vertical inset. Account and profile editing use form-page padding. Main lists use section-gap spacing; authentication and account content use content spacing. Editors use editor-gap. Section headings add section-gap above and small below. Long lists are lazy; forms scroll vertically; activity filters scroll horizontally.

The child selector stays above the current tab content. Its control has a minimum height of 52dp, rounded field corners and a caption over the selected name. Key sign-in, profile-save and sign-out actions also have a 52dp minimum height. Link rows have a 72dp minimum height. Other controls retain Material's minimum interactive sizing; maintain the native 48dp touch-target floor when extending them.

The recent-use chart shows up to seven days. Its row uses `heightIn(min = 136.dp)` so larger labels can grow without breaking the common baseline. Bars are at most 32dp wide, scale against the highest daily use to 88dp high, and remain at least 3dp high. Each day exposes one merged spoken date-and-duration description. These dimensions are chart geometry, not global layout tokens.

## Elevation & Depth

The app conveys structure mainly through background, surface and container tones. Custom summary and alert surfaces specify neither shadow nor tonal elevation, so they remain flat. Material navigation, menus, dialogs, buttons and snackbars retain their dependency defaults, including surface levels and state layers. No custom shadow vocabulary or custom animation timing is defined. Preserve native interaction feedback rather than adding decorative movement.

## Shapes

Use the brand-usage corner token for the laptop mark tile and usage summary. Field-alert-selector corners unify outlined fields, child/device selectors and alert cards. Recent-use bars have only their top corners rounded with the chart-top token. Device and link rows retain the rectangular `ListItem` shape. Buttons, chips, switches, menus and dialogs inherit Material shapes; no global `Shapes` override is supplied.

## Components

### Buttons and fields

Filled `Button` is the clear submit/save action. `OutlinedButton` handles secondary actions and selectors; `TextButton` handles recovery, disclosure, cancellation and lightweight actions. Native shapes, state layers, focus and disabled treatment remain intact. Busy state disables the relevant mutation controls and main navigation. There is no custom hover animation.

`OutlinedTextField` has a persistent label, full available width, single-line input and the shared field shape. Email, password, number and URI fields set the appropriate keyboard type. Password visibility uses a labelled icon button. Local validation appears as error-colored explanatory text; the global request error appears in a dismissible error-container banner. The implementation does not set the fields' `isError` flag, so do not claim a red field-border state that is absent.

### Navigation and selection

Compact navigation has four labelled destinations: Tổng quan, Hoạt động, Cảnh báo and Gia đình. Material `NavigationBarItem` supplies icon, label and selected indicator. The top app bar names the screen and offers refresh on tab roots. Policy, account and profile subpages hide the bottom bar and expose an auto-mirrored Back arrow.

System Back from a subpage returns to Gia đình; from a non-overview tab it returns to Tổng quan. Authentication subflows return to login. This is implemented using `BackHandler`; predictive-back animation is not separately implemented or verified. Child and device selectors open a Material dropdown. Activity and alert filters are Material `FilterChip`s with native selected states.

### Summaries, lists and alerts

The usage surface presents one headline total and a secondary monthly total. Device `ListItem`s pair the outlined laptop icon with connection text and a last-seen timestamp. Navigation rows use a blue leading icon, supporting text and a directional chevron. Activity rows use restrained dividers instead of individual rounded cards.

Unread alerts use primary-container emphasis and a visible attention label; read alerts use surface and a read label. A text action marks an unread alert as read. Automated content-analysis alerts include context explaining that the signal needs parental interpretation.

### Policies and feedback

Policy rows pair a title and explanation with a Material switch. The screen names the selected child and explains synchronization. Changes such as locking a laptop or enabling relevant analysis open Material confirmation dialogs. Time and break fields have explicit save actions. Snackbar messages report transient outcomes; linear progress indicates loading or busy work; empty states provide a vector icon, explanation and an appropriate action when available.

The account screen states when Firebase notifications are unconfigured and leaves in-app alerts available. Firebase setup is deferred by the user, so documentation must not imply background push is currently configured. Destructive account deletion uses a confirmation dialog and password entry.

### Assets and evidence

The shipped visuals use Compose outlined vector icons and Android vector resources; no shipping raster art is present. Review PNGs are evidence, not app assets. Dark-theme captures for login, overview, activity, alerts, family, policy and account live in `../.impeccable/review/android/dark/`; the same names in `../.impeccable/review/android/large/` cover font scale 1.3. The large overview capture initially showed a baseline issue; source now uses a minimum row height, with final confirmation delegated to the finish review. No web design detector ran for this native app.

The companion `.impeccable/design.json` carries source locations, evidence limits and panel previews. Its HTML/CSS samples illustrate the native patterns for documentation only; the Compose implementation and device captures remain the rendering authority.

## Do's and Don'ts

### Do:

- **Do** use semantic Material color roles and the inherited scalable typography.
- **Do** keep the selected child visible and name the child affected by a policy change.
- **Do** retain native Back, inset handling, labelled controls and at least 48dp touch targets.
- **Do** let text and scrollable content grow at larger system font scales.
- **Do** pair status color with readable labels and show empty, loading and unavailable states honestly.

### Don't:

- **Don't** introduce a second visual identity or replace native Material controls with web imitations.
- **Don't** hard-code light colors into screens that follow the system theme.
- **Don't** force text-bearing layouts into fixed heights that clip larger fonts.
- **Don't** claim light-theme, tablet, predictive-back-animation or configured-push verification from the current phone evidence.
