# DTR POB Network

Mobile-first DTR command dashboard with four main sections: POB NETWORK (Overview, Sanctum, Invicta and Torrelavega), TRADE ROUTES, FORUM and CALCULATOR. The three POBs remain separate detail views under their own section. It combines Darkstat telemetry, facility maintenance reserves, POB-specific pinned cargo, inventory quotations, recipe costing, production capacity and offline snapshot support in one installable web app.

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
- Every POB has its own pinned-cargo list. Existing global watchlist entries are migrated to all three active POBs once, then remain independently editable per base.
- All three active POBs include the advanced Scrap Smelter for Basic Alloy. Sanctum and Invicta also run Military Salvage Reclamation (25 Prototype Components plus 450 Scrap Metal byproduct per cycle; Corsair factor 0.85×) and an advanced Hydroponics Bay (750 Food Rations per cycle, using Water and Fertilizers; standard Corsair material load). Invicta additionally fabricates Exotic Systems (Corsair factor 0.25×). Fort Torrelavega retains its advanced Wildcat Gold refining (Corsair factor 0.85×).
- Each production module uses the respective POB's live stock for input-cycle capacity, next-cycle bottleneck, byproducts and retained catalysts. COST / CALCULATE opens the matching recipe and POB, with POB purchase (BASE BUYS) prices for material costing.
- Fixed production layout at desktop widths: top-left **Food Rations**, top-right **Basic Alloy**, bottom-left **Prototype Components**, bottom-right **Exotic Systems**. Sanctum leaves the bottom-right slot empty rather than inventing a production module; Torrelavega uses **Wildcat Gold** in the top-left slot and **Basic Alloy** in the top-right. Tablet and phone layouts stack only the modules available at that POB in this logical order without empty placeholders.
- Invicta's dedicated shipyard supports Murmillo (recipe `ship_assembly_dsy_venator`), Legate (`ship_assembly_dsy_legate`), Consul (`ship_assembly_co_battlecruiser_heavy` / Corsair Command Battlecruiser), and Archon (`ship_assembly_medium_miner` / Modular Miner). Each hull has its own verified recipe requirements, POB hull stock, component stock, next-ship shortfall, retained crew/blueprint prerequisites and per-ship cost calculator. The registry stores the selected hull locally.
- Shipyard material coverage is never guessed. Missing/unlisted Darkstat stock yields UNKNOWN and incomplete coverage, not zero or a fabricated production capacity. The Invicta shipyard values Exotic Systems using the live **BASE SELLS** (`price_to_buy_from_base`) quotation (the price Invicta sells Exotics for), not the potentially $1 **BASE BUYS** placeholder. Every other ship component stays on its **BASE BUYS** quotation. The **EST. COMPONENT VALUE** appears only when every required quote is known. In the shipyard table, delivered inputs display **EXTERNAL SUPPLY / POB BUY PRICE**; locally produced Exotic Systems display **IN-HOUSE PRODUCTION / POB SELL VALUE**. This is a hybrid component valuation, not the cost to manufacture Exotics internally. A missing Exotic Systems sale quote remains UNKNOWN and is never substituted with its incoming buy price. The shipyard calculator uses the same narrow Invicta ship-recipe exception; production recipes and other POBs keep the usual BASE BUYS convention. Catalysts, crew and schematics are excluded from consumed-material costs, and assembly prerequisites are separately reported.
- Equal API minimum and maximum stock limits are shown once as a required stock value.
- On wide desktop screens, the command filter aligns with the dashboard shell and overview figures use larger display type.
- Currency values use Discovery's `$` notation throughout the dashboard and calculator.
- The recipe calculator contains 292 recipes generated from Discovery's public `base_recipe_items.cfg` and `base_recipe_modules.cfg` data.
- Calculator material prices start with the selected DTR POB's Darkstat `price_to_sell_to_base` (**BASE BUYS**) quotation and remain editable per commodity. Manual prices are saved locally per POB, can be reset to the live value and can complete a quote for an unlisted commodity without hiding its stock/listing status.
- Unlisted commodities and missing POB purchase prices remain unknown (`—`) until a manual price is entered; they are never treated as zero.
- Recipe search includes actual outputs as well as recipe titles, so affiliation products such as Wildcat Gold expose their basic, advanced and bulk recipes alongside the separate reprocessing recipe.
- Alternative recipe inputs use a clearly labelled material chooser, automatically prefer the best-priced available option at the selected POB and can be returned to automatic mode after a manual selection.
- The quote summary shows pricing completeness as plain status text and only displays a recipe-fee card when the selected recipe actually charges one.
- Explicitly reported stock shortages are shown separately from pricing completeness. Catalysts are listed as retained requirements and are not added to consumed-material cost.

