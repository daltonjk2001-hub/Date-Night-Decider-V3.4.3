# Date Night Decider V3.1.2 — remediation package

This package is a best-effort code remediation of the latest files supplied in this conversation. Existing game modes, the store, and the five seven-card expansion decks are retained.

## What changed in code

- Aligned service-worker and application asset versions; added all first-party modules and legal pages to the cache shell.
- Added deterministic modular startup (`boot.js`, `db.js`, `store.js`, `p2p.js`, `ui.js`) while keeping `app.js` as the main app engine.
- Added a persistent IndexedDB/in-memory fallback warning and accessible card-announcement region.
- Bumped the Dexie schema to v2 to add the history sync-ID index without breaking existing v1 databases.
- Switched billing flow to RevenueCat customer-info entitlements as the only unlock authority; removed browser-local “purchase” unlocks and backup-based ownership grants.
- Added explicit configured/unconfigured purchase/restore messages, restore no-purchases feedback, and current Capacitor RevenueCat response unwrapping.
- Preserved current scrapbook star ratings when reopening the completion modal; added per-entry edit and delete controls.
- Hardened import size/version/record checks and de-duplicated history IDs; excluded entitlement ownership from export.
- Expanded the clear-data path to reset current-tab state and broadcast the reset to other tabs.
- Added a swipe transition lock, keyboard arrow navigation, live-region announcements, modal focus trapping/Escape behavior, and deferred AudioContext initialization. Live sync now exchanges lightweight swipe progress and can restore host/guest progress plus active draft/winner state after reconnection when the last state messages reached the other device.
- Added responsive tablet/desktop layout rules, PWA orientation/category/icon metadata, and aligned privacy/support disclosures.
- Removed inline JavaScript event handler attributes and added a CSP meta policy. `style-src 'unsafe-inline'` remains temporarily because existing presentation-only style attributes are still used; `script-src` has no `unsafe-inline`.

## Required owner setup before production release

### 1. Vendor binaries (required for self-contained first launch offline)

This execution environment could not retrieve the pinned JS library files. The loader currently tries local files first and then falls back to pinned CDN URLs, so first launch in a fresh offline context is **not fully self-contained** until the files below are copied into `vendor/`:

- `vendor/dexie.min.js` from Dexie 3.2.4 package path `dist/dexie.min.js`
- `vendor/peerjs.min.js` from PeerJS 1.5.4 package path `dist/peerjs.min.js`

Using npm on a connected computer, run in a temporary folder:

```sh
npm pack dexie@3.2.4
mkdir dexie-temp && tar -xzf dexie-3.2.4.tgz -C dexie-temp
mkdir -p vendor
cp dexie-temp/package/dist/dexie.min.js vendor/dexie.min.js
npm pack peerjs@1.5.4
mkdir peerjs-temp && tar -xzf peerjs-1.5.4.tgz -C peerjs-temp
cp peerjs-temp/package/dist/peerjs.min.js vendor/peerjs.min.js
```

Place the two files in the `vendor/` folder alongside this project and redeploy. The service worker will then precache them as optional assets and the loader will use them locally first.

### 2. RevenueCat / iOS / Android purchases

`store.js` intentionally contains placeholder **public SDK keys**, example product IDs, and example entitlement names. They are not usable credentials. Before enabling billing:

1. Install `@revenuecat/purchases-capacitor` in the native project and run `npx cap sync`.
2. Replace the placeholder iOS (`appl_...`) and Android (`goog_...`) public SDK keys with the project-specific keys from RevenueCat.
3. Match each `PRODUCT_IDS` entry to the exact App Store Connect / Google Play product identifier.
4. Match the per-pack entitlement IDs and/or the aggregate `unlocked_expansion_packs` entitlement to RevenueCat's dashboard configuration.
5. Test purchase, cancellation, restore with purchases, restore with no purchases, reinstall, and expired/refunded entitlement flows on real store sandbox accounts.
6. Keep private API keys and secret server keys off this client code. Store SDK public keys are intended for app clients.

Until configured, the code intentionally refuses purchases and does not treat local flags or backups as ownership proof.

### 3. WebRTC production connectivity

The static package does not include a backend for `/api/get-ice-servers` or a private PeerJS signaling server. As shipped, it falls back to public STUN and public PeerJS signaling, with a warning that connections are best-effort. To harden this for production:

- Deploy a PeerJS signaling service over HTTPS/WSS and set `PEER_SIGNALING_CONFIG.host`, `port`, `path`, `secure`, and `key` in `p2p.js` to the real endpoint.
- Implement `POST /api/get-ice-servers` on a trusted backend that returns short-lived TURN credentials in `{ "iceServers": [...] }`. Never place a long-lived TURN secret in this static client bundle.
- Verify `connect-src` CSP permits only the actual signaling/API/relay hosts needed by your deployment.
- Test Wi-Fi, 5G/LTE, symmetric/restrictive NAT, airplane-mode toggles, room reconnect, and simultaneous swipe/draft actions.

### 4. Store listing assets

A simple icon asset pair is included for the manifest. Real screenshots are not fabricated; add captures from the final published build to `screenshots/` and verify the privacy/support URLs against each store listing requirement.

## Validation

The package is syntax-checked with `node --check` for all JavaScript files, JSON-validated for the manifest, and statically checked for remaining inline event attributes. This is not a substitute for browser/device QA, real store sandbox tests, or testing against an actually deployed TURN/signaling backend.
