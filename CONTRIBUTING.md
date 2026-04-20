# Contributing

This dashboard is intentionally static. Keep changes browser-only unless there is a strong reason to add tooling.

## Local Checks

Before committing:

- Open `weather-dashboard.html` in Chrome or Safari.
- Check the main dashboard, satellite loop, space weather, and marine pages.
- Confirm the console has no uncaught JavaScript errors.
- Prefer public NOAA/NWS feeds that allow direct browser access with CORS.

## Data Rules

- Do not add API keys, private tokens, or paid services.
- Do not fabricate unavailable weather data.
- If a public product blocks browser embedding, use a direct source link or a CORS-readable alternative.
- Keep fallback behavior visible and useful.

## Style

- Keep the first screen useful. This is a working dashboard, not a landing page.
- Keep controls compact and consistent with the existing visual system.
- Avoid adding dependencies unless they clearly improve reliability.

