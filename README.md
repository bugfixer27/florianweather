# Personal Weather Dashboard

A no-backend, no-build meteorological dashboard for point forecasts, radar, satellite imagery, model graphics, space weather, and marine analysis.

Open `weather-dashboard.html` directly in a browser. No API keys, installs, build tools, or local server are required.

## What Works

- NWS point forecast, observations, hourly forecast, and alerts from `api.weather.gov`
- RainViewer radar map with live frame controls
- GOES-East satellite imagery and satellite loop pages from NOAA STAR
- NCEP MAG model graphics with preloaded forecast hours
- NOAA SWPC Kp, solar wind, aurora, and GOES X-ray flux charts
- Marine buoy observations through CORS-readable `api.weather.gov` station data
- GFS-WAVE significant wave-height graphics from NCEP MAG

## Project Layout

```text
.
├── weather-dashboard.html   # Static HTML shell and page markup
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

Most content changes live in `weather-dashboard.html`. Data behavior and controls live in `assets/app.js`. Visual polish and responsive layout live in `assets/styles.css`.

For quick testing, open:

```text
weather-dashboard.html
weather-dashboard.html?page=satslider
weather-dashboard.html?page=space
weather-dashboard.html?page=marine
```

The query-string pages are supported so individual dashboard pages can be checked directly.

## GitHub Pages

This project is ready for GitHub Pages. After pushing to GitHub, enable Pages for the repository from the `main` branch and root folder.

