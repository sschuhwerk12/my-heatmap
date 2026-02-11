# Asset Intelligence Workbench

A lightweight browser app that lets you enter a subject property address and quickly generate:

- Map pin + radius overlays (2, 5, 10 mile and 20-minute drive proxy)
- Demographic snapshots by radius
- Competitive properties (5-mile, ±50% SF) with clear-height/year-built filters
- Market statistics (vacancy, net absorption, asking rents)
- Distance to major interstates/routes
- Auto-generated investment narrative

## Run locally

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

## Notes

- Geocoding is live via OpenStreetMap Nominatim.
- Competitive set uses local `Heatmap.json` points as candidate locations and models synthetic property attributes.
- Demographics + market stats are modeled placeholders and should be connected to paid data APIs for production use.
