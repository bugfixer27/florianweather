# Data Sources

The dashboard uses public, no-key sources that can be loaded directly by a browser.

## Forecasts and Observations

- NWS API: `https://api.weather.gov`
- Point forecasts, hourly forecasts, alerts, nearby observation stations, and station observations.

## Radar

- RainViewer public radar tiles and frame metadata.

## Satellite

- NOAA STAR GOES-East products from `https://cdn.star.nesdis.noaa.gov`
- The satellite loop page uses official animated GIF products where frame indexes are not exposed as browser-readable JSON.

## Model Graphics

- NCEP MAG public model image products from `https://mag.ncep.noaa.gov`
- The dashboard preloads forecast-hour images for the selected model, field, and region.

## Space Weather

- NOAA SWPC products from `https://services.swpc.noaa.gov`
- Kp index, solar wind plasma/magnetic field, aurora imagery, and GOES X-ray flux JSON.

## Marine

- Buoy observations are loaded through `api.weather.gov/stations/{station}/observations`.
- Station 44065 is used as the fallback buoy because it has reliable live observations and is CORS-readable through the NOAA API.
- GFS-WAVE significant wave-height graphics are loaded from NCEP MAG.

