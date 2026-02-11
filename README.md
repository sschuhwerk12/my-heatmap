# Asset Intelligence Workbench

A lightweight browser app that lets you enter a subject property address and quickly generate:

- Map pin + radius overlays (2, 5, 10 mile and 20-minute drive proxy)
- Demographic snapshots by radius
- Competitive properties (5-mile, ±50% SF) with clear-height/year-built filters
- Market statistics (vacancy, net absorption, asking rents)
- Distance to dynamically discovered major routes near the subject
- Auto-generated investment narrative

## Quick start (fastest way to test)

1. From this folder, start the app server:

```bash
npm start
```

2. Open the app:

- <http://localhost:4173>

3. Test with a sample input:

- Address: `7900 Westpark Dr, McLean, VA`
- Asset type: `Industrial`
- Building size: `50000`
- Min clear height: `24`
- Year built range: `1995` to `2025`

4. Click **Analyze Asset** and confirm the following render:

- Subject pin and map rings
- Demographics cards
- Competitive set table
- Market KPIs
- Route proximity list
- Investment summary paragraph

## Validation commands

Run basic checks before/after changes:

```bash
npm run check
npm run smoke
```

What each check does:

- `npm run check`: syntax-checks `app.js` with Node.
- `npm run smoke`: starts the local server, verifies the app shell loads, and verifies `Heatmap.json` is reachable and non-empty.

## Legacy run option

If you prefer Python:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Notes

- Geocoding is requested through local server proxy endpoints with browser-direct fallback (OpenStreetMap Nominatim first, Photon fallback).
- Competitive set uses local `Heatmap.json` points as candidate locations and models synthetic property attributes.
- Major-route proximity is pulled dynamically from OpenStreetMap Overpass API for each analyzed address (via local proxy with browser-direct fallback).
- Demographics + market stats are modeled placeholders and should be connected to paid data APIs for production use.
