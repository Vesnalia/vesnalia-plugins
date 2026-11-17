# Changelog

## 0.2.0

- Fix the opaque fallback layer covering the live shader. Add pixel regressions for actual VesnALIA surfaces, shader output changes, and WebGL loss/recovery.

- Replace the long form with a workspace preview, real shader thumbnails, and a focused Look/Surfaces/Motion/Shader inspector. Add the same controls to VesnALIA Settings.
- Add Silk and Contours, five palette choices and custom colors, bounded rendering quality, and a custom GLSL library with import/export and preview-before-save.
- Preserve saved shaders when resetting appearance; serialize library mutations alongside settings writes.
- Keep compact VesnALIA panels, navigation, and popups opaque to prevent underlying text showing through; preserve desktop preferences and pause the hidden global shader.
- Add WebGL compilation/fallback/resource tests and actual VesnALIA browser regressions across phone/tablet/desktop widths.

## 0.1.1

- Rework the panel into full-width native settings sections with responsive layout, accessible controls, clearer first-use guidance, and explicit reset confirmation.
- Show loading and persistence errors. Serialize and coalesce edits, retain failed changes for retry, and prevent stale reads or saves from replacing newer edits.
- Validate complete wallpaper URLs when applied and report image loading failures.
- Serialize server writes across windows; recover invalid fields independently and preserve unrelated stored values on normal edits.
- Clean up fetches, timers, theme/motion listeners, and WebGL resources. Pause hidden-tab motion, respond immediately to reduced-motion and theme changes, and use Glow when WebGL is unavailable.
- Replace scaffold documentation and align development/types with VesnALIA 0.41.0 and SDK 0.4.34.

## 0.1.0

- Initial Transparency release with ambient and image backdrops, surface opacity, and sidebar/composer/popup frost controls.