## Trade Routes (Corsair ID docking, v1.0.10)

The Trade Routes workspace reuses the existing independent WAYPOINT route-search core as copied, self-contained `trade-core/` modules, with the original LP solver license bundled. **WAYPOINT stays a separate repository and is not modified.** The workspace has DTR's crimson/gold branding, a four-section desktop/mobile navigation, and a separate POB view switcher.

- **Starting base:** Planet Crete in Omicron Gamma is the default if uniquely present in the live market. The start picker can select any other reported NPC/POB base. A missing or ambiguous Crete mapping is shown as a warning, never silently replaced.
- **Ship profiles:** Darkstat `POST /api/ships` supplies live per-ship `nickname`, `hold_size`, `cruise_speed` and `dock_type`. Three compact personal favorites default to **Raba (3,150 / 500 / Mid)**, **Armicustos (3,600 / 500 / Mid)** and **Essedarius (4,450 / 350 / Mid)**. Each favorite has a star button that assigns the currently selected ship to that slot. Search by actual ship name, Corsair nickname or internal ID (aliases include Bulwark → Bristol Heavy Explorer, Pilgrim → the 4,300 / 415 / Large `pilgrim_liner`, Raba → Hogosha Frigate). The alternate 4,300 / 350 `dsy_slaveliner` and small Mule `dsy_pi_freighter` are intentionally excluded from the user-selectable list. The search includes other playable ships and non-Corsair freighters, excluding entries without positive Cruise speed or valid docking data.
- **Custom ship profiles:** users can manually enter ship name, maximum cargo, Cruise and Docking (Ring/Mid/Large), save up to 30 local profiles, edit/delete them, search them alongside actual ships and pin them as favorites. The separate **Available Cargo** value is visible without opening Advanced Search and is constrained by the selected ship's maximum capacity. Saved shipping and favorites do not alter the Corsair-ID toggle.
- **Physical docking and speed:** Darkstat dock types `1 → berth/ring`, `2 → medium`, `3 → large` directly configure the existing per-ship Discovery navigation graph; known physically incompatible stations are excluded from all route searches, including when unknown-time routing is enabled, and cannot be chosen as the starting base. Unmapped graph positions are not claimed as verified. Actual ship capacity rather than free space is used for ship-related gate restrictions. Loaded WAYPOINT trade lanes are normalized to **2,500 m/s** in DTR only; this does not modify the separate WAYPOINT site. Ship registry data is cached on the device with explicit LIVE, CACHED or PRESET source labels.
- **POBs OFF** and **Corsair ID ON** on a fresh device, independently switchable. Other-faction players can disable Corsair filtering, but this does not magically infer their personal reputation.
- **Corsair ID rephack docking (v1.0.3):** The Corsair switch now fetches `POST /api/tractors` with `{include_rephacks:true,filter_nicknames:["dsy_license_fc_c_grp"]}` and matches the *equipped Corsairs ID* to the owning faction of each NPC base from `/api/npc_bases`. `/api/factions` is used **only to resolve faction names/nicknames**, never as a fallback to NPC faction diplomacy. ID modes are interpreted correctly: `0` limits the maximum achievable reputation, `1` enforces a minimum, `2` does not change a faction and `3` fixes reputation exactly. **Lane Hackers' Corsair-ID maximum is -0.70**, so their **Cochrane Depot in Ontario (`li12_07_base`) is excluded** with Corsair ON, including when unknown docking is explicitly enabled. ID maximums and static values at or below -0.55 are restricted, including every Order NPC base at -0.55. A minimum at exactly -0.55 does not prove access. A cap *above* the threshold means potentially accessible, **not guaranteed** because the player's current standing may still be lower. Missing/invalid ID rephacks remain **ACCESS UNVERIFIED** and are excluded by default; stale cached faction-only relations never grant access. POB ACL, `/nodock`, FR6 rights and personal standing are not public guarantees. Independently reported no-dock Planet Manhattan (`li01_01_base`) and atmospheric landing (`ew16_01_base`) remain forbidden. `INCLUDE UNVERIFIED DOCKS` explicitly opts into uncertain destinations, never known hostile ID caps. Corsair OFF allows other-faction search without pretending to know that character's reputation.
- One-way and round-trip modes, two/three trade segments, return to origin system or exact base, mixed cargo, capital/volume limits, POB storage and cash limits, market-freshness notices, and alternative route families. Flight time includes initial approach from selected base, even when the first purchase is elsewhere.
- Trade search runs in a module worker; market data comes directly from public Darkstat POST endpoints and keeps a distinct browser IndexedDB cache from WAYPOINT and POB telemetry. The full 133-system nav graph ships compressed and is cached in the DTR PWA shell.
- **Mobile layout:** keeps existing visual identity but removes the accidental 330px tall detail telemetry area and compacts the health/sync/credits/storage cards. All existing production, shipyard and forum modules remain intact.
- The first preview is for operational testing. Faction-docking states are *predictions*, not verified in-game permission, and route times remain modeled estimates. The initial market search remains bounded; no claim of exhaustive global optimum.

