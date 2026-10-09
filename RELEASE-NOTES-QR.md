# MeeTab 1.1 — Complete project snapshot with 1280×800 QR fix

This is the earlier reviewed `MeeTab1.1-Full-Updated.zip` source package, with **only** the `website/index.html` QR layout adjustment applied.

## New QR layout change
- In narrow/tablet mode, Wi-Fi QR card is 140 × 168 px; QR image is 112 × 112 px.
- This avoids overlapping the meeting title on a 1280 × 800 display.
- All other web/backend/Android source files are unchanged relative to the earlier full package.

## Package directories
- `website/`: HTML/CSS/JS and image assets; set branding in `site-config.js`.
- `backend/`: Node.js OAuth and calendar API; credentials are supplied via private Render environment variables.
- `android/`: Android source project (not a prebuilt APK).
- `.github/workflows/`: manually triggered web deployment, Android debug build and Trivy scan workflows.
- `tests/`: local smoke tests and mocked provider fixtures.

## Important limitations
- **No APK is included.** Build via GitHub Actions `Build MeeTab Android debug APK`, then test on a real tablet.
- **No production deployment has been carried out.** Review in a dedicated branch/PR before owner-approved deploy.
- **IT e-mail sending needs a configured backend webhook/mail service** and owner-approved deployment.
- **Trivy has not been executed** on this package yet.
- **Fonts are deliberately not redistributed in this archive.** Copy your existing, authorized `website/fonts/` assets from your own project if you need the original typefaces. The HTML/CSS still references them.
- Booking concurrency controls, general rate limits and multi-tenant isolation remain follow-up security work; this is not a certified multi-customer production release.
