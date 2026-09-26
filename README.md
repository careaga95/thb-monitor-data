# THB Monitor data

This repository publishes only public NOAA and USGS weather and earthquake data used by the THB monitor. The application source stays in a separate private repository.

The scheduled GitHub Pages deployment refreshes the snapshots approximately every 30 minutes. Its public API paths include `/api/storms.json`, `/api/earthquakes.json`, and `/api/storms/{id}/layers.json`.

The exporter preserves the last successful snapshot and its original timestamp if an upstream source is unavailable. A consumer must use `fetchedAt` to detect old data.

The exporter is copied from the private application repository; sync its NOAA/USGS parser changes here when they change. GitHub may disable scheduled workflows in public repositories after 60 days without repository activity. Check the Actions page and the published `fetchedAt` timestamp if updates stop.

To run locally with Node.js 22 or later: `npm ci`, `npm test`, and `npm run snapshot`.