## Forum Avatar Frame Tool (v1.0.7)

- The Forum tab now offers **two top-level tool buttons** directly under the forum header: **FORUM COMPOSER** and **AVATAR FRAME**. Only the chosen tool is visible; the Avatar tool no longer sits underneath the entire BBCode composer. The existing mobile WRITE / PREVIEW / BB CODE controls remain inside Composer.
- Upload PNG/JPG/WebP (max 15 MB), drag with touch/mouse, use four accessible 8-pixel nudge buttons, or change the zoom from **2% to 400%**. **FIT IMAGE** displays the whole portrait (dark background fills any leftover margins), **FILL FRAME** fills the 200 x 233 canvas. RESET POSITION returns to the centered 100% cover view. Download a **200 x 233 PNG** with the same original frame overlay, unchanged.
- The supplied 200 × 233 PSD and original transparent PNG define the decorative DTR border. The transparent portrait window was distinguished from the exterior transparency to create a **separate RGBA cutout mask** (`assets/dtr-forum-window-mask.png`). The browser now clips both the portrait and optional FIT matte with Canvas `destination-in`, then paints the existing red frame over it. The resulting export has transparent pixels outside the irregular outline, including the sloped left edge.
- Entirely client-side: no image is uploaded, and the PWA caches the local frame asset. Upload the exported PNG separately if a public forum image URL is required.
- v1.0.5 repairs a truncated PNG frame overlay from v1.0.4, which prevented the browser from loading the border and kept DOWNLOAD PNG disabled. The replacement frame is validated with PNG chunk CRCs, full zlib decompression and alpha-mask checks. The editor also preserves the frame loading/error state when a portrait is uploaded. Update the installed PWA with UPDATE NOW to refresh its cached image.

## Forum transmissions

The **FORUM** workspace is a neutral Corsair transmission composer based on the supplied Montserrat / crimson / gold BBCode format. Sender ID, role, location, recipient, encryption, optional opening/sign-off and top/footer artwork URLs are editable. The optional internal draft subject is retained for organising saved drafts but is never rendered in the preview or exported BBCode header. The shared Corsair top banner and footer are editable. The right-side DTR red-serpent crest (`https://i.imgur.com/QFFOGWY.png`) is **always included and cannot be replaced**, including when restoring older saved drafts. The left-side character portrait remains optional and is stored with each sender profile; no portrait is included by default. A one-time migration clears the previously inherited Aurelio GIF from legacy local work without deleting the rest of an existing draft.

WRITE, PREVIEW and BB CODE panes follow RHW's composer workflow. The module supports live preview, one-click copy with a Samsung/mobile-compatible temporary selection fallback and visible status, BBCode formatting shortcuts, spoilers and image links, browser-local autosave, named draft saves and reusable sender identities. If both browser clipboard methods fail, it switches to the visible BB CODE pane and selects the code for manual copying. None of that content is posted to the forum or uploaded to GitHub. The user pastes the generated BBCode into their forum post manually.

Forja del Vacio was retired and is no longer shown as a POB tab, overview card, matrix column, production node or active alert. Old raw Darkstat snapshots and local settings may remain in the browser for recovery but are not part of active counts.

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

GitHub Actions checks JavaScript and ES module syntax and runs static, calculator, production, shipyard, forum, pricing, docking-policy and integrated trade-route runtime audits on changes to `main`.

## Market owner identity (v1.0.12)

- Market rows identify the commodity with `nickname` and the station with `base_nickname`. Ownership fallback now explicitly uses the station ID and excludes POB market rows. Regression data includes both identifiers and overlapping POB records.

## Docking follow-up (v1.0.11)

