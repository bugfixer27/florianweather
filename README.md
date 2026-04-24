# Personal Weather Dashboard

A no-backend, no-build meteorological dashboard for point forecasts, radar, satellite imagery, model graphics, space weather, and marine analysis.

Open `index.html` directly in a browser. No API keys, installs, build tools, or local server are required.

## What Works

- NWS point forecast, observations, hourly forecast, and alerts from `api.weather.gov`
- Official guidance desk with NWS Area Forecast Discussion text, point/grid metadata, and source links to SPC, WPC, NDFD, and NBM products
- Upper-Air Lab with a self-rendered RAOB network map, nearest radiosonde-site geodesics, launch-cycle timing, and official SPC/NOAA/NCEP sounding resources
- RainViewer radar map with live frame controls
- GOES-East satellite imagery and satellite loop pages from NOAA STAR
- NCEP MAG model graphics with preloaded forecast hours
- Model intelligence board for RRFS, HRRRCast, HAFS, HREF, and high-impact guidance context
- NOAA SWPC Kp, solar wind, aurora, and GOES X-ray flux charts
- Marine buoy observations through CORS-readable `api.weather.gov` station data
- GFS-WAVE significant wave-height graphics from NCEP MAG

## Project Layout

```text
.
├── index.html               # Static dashboard and GitHub Pages entrypoint
├── weather-dashboard.html   # Backward-compatible redirect to index.html
├── assets/
│   ├── app.js               # Dashboard logic, data loading, charts, maps
│   └── styles.css           # Visual system and responsive layout
├── docs/
│   └── DATA_SOURCES.md      # Public data feeds used by the dashboard
├── CONTRIBUTING.md          # Editing and collaboration notes
├── .gitignore
└── .nojekyll                # Keeps GitHub Pages from transforming static files
```

## Editing

Most content changes live in `index.html`. Data behavior and controls live in `assets/app.js`. Visual polish and responsive layout live in `assets/styles.css`.

For quick testing, open:

```text
index.html
index.html?page=upperair
index.html?page=satslider
index.html?page=space
index.html?page=marine
```

The query-string pages are supported so individual dashboard pages can be checked directly.

## GitHub Pages

This project is ready for GitHub Pages. After pushing to GitHub, enable Pages from GitHub Actions in the repository settings. The included workflow deploys the static site from `main` without a build step.
