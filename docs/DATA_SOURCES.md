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

## Model Intelligence References

- NOAA GSL Rapid Refresh Forecast System (RRFS): `https://gsl.noaa.gov/focus-areas/unified_forecast_system/rrfs`
- NOAA GSL HRRRCast experimental regional AI model updates: `https://gsl.noaa.gov/news/hrrrcast-version-3-new-release-of-noaas-experimental-regional-ai-forecast-model`
- NOAA/NCEP EMC Hurricane Analysis and Forecast System (HAFS): `https://emc.ncep.noaa.gov/hurricane/HFSA/about.php?branch=summary`
- NOAA/NCEP EMC HREF / HIRESW documentation: `https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/href-hiresw.php`

## Official Guidance Desk

- NWS Area Forecast Discussion text is fetched from `https://api.weather.gov/products/types/AFD/locations/{office}` and the latest product endpoint.
- Point/grid metadata links use the NWS `points` response, including forecast office, forecast grid data, public forecast zone, fire-weather zone, radar station, and hourly forecast endpoint.
- National center links point to official SPC convective outlooks, WPC QPF, the National Digital Forecast Database, and NOAA MDL National Blend of Models documentation.

## Upper-Air Lab

- The radiosonde station map is rendered in-browser from a curated set of operational U.S. upper-air stations.
- Distances and bearings use great-circle geometry from the currently selected dashboard point.
- SPC observed-sounding cycle maps, station Skew-T images, and raw station text files are loaded from `https://www.spc.noaa.gov/exper/soundings`.
- The local profile chart is rendered from the SPC raw sounding text: pressure, height, temperature, dew point, wind direction, and wind speed.
- Official product links include SPC observed soundings, NOAA READY observed soundings, SPC upper-air maps, SPC sounding climatology, NCEP MAG forecast soundings, SPC HREF, CPC upper-air tools, and SPC mesoanalysis documentation.

## Space Weather

- NOAA SWPC products from `https://services.swpc.noaa.gov`
- Kp index, solar wind plasma/magnetic field, aurora imagery, and GOES X-ray flux JSON.

## Marine

- Buoy observations are loaded through `api.weather.gov/stations/{station}/observations`.
- Station 44065 is used as the fallback buoy because it has reliable live observations and is CORS-readable through the NOAA API.
- GFS-WAVE significant wave-height graphics are loaded from NCEP MAG.