- If NPC ownership metadata is unavailable, current commodity-market owner fields are used before falling back to cached owners. Conflicting records remain unverified; POB and NPC records cannot overwrite each other's owners.
- Search submission and result acceptance re-evaluate the current Corsair switch and rules. Returned routes must also start at the selected origin. The picker and manifest show both faction and physical docking status consistently.
- Malformed boolean/array ship docking classes are rejected. Additional captured-data audits cover all 81 ID rules, ownership fallbacks and every route mode with exact-base/system returns.
- The empty-results hint keeps the Corsair filter enabled for Corsair pilots. Update the installed app with **UPDATE NOW** to load the complete change.

## Docking update (v1.0.10)

- Discovery refuses NPC docking at reputation **-0.55 or below**. Corsair-ID maximum/static rules now use that inclusive limit; minimum rules only imply possible access strictly above it. This fixes every Order NPC base and other owners at the same boundary, rather than blacklisting one station.
- Malformed numeric/mode fields, duplicate ID records/rules and ambiguous faction display names cannot silently authorize a dock. An explicit canonical owner nickname remains authoritative. NPC faction diplomacy is never substituted for equipped-ID rules.
- Known Ring/Mid/Large incompatibilities stay blocked in every search mode, with Corsair OFF and with unknown flight-time routing enabled. Unmapped/unknown ship docks now require **INCLUDE UNVERIFIED DOCKS**, and are labelled unverified in manifests.
- Failed or malformed docking metadata refreshes retain the last validated Corsair-ID snapshot and previous NPC owners. Cached sources stay visible; the ID-rule timestamp is stored separately from market/POB freshness. Valid fresh API rules still replace the snapshot normally.
- The controller sends docking exclusions to the search worker and screens every returned stop again before showing a route or opening its manifest. Changing a ship or search filter closes an outdated manifest and invalidates previous results.
- Regression coverage uses the public 26 October API capture (81 Corsair-ID rules, six Order bases and five Lane Hacker bases), all four route modes, mixed cargo, unknown-time opt-in, ship classes, metadata failures and stale worker replies. The live CI probe audits all NPC owners with denied ID caps and checks actual returned routes for both reputation and physical docking.
- Update the installed app with **UPDATE NOW** to load the new policy and worker together. App activation remains an explicit user action.

## Reliability update (v1.0.9)

- Changing the trade result ranking preserves and reorders the existing routes. It does not cancel an active calculation; cargo and other search-parameter changes still invalidate outdated results.
- POB telemetry is checked before it replaces a verified snapshot. Malformed base/inventory records and empty responses retain the last valid data and its original age. An invalid latest cache can fall back to the valid previous snapshot. Request timeouts cover downloading and parsing the response body.
- The known Corsair no-dock IDs use the same normalization as incoming base IDs, so their restrictions also apply when display names or system metadata are missing or changed.
- Guide search hides each nonmatching chapter together with its subsection links; clearing the search restores all contents links.
- NPC-only route searches keep their market snapshot without automatic refresh calls. When INCLUDE POBs is enabled, CALCULATE checks POB data age and refreshes it if it is at least five minutes old. Fresh live dashboard telemetry is reused; otherwise only `/api/pobs` is requested. NPC offers, docking metadata and ship-specific commodity volumes remain intact. POB stock, prices, credits and free storage have their own cached freshness timestamp. Failed refreshes retain the previous snapshot with a visible warning. FORCE MARKET UPLINK remains the manual full-market refresh.

- v1.0.6 relocates the editor to its own directly selectable Forum workspace, adds FIT/FILL, genuine zoom-out and precision move controls while preserving the unchanged 200×233 border and offline/browser-only export.

- v1.0.7 fixes the PSD-style clipping issue while keeping the original 200 × 233 output, FIT/FILL, touch drag and Forum Composer. Tests validate complete RGBA mask decoding, transparent corner pixels and Canvas portrait → mask → border composition order. App update refreshes the cached mask.

## DTR Help Guide (v1.0.8)

Slimy's DTR Help Guide is available directly from the header HELP / USER GUIDE button, next to SYSTEM and INSTALL. It opens `help/guide.html` in a separate browser tab/window and supports direct section links (`#trade-routes`, `#calculator`, `#forum`, `#avatar`, etc.). The guide provides searchable contents, responsive navigation, and 29 screenshots. Guide and screenshot files are included in the PWA's offline application shell and refresh with UPDATE NOW. The header/navigation screenshot has been refreshed from the current dashboard to include HELP, and its caption, alternative text and header description match the current controls. The remaining 28 original WebP files are unchanged from Slimy's ZIP. The main dashboard features and theme are not modified.
