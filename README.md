# DTR POB Network

Mobile-first operational dashboard for the DTR faction's four player-owned bases. It combines Darkstat telemetry, facility maintenance reserves, watched cargo, inventory quotations and offline snapshot support in one installable web app.

## Runtime

- Static HTML, CSS and JavaScript; no build step is required.
- Live POB data is requested from the Darkstat API.
- The latest verified response, previous snapshot, selected view and watchlist are stored locally on the device.
- A service worker caches the application shell. Telemetry itself remains network-only.

## Behaviour

- All visible interface text is English.
- Missing quantities remain unknown (`—`) and are never treated as zero.
- Stock bars and alerts use API-provided minimum and maximum limits. When limits are absent, no bar or inferred stock warning is shown.
- Facility supplies fall back to DTR maintenance thresholds only when the API provides no valid limits.
- App updates wait for explicit approval through **UPDATE NOW** before reloading.
- The desktop tab strip and the larger fixed mobile navigation operate on the same view state.
- On phones, decorative header layers collapse so live POB content begins substantially higher on the first screen.

## Quality checks

Run the repository's dependency-free audit with:

```sh
node tests/static-audit.mjs
```

The GitHub Actions workflow also checks every JavaScript file for syntax errors and runs the static audit for pull requests and changes to `main`.
