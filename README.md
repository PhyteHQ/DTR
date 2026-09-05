# DTR POB Network

Mobile-first operational dashboard for the DTR faction's four player-owned bases. It combines Darkstat telemetry, facility maintenance reserves, POB-specific pinned cargo, inventory quotations, recipe costing, production capacity and offline snapshot support in one installable web app.

## Runtime

- Static HTML, CSS and JavaScript; no build step is required.
- Live POB data is requested from the Darkstat API.
- The latest verified response, previous snapshot, selected view and per-POB pin lists are stored locally on the device.
- A service worker caches the application shell. Telemetry itself remains network-only.

## Behaviour

- All visible interface text is English.
- Missing quantities remain unknown (`—`) and are never treated as zero.
- Stock bars and alerts use API-provided minimum and maximum limits. When limits are absent, no bar or inferred stock warning is shown.
- Facility supplies fall back to DTR maintenance thresholds only when the API provides no valid limits.
- App updates wait for explicit approval through **UPDATE NOW** before reloading.
- The desktop tab strip and the larger fixed mobile navigation operate on the same view state.
- On phones, decorative header layers collapse so live POB content begins substantially higher on the first screen.
- POB health and last-sync telemetry live in the detail header, leaving only credits and storage as compact summary cards.
- Every POB has its own pinned-cargo list. Existing global watchlist entries are migrated to all four POBs once, then remain independently editable per base.
- Fort Torrelavega includes a live advanced Wildcat Gold production module. It applies the Corsair 0.85× material factor, selects the alternative fuel that supports the most cycles, identifies the next-cycle bottleneck and opens the calculator with the same recipe, POB and fuel selection.
- Equal API minimum and maximum stock limits are shown once as a required stock value.
- On wide desktop screens, the command filter aligns with the dashboard shell and overview figures use larger display type.
- Currency values use Discovery's `$` notation throughout the dashboard and calculator.
- The recipe calculator contains 292 recipes generated from Discovery's public `base_recipe_items.cfg` and `base_recipe_modules.cfg` data.
- Calculator material prices start with the selected DTR POB's Darkstat `price` (**BASE SELLS**) quotation and remain editable per commodity. Manual prices are saved locally per POB, can be reset to the live value and can complete a quote for an unlisted commodity without hiding its stock/listing status.
- Unlisted commodities and missing sale prices remain unknown (`—`) until a manual price is entered; they are never treated as zero.
- Recipe search includes actual outputs as well as recipe titles, so affiliation products such as Wildcat Gold expose their basic, advanced and bulk recipes alongside the separate reprocessing recipe.
- Alternative recipe inputs use a clearly labelled material chooser, automatically prefer the best-priced available option at the selected POB and can be returned to automatic mode after a manual selection.
- The quote summary shows pricing completeness as plain status text and only displays a recipe-fee card when the selected recipe actually charges one.
- Explicitly reported stock shortages are shown separately from pricing completeness. Catalysts are listed as retained requirements and are not added to consumed-material cost.

## Recipe catalog

Rebuild the generated browser catalog from downloaded Discovery CFG files with:

```sh
node scripts/build-recipe-catalog.mjs /path/to/base_recipe_items.cfg /path/to/base_recipe_modules.cfg recipe-catalog.js
```

## Quality checks

Run the repository's dependency-free audit with:

```sh
node tests/static-audit.mjs
```

The GitHub Actions workflow also checks every JavaScript file for syntax errors and runs the static audit for pull requests and changes to `main`.
