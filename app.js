'use strict';

/* =========================================================
   STATE
   ========================================================= */
const state = {
    // default location: NYC
    lat: 40.7484,
    lon: -73.9857,
    placeLabel: 'New York, NY',
    nwsPoint: null,         // cached points response
    nwsStation: null,
    hourly: null,
    forecast: null,
    observations: null,
    alerts: null,

    // radar
    radarFrames: [],
    radarIdx: 0,
    radarTimer: null,
    radarLayer: null,
    radarMode: 'composite',
    warningsLayer: null,

    // satellite tab
    satTab: 'GEOCOLOR',

    // model
    modelModel: 'hrrr',
    modelField: 'refc',
    modelRegion: 'conus',
    modelHour: 6,
    modelPlayTimer: null,
    modelActiveRunKey: null,

    // meso
    mesoTab: 'pmsl',

    // chart
    meteogramChart: null,
    impactChart: null
};

/* =========================================================
   UTILITIES
   ========================================================= */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const pad = (n, w = 2) => String(n).padStart(w, '0');

function fmtTime(d, opts = {}) {
    return d.toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit',
        ...opts
    });
}
function fmtShortDate(d) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtUTC(d) {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}
function cToF(c) { return c == null ? null : c * 9/5 + 32; }
function msToMph(m) { return m == null ? null : m * 2.23693629; }
function paToInHg(p) { return p == null ? null : p / 3386.389; }
function mToMi(m)   { return m == null ? null : m / 1609.344; }

function parseWindMph(text) {
    const nums = String(text || '').match(/\d+/g);
    if (!nums) return 0;
    return Math.max(...nums.map(Number));
}

function windDirToDeg(dir) {
    const map = {
        N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
        S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5
    };
    return map[String(dir || '').toUpperCase()] ?? null;
}

function apparentTempF(tempF, rh, windMph) {
    if (tempF == null) return null;
    if (tempF <= 50 && windMph > 3) {
        return 35.74 + 0.6215 * tempF - 35.75 * Math.pow(windMph, 0.16) + 0.4275 * tempF * Math.pow(windMph, 0.16);
    }
    if (tempF >= 80 && rh != null && rh >= 40) {
        return -42.379 + 2.04901523 * tempF + 10.14333127 * rh - 0.22475541 * tempF * rh -
            0.00683783 * tempF * tempF - 0.05481717 * rh * rh +
            0.00122874 * tempF * tempF * rh + 0.00085282 * tempF * rh * rh -
            0.00000199 * tempF * tempF * rh * rh;
    }
    return tempF;
}

function shortTimeLabel(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(d);
}

/* Parse flexible location input: "lat,lon" or free text */
function parseLoc(input) {
    if (!input) return null;
    const parts = input.split(',').map(s => s.trim());
    if (parts.length === 2) {
        const la = parseFloat(parts[0]), lo = parseFloat(parts[1]);
        if (!isNaN(la) && !isNaN(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) {
            return { lat: la, lon: lo, label: `${la.toFixed(2)}, ${lo.toFixed(2)}` };
        }
    }
    return null;
}

/* Use OpenStreetMap Nominatim as a no-key geocoder */
async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || !data.length) return null;
        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            label: data[0].display_name.split(',').slice(0, 2).join(',').trim()
        };
    } catch (e) {
        console.warn('Geocode failed:', e);
        return null;
    }
}

/* Reverse geocode via api.weather.gov relativeLocation (no extra request needed) */

/* =========================================================
   CLOCK
   ========================================================= */
function tickClock() {
    const d = new Date();
    const el = document.getElementById('clock');
    if (!el) return;
    el.querySelector('.local').textContent =
        `${fmtTime(d)} ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
    el.querySelector('.utc').textContent = fmtUTC(d) + ' UTC';
}
setInterval(tickClock, 1000);
tickClock();

/* =========================================================
   NWS API (point, stations, observations, forecasts, alerts)
   ========================================================= */
const NWS_HEADERS = {
    // api.weather.gov asks for a User-Agent; browsers don't allow
    // overriding UA, but setting 'Accept' is fine. No key needed.
    'Accept': 'application/geo+json'
};

async function nwsFetch(url) {
    const res = await fetch(url, { headers: NWS_HEADERS });
    if (!res.ok) throw new Error('NWS ' + res.status + ' ' + url);
    return res.json();
}

async function loadPointForecast(lat, lon) {
    const ptsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
    const pt = await nwsFetch(ptsUrl);
    state.nwsPoint = pt;
    // label
    const rl = pt?.properties?.relativeLocation?.properties;
    if (rl) state.placeLabel = `${rl.city}, ${rl.state}`;

    // stations
    let station = null;
    try {
        const st = await nwsFetch(pt.properties.observationStations);
        station = st?.features?.[0]?.properties?.stationIdentifier;
    } catch (_) {}
    state.nwsStation = station;

    // parallel fetch: observations, hourly forecast, alerts
    const tasks = [];
    if (station) {
        tasks.push(nwsFetch(`https://api.weather.gov/stations/${station}/observations/latest`).catch(_ => null));
    } else {
        tasks.push(Promise.resolve(null));
    }
    tasks.push(nwsFetch(pt.properties.forecastHourly).catch(_ => null));
    tasks.push(nwsFetch(pt.properties.forecast).catch(_ => null));
    tasks.push(nwsFetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`).catch(_ => null));

    const [obs, hrly, fcst, alerts] = await Promise.all(tasks);
    state.observations = obs;
    state.hourly = hrly;
    state.forecast = fcst;
    state.alerts = alerts;

    renderCurrent(obs);
    renderAlerts(alerts);
    renderHourly(hrly);
    renderMeteogram(hrly);
    renderDiagnostics(hrly, alerts);
}

/* ---------- Rendering ---------- */
function renderCurrent(obs) {
    const loc = state.placeLabel || `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`;
    $('#now-loc').textContent = loc;
    $('#m-stn').textContent = state.nwsStation || '—';

    if (!obs || !obs.properties) {
        $('#now-temp').textContent = '—';
        $('#now-cond').textContent = 'No recent observation available';
        return;
    }
    const p = obs.properties;
    const tC = p.temperature?.value;
    const tF = cToF(tC);
    const dC = p.dewpoint?.value;
    const dF = cToF(dC);
    const rh = p.relativeHumidity?.value;
    const windKmh = p.windSpeed?.value;       // km/h per NWS JSON
    const gustKmh = p.windGust?.value;
    const wdir    = p.windDirection?.value;
    const prPa    = p.barometricPressure?.value;
    const visM    = p.visibility?.value;

    $('#now-temp').textContent = (tF != null) ? Math.round(tF) : '—';
    $('#now-cond').textContent = p.textDescription || '—';
    $('#m-dewpt').innerHTML = (dF != null) ? `${Math.round(dF)}<span class="u">°F</span>` : '—';
    $('#m-rh').innerHTML    = (rh != null) ? `${Math.round(rh)}<span class="u">%</span>` : '—';

    if (windKmh != null) {
        const mph = Math.round(windKmh * 0.621371);
        const dirTxt = wdir != null ? degToCompass(wdir) : '';
        $('#m-wind').innerHTML = `${dirTxt} ${mph}<span class="u">mph</span>`;
    } else $('#m-wind').textContent = '—';
    if (gustKmh != null) {
        $('#m-gust').innerHTML = `${Math.round(gustKmh * 0.621371)}<span class="u">mph</span>`;
    } else $('#m-gust').innerHTML = '<span class="dim" style="font-size:13px">calm</span>';

    if (prPa != null) {
        $('#m-pres').innerHTML = `${paToInHg(prPa).toFixed(2)}<span class="u">inHg</span>`;
    } else $('#m-pres').textContent = '—';

    if (visM != null) {
        $('#m-vis').innerHTML = `${mToMi(visM).toFixed(1)}<span class="u">mi</span>`;
    } else $('#m-vis').textContent = '—';

    // Cloud ceiling from cloudLayers (lowest broken/overcast)
    let ceil = null;
    if (Array.isArray(p.cloudLayers)) {
        for (const cl of p.cloudLayers) {
            const amt = cl.amount;
            if ((amt === 'BKN' || amt === 'OVC') && cl.base?.value != null) {
                ceil = cl.base.value;  // meters
                break;
            }
        }
    }
    if (ceil != null) {
        $('#m-ceil').innerHTML = `${Math.round(ceil * 3.28084).toLocaleString()}<span class="u">ft</span>`;
    } else $('#m-ceil').innerHTML = '<span class="dim" style="font-size:13px">CLR / —</span>';

    const ts = new Date(p.timestamp);
    $('#cond-updated').textContent = 'obs ' + fmtTime(ts) + ' (' + fmtUTC(ts) + ')';
}

function degToCompass(d) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(((d % 360) / 22.5)) % 16];
}

function renderAlerts(alerts) {
    const box = $('#alerts-list');
    box.innerHTML = '';
    const feats = alerts?.features || [];
    $('#alerts-count').textContent = `${feats.length} active`;
    if (!feats.length) {
        box.innerHTML = '<div class="alert-empty">No active NWS alerts for this point.</div>';
        return;
    }
    for (const f of feats.slice(0, 5)) {
        const p = f.properties;
        const card = document.createElement('div');
        card.className = 'alert-card fade-in';
        const sev = (p.severity || '').toUpperCase();
        const tagClass = /EXTREME|SEVERE/i.test(sev) ? 'hot' : 'warm';
        card.innerHTML = `
            <div class="hdr">
                <span>${escapeHtml(p.event)}</span>
                <span class="tag ${tagClass}">${escapeHtml(sev || p.urgency || '')}</span>
            </div>
            <div class="body">${escapeHtml((p.headline || p.areaDesc || '').slice(0, 220))}</div>
        `;
        box.appendChild(card);
    }
}

function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, ch => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
}

function renderHourly(hrly) {
    const strip = $('#hourly-strip');
    strip.innerHTML = '';
    const periods = hrly?.properties?.periods;
    if (!periods) { strip.innerHTML = '<div class="alert-empty">Hourly forecast unavailable.</div>'; return; }
    for (const p of periods.slice(0, 24)) {
        const d = new Date(p.startTime);
        const cell = document.createElement('div');
        cell.className = 'hourly-cell fade-in';
        const windDir = p.windDirection || '';
        const wind = (p.windSpeed || '').replace(/\s?mph/i, '');
        cell.innerHTML = `
            <div class="h">${pad(d.getHours())}:00</div>
            <div class="tt">${Math.round(p.temperature)}°</div>
            <div class="w">${windDir} ${wind}</div>
        `;
        strip.appendChild(cell);
    }
}

/* Meteogram via Chart.js */
function renderMeteogram(hrly) {
    const periods = hrly?.properties?.periods;
    if (!periods || !periods.length) return;

    // Use up to 72h. Pre-format labels as strings to avoid needing a time adapter.
    const data = periods.slice(0, 72);
    const labels = data.map(p => {
        const d = new Date(p.startTime);
        // Show weekday+hour at midnight/noon-ish, else just hour
        const hr = d.getHours();
        if (hr === 0 || hr === 12) {
            return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + pad(hr) + ':00';
        }
        return pad(hr) + ':00';
    });

    const T  = data.map(p => p.temperature);
    const RH = data.map(p => p.relativeHumidity?.value ?? null);
    // derive dewpoint from T and RH
    const Td = data.map((p, i) => {
        const t = p.temperature;
        const r = p.relativeHumidity?.value;
        if (t == null || r == null) return null;
        // Magnus approx. Convert F -> C -> F
        const tc = (t - 32) * 5/9;
        const a = 17.625, b = 243.04;
        const alpha = Math.log(Math.max(r, 0.0001)/100) + (a*tc)/(b+tc);
        const tdc = (b*alpha) / (a - alpha);
        return tdc * 9/5 + 32;
    });
    const POP = data.map(p => p.probabilityOfPrecipitation?.value ?? 0);
    const WS  = data.map(p => parseInt((p.windSpeed || '0').toString()) || 0);

    const canvas = $('#meteogram');
    const ctx = canvas.getContext('2d');

    if (state.meteogramChart) { state.meteogramChart.destroy(); }

    state.meteogramChart = new Chart(ctx, {
        type: 'bar',  // base type for mixed chart; per-dataset types override
        data: {
            labels,
            datasets: [
                {
                    type: 'line', label: 'Temperature (°F)', data: T,
                    borderColor: '#ff5a7a', backgroundColor: 'rgba(255,90,122,0.08)',
                    borderWidth: 2, fill: false, tension: 0.35, yAxisID: 'y', pointRadius: 0
                },
                {
                    type: 'line', label: 'Dewpoint (°F)', data: Td,
                    borderColor: '#7df0c8', backgroundColor: 'rgba(125,240,200,0.05)',
                    borderWidth: 2, fill: false, tension: 0.35, yAxisID: 'y', pointRadius: 0, borderDash: [2,2]
                },
                {
                    type: 'line', label: 'Wind (mph)', data: WS,
                    borderColor: '#b48cff', borderWidth: 1.4, fill: false,
                    tension: 0.35, yAxisID: 'y1', pointRadius: 0
                },
                {
                    type: 'bar', label: 'PoP (%)', data: POP,
                    backgroundColor: 'rgba(94,184,255,0.35)', borderColor: 'rgba(94,184,255,0.7)',
                    borderWidth: 1, yAxisID: 'y2', barPercentage: 1.0, categoryPercentage: 1.0
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { labels: { color: '#9aa7bd', font: { family: 'JetBrains Mono, monospace', size: 10 } } },
                tooltip: {
                    backgroundColor: 'rgba(10,15,26,0.95)',
                    borderColor: 'rgba(120,180,255,0.3)', borderWidth: 1,
                    titleColor: '#e6edf7', bodyColor: '#9aa7bd'
                }
            },
            scales: {
                x: {
                    // category axis with pre-formatted labels — no time adapter needed
                    ticks: {
                        color: '#6b7a93',
                        maxRotation: 0,
                        autoSkip: true,
                        autoSkipPadding: 24,
                        font: { size: 10, family: 'JetBrains Mono, monospace' },
                        callback: function(val, idx) {
                            const lbl = this.getLabelForValue(val);
                            // Emphasize day boundaries, skip others by default via autoSkip
                            return lbl;
                        }
                    },
                    grid: { color: 'rgba(120,150,200,0.08)' }
                },
                y: {
                    position: 'left',
                    ticks: { color: '#9aa7bd', font: { size: 10 } },
                    grid: { color: 'rgba(120,150,200,0.08)' },
                    title: { display: true, text: '°F', color: '#9aa7bd', font: { size: 10 } }
                },
                y1: {
                    position: 'right',
                    ticks: { color: '#b48cff', font: { size: 10 } },
                    grid: { display: false },
                    title: { display: true, text: 'mph', color: '#b48cff', font: { size: 10 } }
                },
                y2: {
                    position: 'right', offset: true, min: 0, max: 100,
                    display: false
                }
            }
        }
    });
}

/* NOTE: Chart.js time scale removed in favor of a category axis with
   pre-formatted string labels. This avoids the date-fns adapter requirement
   while still producing a clean meteogram. */

/* =========================================================
   LOCAL FORECAST DIAGNOSTICS
   ========================================================= */
function periodDiagnostics(periods) {
    return periods.map(p => {
        const wind = parseWindMph(p.windSpeed);
        const rh = p.relativeHumidity?.value ?? null;
        const temp = p.temperature ?? null;
        const pop = p.probabilityOfPrecipitation?.value ?? 0;
        const wx = p.shortForecast || '';
        const apparent = apparentTempF(temp, rh, wind);
        const thunder = /thunder|t-storm|storm/i.test(wx);
        const winter = /snow|sleet|freezing|ice/i.test(wx);
        const fog = /fog|mist/i.test(wx);
        const rain = /rain|showers|drizzle/i.test(wx);
        const impact = Math.min(100, Math.round(
            pop * 0.34 +
            wind * 1.18 +
            Math.max(0, (apparent ?? temp ?? 60) - 88) * 1.5 +
            Math.max(0, 25 - (apparent ?? temp ?? 60)) * 1.2 +
            (thunder ? 18 : 0) +
            (winter ? 16 : 0) +
            (fog ? 8 : 0)
        ));
        return {
            raw: p,
            start: new Date(p.startTime),
            temp,
            rh,
            pop,
            wind,
            windDir: p.windDirection || '',
            windDeg: windDirToDeg(p.windDirection),
            wx,
            apparent,
            impact,
            thunder,
            winter,
            fog,
            rain
        };
    });
}

function maxBy(arr, fn) {
    return arr.reduce((best, item) => best == null || fn(item) > fn(best) ? item : best, null);
}

function minBy(arr, fn) {
    return arr.reduce((best, item) => best == null || fn(item) < fn(best) ? item : best, null);
}

function diagClass(value, warm, hot) {
    if (value >= hot) return 'hot';
    if (value >= warm) return 'warm';
    return '';
}

function renderDiagnostics(hrly, alerts) {
    const periods = hrly?.properties?.periods;
    const cards = $('#diagnostic-cards');
    const matrix = $('#weather-matrix');
    const story = $('#forecast-story');
    if (!cards || !matrix || !story) return;

    if (!periods || !periods.length) {
        cards.innerHTML = '<div class="alert-empty" style="grid-column:1/-1">NWS hourly diagnostics unavailable for this point.</div>';
        matrix.innerHTML = '<div class="alert-empty">Forecast matrix unavailable.</div>';
        story.innerHTML = '<div class="alert-empty">Forecast story unavailable.</div>';
        return;
    }

    const data = periodDiagnostics(periods.slice(0, 72));
    const win48 = data.slice(0, 48);
    const peakWind = maxBy(win48, x => x.wind);
    const peakPop = maxBy(win48, x => x.pop);
    const highTemp = maxBy(win48, x => x.temp ?? -999);
    const lowTemp = minBy(win48, x => x.temp ?? 999);
    const lowRh = minBy(win48.filter(x => x.rh != null), x => x.rh);
    const highImpact = maxBy(win48, x => x.impact);
    const coldFeel = minBy(win48, x => x.apparent ?? x.temp ?? 999);
    const hotFeel = maxBy(win48, x => x.apparent ?? x.temp ?? -999);
    const alertCount = alerts?.features?.length || 0;
    const signalParts = [];
    if (alertCount) signalParts.push(`${alertCount} alert${alertCount === 1 ? '' : 's'}`);
    if (win48.some(x => x.thunder)) signalParts.push('thunder');
    if (win48.some(x => x.winter)) signalParts.push('winter precip');
    if (win48.some(x => x.fog)) signalParts.push('fog');
    if (!signalParts.length) signalParts.push('quiet');

    cards.innerHTML = [
        diagCard('Peak Wind', `${peakWind.wind} mph`, shortTimeLabel(peakWind.raw.startTime), diagClass(peakWind.wind, 25, 40)),
        diagCard('Peak Precip', `${peakPop.pop}%`, shortTimeLabel(peakPop.raw.startTime), diagClass(peakPop.pop, 55, 80)),
        diagCard('Temp Range', `${Math.round(lowTemp.temp)}-${Math.round(highTemp.temp)}°`, `${shortTimeLabel(lowTemp.raw.startTime)} low`, (lowTemp.temp <= 32 || highTemp.temp >= 90) ? 'warm' : ''),
        diagCard('Lowest RH', lowRh ? `${Math.round(lowRh.rh)}%` : '-', lowRh ? shortTimeLabel(lowRh.raw.startTime) : 'not available', lowRh && lowRh.rh <= 25 ? 'warm' : ''),
        diagCard('Feels Like', `${Math.round(coldFeel.apparent ?? coldFeel.temp)}-${Math.round(hotFeel.apparent ?? hotFeel.temp)}°`, 'apparent temperature range', ((hotFeel.apparent ?? hotFeel.temp) >= 95 || (coldFeel.apparent ?? coldFeel.temp) <= 20) ? 'hot' : 'cool'),
        diagCard('Signals', signalParts.join(' / '), `max impact ${highImpact.impact} at ${fmtTime(highImpact.start)}`, highImpact.impact >= 65 ? 'hot' : highImpact.impact >= 40 ? 'warm' : 'cool', true)
    ].join('');

    renderImpactChart(win48);
    renderWindRose(win48);
    renderWeatherMatrix(win48);
    renderForecastStory(win48, alerts);
    $('#diag-updated').textContent = 'updated ' + fmtTime(new Date());
}

function diagCard(label, value, sub, cls = '', small = false) {
    return `<div class="diagnostic-card ${cls}">
        <div class="k">${escapeHtml(label)}</div>
        <div class="v ${small ? 'small' : ''}">${escapeHtml(value)}</div>
        <div class="sub">${escapeHtml(sub)}</div>
    </div>`;
}

function renderImpactChart(data) {
    const canvas = $('#impact-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = data.map((x, i) => {
        if (i % 6 !== 0) return '';
        return x.start.toLocaleDateString([], { weekday: 'short' }) + ' ' + pad(x.start.getHours()) + ':00';
    });
    if (state.impactChart) state.impactChart.destroy();
    state.impactChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'line',
                    label: 'Impact',
                    data: data.map(x => x.impact),
                    borderColor: '#ffb454',
                    backgroundColor: 'rgba(255,180,84,0.12)',
                    yAxisID: 'y',
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true
                },
                {
                    type: 'line',
                    label: 'Feels like',
                    data: data.map(x => Math.round(x.apparent ?? x.temp ?? 0)),
                    borderColor: '#5eb8ff',
                    yAxisID: 'y1',
                    pointRadius: 0,
                    borderWidth: 1.6,
                    tension: 0.35
                },
                {
                    type: 'bar',
                    label: 'PoP',
                    data: data.map(x => x.pop),
                    backgroundColor: 'rgba(125,240,200,0.24)',
                    borderColor: 'rgba(125,240,200,0.5)',
                    borderWidth: 1,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { labels: { color: '#9aa7bd', font: { family: 'JetBrains Mono, monospace', size: 10 } } },
                tooltip: {
                    backgroundColor: 'rgba(10,15,26,0.95)',
                    borderColor: 'rgba(120,180,255,0.3)',
                    borderWidth: 1,
                    titleColor: '#e6edf7',
                    bodyColor: '#9aa7bd'
                }
            },
            scales: {
                x: {
                    ticks: { color: '#6b7a93', maxRotation: 0, autoSkip: true, font: { size: 10, family: 'JetBrains Mono, monospace' } },
                    grid: { color: 'rgba(120,150,200,0.08)' }
                },
                y: {
                    min: 0,
                    max: 100,
                    ticks: { color: '#9aa7bd', font: { size: 10 } },
                    grid: { color: 'rgba(120,150,200,0.08)' },
                    title: { display: true, text: 'index / %', color: '#9aa7bd', font: { size: 10 } }
                },
                y1: {
                    position: 'right',
                    ticks: { color: '#5eb8ff', font: { size: 10 } },
                    grid: { display: false },
                    title: { display: true, text: '°F', color: '#5eb8ff', font: { size: 10 } }
                }
            }
        }
    });
}

function renderWindRose(data) {
    const canvas = $('#wind-rose');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(280, Math.round(rect.width * dpr));
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = canvas.width / dpr;
    const cx = size / 2;
    const cy = size / 2;
    const maxR = size * 0.39;
    const sectors = Array.from({ length: 16 }, () => ({ count: 0, speed: 0 }));
    data.forEach(x => {
        if (x.windDeg == null) return;
        const idx = Math.round(x.windDeg / 22.5) % 16;
        sectors[idx].count += 1;
        sectors[idx].speed += x.wind;
    });
    const maxScore = Math.max(1, ...sectors.map(s => s.count ? s.speed / s.count * Math.sqrt(s.count) : 0));
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(120,150,200,0.16)';
    ctx.lineWidth = 1;
    for (let r = 0.25; r <= 1; r += 0.25) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * r, 0, Math.PI * 2);
        ctx.stroke();
    }
    const labels = ['N', 'E', 'S', 'W'];
    labels.forEach((label, i) => {
        const angle = (i * 90 - 90) * Math.PI / 180;
        ctx.fillStyle = '#6b7a93';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx + Math.cos(angle) * (maxR + 18), cy + Math.sin(angle) * (maxR + 18));
    });
    sectors.forEach((s, i) => {
        const angle = (i * 22.5 - 90) * Math.PI / 180;
        const score = s.count ? s.speed / s.count * Math.sqrt(s.count) : 0;
        const len = maxR * (score / maxScore);
        const avg = s.count ? s.speed / s.count : 0;
        ctx.strokeStyle = avg >= 25 ? '#ffb454' : '#5eb8ff';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        ctx.stroke();
    });
    ctx.fillStyle = 'rgba(5,7,13,0.92)';
    ctx.strokeStyle = 'rgba(120,180,255,0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const peak = maxBy(data, x => x.wind);
    ctx.fillStyle = '#e6edf7';
    ctx.font = '18px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${peak?.wind ?? 0}`, cx, cy - 3);
    ctx.fillStyle = '#6b7a93';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText('peak mph', cx, cy + 14);
}

function renderWeatherMatrix(data) {
    const box = $('#weather-matrix');
    if (!box) return;
    box.innerHTML = data.map(x => {
        const cls = x.wind >= 30 ? 'wind' : x.pop >= 55 ? 'pop' : x.temp >= 90 ? 'hot' : x.temp <= 32 ? 'cold' : '';
        const wx = x.thunder ? 't-storm' : x.winter ? 'winter' : x.rain ? 'rain' : x.fog ? 'fog' : x.wx.split(' ').slice(0, 2).join(' ');
        return `<div class="matrix-cell ${cls}" title="${escapeHtml(x.wx)}">
            <div class="tm">${pad(x.start.getHours())}:00</div>
            <div class="temp">${Math.round(x.temp)}°</div>
            <div class="wx">${escapeHtml(wx || 'quiet')}</div>
            <div class="pop">${x.pop}% / ${x.wind}mph</div>
        </div>`;
    }).join('');
}

function renderForecastStory(data, alerts) {
    const box = $('#forecast-story');
    if (!box) return;
    const peakWind = maxBy(data, x => x.wind);
    const peakPop = maxBy(data, x => x.pop);
    const highImpact = maxBy(data, x => x.impact);
    const lines = [];
    const activeAlerts = alerts?.features || [];
    if (activeAlerts.length) {
        lines.push({ k: 'Active hazards', v: activeAlerts.slice(0, 2).map(a => a.properties?.event).filter(Boolean).join(' / '), cls: 'hot' });
    }
    lines.push({ k: 'Highest impact window', v: `${shortTimeLabel(highImpact.raw.startTime)} with index ${highImpact.impact}: ${highImpact.wx}.`, cls: highImpact.impact >= 65 ? 'hot' : highImpact.impact >= 40 ? 'warm' : 'cool' });
    lines.push({ k: 'Wind focus', v: `${peakWind.wind} mph near ${shortTimeLabel(peakWind.raw.startTime)} from ${peakWind.windDir || 'variable'}.`, cls: peakWind.wind >= 30 ? 'warm' : '' });
    lines.push({ k: 'Precipitation focus', v: `${peakPop.pop}% near ${shortTimeLabel(peakPop.raw.startTime)}: ${peakPop.wx}.`, cls: peakPop.pop >= 60 ? 'cool' : '' });
    const thunder = data.find(x => x.thunder);
    const winter = data.find(x => x.winter);
    if (thunder) lines.push({ k: 'Convective signal', v: `Thunder appears in the hourly forecast around ${shortTimeLabel(thunder.raw.startTime)}.`, cls: 'warm' });
    if (winter) lines.push({ k: 'Winter signal', v: `Frozen or freezing precipitation appears around ${shortTimeLabel(winter.raw.startTime)}.`, cls: 'cool' });
    box.innerHTML = lines.slice(0, 5).map(line => `<div class="story-item ${line.cls || ''}">
        <strong>${escapeHtml(line.k)}</strong>${escapeHtml(line.v)}
    </div>`).join('');
    $('#story-window').textContent = `${fmtShortDate(data[0].start)}-${fmtShortDate(data[data.length - 1].start)}`;
}

/* =========================================================
   RADAR (Leaflet + RainViewer)
   ========================================================= */
let radarMap = null;

function initRadarMap() {
    radarMap = L.map('radar-map', {
        center: [state.lat, state.lon],
        zoom: 6,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true
    });

    // Dark basemap (CartoDB Dark Matter — free tiles, attribution required)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(radarMap);

    // A clean label overlay
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 18, pane: 'shadowPane', opacity: 0.9
    }).addTo(radarMap);

    // Warnings overlay (IEM WMS — NWS watches/warnings)
    state.warningsLayer = L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/us/wwa.cgi', {
        layers: 'warnings_p',
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: 'NWS watches/warnings &mdash; IEM'
    }).addTo(radarMap);

    // marker for user point
    state.locMarker = L.circleMarker([state.lat, state.lon], {
        radius: 7, color: '#5eb8ff', weight: 2,
        fillColor: '#5eb8ff', fillOpacity: 0.35
    }).addTo(radarMap);

    loadRainViewer();
}

async function loadRainViewer() {
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        const framesRadar = data?.radar?.past || [];
        const framesNowcast = data?.radar?.nowcast || [];
        const framesClouds = data?.satellite?.infrared || [];
        state.radarFramesPast = framesRadar.concat(framesNowcast);
        state.radarFramesClouds = framesClouds;
        state.rvHost = data.host || 'https://tilecache.rainviewer.com';
        setRadarMode(state.radarMode);
    } catch (e) {
        console.warn('RainViewer failed', e);
        $('#radar-frame-time').textContent = 'RainViewer unavailable';
    }
}

function setRadarMode(mode) {
    state.radarMode = mode;
    $$('.tab[data-radar-mode]').forEach(t => t.classList.toggle('active', t.dataset.radarMode === mode));
    const frames = mode === 'clouds' ? state.radarFramesClouds : state.radarFramesPast;
    if (!frames || !frames.length) return;
    state.radarFrames = frames;
    state.radarIdx = frames.length - 1;
    showRadarFrame();
}

function showRadarFrame() {
    const f = state.radarFrames[state.radarIdx];
    if (!f) return;
    const host = state.rvHost;
    const kind = state.radarMode === 'clouds' ? 'satellite' : 'radar';
    // tiles/{size}/{z}/{x}/{y}/{color}/{options}.png
    // color: 2 = classic NEXRAD for radar; 0 for satellite
    const color = state.radarMode === 'clouds' ? 0 : 2;
    const opts  = state.radarMode === 'clouds' ? '0_0' : '1_1';
    const url = `${host}${f.path}/256/{z}/{x}/{y}/${color}/${opts}.png`;

    if (state.radarLayer) radarMap.removeLayer(state.radarLayer);
    state.radarLayer = L.tileLayer(url, {
        opacity: state.radarMode === 'clouds' ? 0.75 : 0.85,
        attribution: 'RainViewer &bull; NOAA / NWS radar composite'
    }).addTo(radarMap);

    const d = new Date(f.time * 1000);
    $('#radar-frame-time').textContent = fmtTime(d) + ' (' + fmtUTC(d) + ')';
    $('#radar-ts').textContent = 'latest ' + fmtUTC(new Date(state.radarFrames[state.radarFrames.length-1].time*1000));
}

function playRadar(on) {
    if (on) {
        $('#radar-play').innerHTML = '&#10074;&#10074; Pause';
        state.radarTimer = setInterval(() => {
            state.radarIdx = (state.radarIdx + 1) % state.radarFrames.length;
            showRadarFrame();
        }, 600);
    } else {
        $('#radar-play').innerHTML = '&#9654; Play';
        clearInterval(state.radarTimer); state.radarTimer = null;
    }
}

/* =========================================================
   SATELLITE PANELS (RAMMB / CIRA SLIDER)
   ========================================================= */
const SAT_TABS = {
    'GEOCOLOR': {
        title: 'GOES-16 GeoColor — CONUS',
        desc: 'Daytime true-color + nighttime IR blend. Quick contextual scan.',
        url:  'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/GEOCOLOR/1250x750.jpg',
        sectors: [
            { t:'Northeast', sub:'Mid-latitude cyclones, coastal storms, lake-effect.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/ne/GEOCOLOR/1200x1200.jpg'},
            { t:'Southern Plains', sub:'Convective initiation along drylines and warm fronts.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/sp/GEOCOLOR/1200x1200.jpg'},
            { t:'Gulf of Mexico', sub:'Tropical systems, Gulf low-level jets, return flow.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/gm/GEOCOLOR/1200x1200.jpg'}
        ]
    },
    '13': {
        title: 'Clean Longwave IR (Band 13, 10.3 µm)',
        desc: 'Cloud-top temperatures. Cold tops (< −60 °C) = deep convection. Night-capable.',
        url:  'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/13/1250x750.jpg',
        sectors: [
            { t:'NE Band 13', sub:'Enhanced cloud-top detail for extratropical systems.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/ne/13/1200x1200.jpg'},
            { t:'SP Band 13', sub:'Severe thunderstorm cold-top evolution.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/sp/13/1200x1200.jpg'},
            { t:'Tropical Atlantic', sub:'TC cold-ring / eyewall monitoring.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/taw/13/1200x1200.jpg'}
        ]
    },
    '08': {
        title: 'Upper Water Vapor (Band 8, 6.2 µm)',
        desc: 'Mid/upper tropospheric moisture. Dry slots, jet streaks, trough/ridge pattern.',
        url:  'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/08/1250x750.jpg',
        sectors: [
            { t:'NE Water Vapor', sub:'Upper-level jet dynamics over the eastern US.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/ne/08/1200x1200.jpg'},
            { t:'Pacific NW', sub:'Atmospheric rivers, cyclogenesis offshore.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/pnw/08/1200x1200.jpg'},
            { t:'Full Disk', sub:'Planetary-scale wave pattern.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/08/1808x1808.jpg'}
        ]
    },
    'AirMass': {
        title: 'Air Mass RGB',
        desc: 'Distinguishes stratospheric intrusions, dry slots, and tropical air. Cyclogenesis tool.',
        url:  'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/AirMass/1250x750.jpg',
        sectors: [
            { t:'NE Air Mass', sub:'Rapid cyclogenesis red-signature tracking.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/ne/AirMass/1200x1200.jpg'},
            { t:'Tropical Atl Air Mass', sub:'TC environment dry-air entrainment.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/taw/AirMass/1200x1200.jpg'},
            { t:'Full Disk Air Mass', sub:'Synoptic air-mass identification.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/AirMass/1808x1808.jpg'}
        ]
    },
    'DayCloudPhase': {
        title: 'Day Cloud Phase Distinction RGB',
        desc: 'Ice vs. supercooled water clouds. Glaciated anvils show vivid green.',
        url:  'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/CONUS/DayCloudPhase/1250x750.jpg',
        sectors: [
            { t:'NE Cloud Phase', sub:'Winter storm glaciation over the NE.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/ne/DayCloudPhase/1200x1200.jpg'},
            { t:'SP Cloud Phase', sub:'Supercell anvil glaciation signature.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/sp/DayCloudPhase/1200x1200.jpg'},
            { t:'PNW Cloud Phase', sub:'Pacific NW winter storm diagnosis.', url:'https://cdn.star.nesdis.noaa.gov/GOES16/ABI/SECTOR/pnw/DayCloudPhase/1200x1200.jpg'}
        ]
    }
};

function renderSatellite() {
    const grid = $('#sat-grid');
    grid.innerHTML = '';
    const cfg = SAT_TABS[state.satTab];
    if (!cfg) return;

    // Primary CONUS card
    grid.appendChild(buildSatCard(cfg.title, cfg.desc, cfg.url, 'GOES-16 ABI &bull; STAR NESDIS', true));

    // Sector cards
    for (const s of cfg.sectors) {
        grid.appendChild(buildSatCard(s.t, s.sub, s.url, 'STAR NESDIS'));
    }

    $('#sat-updated').textContent = 'refreshed ' + fmtTime(new Date());
}

function buildSatCard(title, desc, url, source, primary = false) {
    const bust = '?_=' + Math.floor(Date.now() / (5 * 60 * 1000)); // 5-min cache bust
    const card = document.createElement('div');
    card.className = 'sat-card fade-in';
    card.innerHTML = `
        <div class="sat-img-wrap loading">
            <img alt="${escapeHtml(title)}" loading="lazy" />
        </div>
        <div class="info">
            <h4>${escapeHtml(title)} ${primary ? '<span class="tag cool">primary</span>' : ''}</h4>
            <p>${escapeHtml(desc)}</p>
            <span class="src">${source} &bull; <a href="${url}" target="_blank" rel="noopener">open full resolution</a></span>
        </div>
    `;
    const img = card.querySelector('img');
    img.onload = () => card.querySelector('.sat-img-wrap').classList.remove('loading');
    img.onerror = () => {
        const wrap = card.querySelector('.sat-img-wrap');
        wrap.classList.remove('loading');
        wrap.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:var(--text-dim);font-size:12px;text-align:center;padding:20px;">
            Image temporarily unavailable.<br/><a href="${url}" target="_blank" rel="noopener" style="color:var(--accent)">Open source</a>
        </div>`;
    };
    img.src = url + bust;
    return card;
}

/* =========================================================
   MESOANALYSIS (SPC experimental graphics)
   Source: https://www.spc.noaa.gov/exper/mesoanalysis/new/
   Each sector/graphic is an IMG. We load the CONUS version.
   ========================================================= */
const MESO_IMGS = {
    pmsl: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=pmsl', title: 'MSLP + Sfc Wind' },
    sbcp: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=sbcp', title: 'SB CAPE / CIN' },
    mlcp: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=mlcp', title: 'ML CAPE / CIN' },
    mucp: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=mucp', title: 'MU CAPE / CIN' },
    eshr: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=eshr', title: 'Effective Bulk Shear' },
    srh3: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=srh3', title: '0-3 km SRH' },
    stor: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=stor', title: 'Significant Tornado Param.' },
    lr75: { url: 'https://www.spc.noaa.gov/exper/mesoanalysis/new/viewsector.php?sector=19&parm=lr75', title: '700-500 mb Lapse Rate' }
};

function renderMeso() {
    const view = $('#meso-view');
    const cfg = MESO_IMGS[state.mesoTab];
    if (!cfg) return;
    view.innerHTML = `<div class="placeholder">loading ${cfg.title}…</div>`;

    // SPC viewsector.php returns HTML; they also expose plain images. To avoid
    // framing issues, we use their actual image endpoint via the known URL pattern.
    // The canonical image URL pattern for SPC mesoanalysis is:
    //   https://www.spc.noaa.gov/exper/mesoanalysis/s<sector>/<parm>/<parm>.gif
    // Sector 19 = CONUS.
    const imgUrl = `https://www.spc.noaa.gov/exper/mesoanalysis/s19/${state.mesoTab}/${state.mesoTab}.gif`;
    const img = new Image();
    img.alt = cfg.title;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '560px';
    img.onload = () => {
        view.innerHTML = '';
        view.appendChild(img);
        const a = document.createElement('a');
        a.className = 'open-src';
        a.target = '_blank';
        a.rel = 'noopener';
        a.href = 'https://www.spc.noaa.gov/exper/mesoanalysis/';
        a.textContent = 'open SPC →';
        view.appendChild(a);
    };
    img.onerror = () => {
        view.innerHTML = `<div class="placeholder">
            SPC mesoanalysis image temporarily unavailable.<br/>
            <a href="https://www.spc.noaa.gov/exper/mesoanalysis/" target="_blank" rel="noopener" style="color:var(--accent)">Open SPC mesoanalysis &rarr;</a>
        </div>`;
    };
    img.src = imgUrl + '?_=' + Math.floor(Date.now() / (5 * 60 * 1000));
}

/* =========================================================
   MODEL WALL (NOAA/NCEP MAG static images)
   MAG images are public GIF files and do not require API keys.
   The newest run is not always published, so renderModel tries
   recent cycles until an image actually loads.
   ========================================================= */
const MAG_BASE = 'https://mag.ncep.noaa.gov';

const MODEL_META = {
    hrrr: {
        name: 'HRRR',
        magModel: 'hrrr',
        viewerModel: 'HRRR',
        maxHour: 48,
        step: 1,
        cycleStep: 1,
        cycleLag: 1,
        fhrMinutes: true,
        pathStyle: 'flat',
        areas: { conus: 'conus', ne: 'us-ne', se: 'us-se', sp: 'us-sc', nw: 'us-nw', np: 'us-nc' }
    },
    nam3km: {
        name: 'NAM-3km',
        magModel: 'nam-hires',
        viewerModel: 'NAM-HIRES',
        maxHour: 60,
        step: 1,
        cycleStep: 6,
        cycleLag: 2,
        fhrMinutes: false,
        pathStyle: 'flat',
        areas: { conus: 'conus', ne: 'us-ne', se: 'us-se', sp: 'us-sc', nw: 'us-nw', np: 'us-nc' }
    },
    nam: {
        name: 'NAM-12km',
        magModel: 'nam',
        viewerModel: 'NAM',
        maxHour: 84,
        step: 3,
        cycleStep: 6,
        cycleLag: 2,
        fhrMinutes: false,
        pathStyle: 'flat',
        areas: { conus: 'conus', ne: 'conus', se: 'conus', sp: 'conus', nw: 'conus', np: 'conus' }
    },
    rap: {
        name: 'RAP',
        magModel: 'rap',
        viewerModel: 'RAP',
        maxHour: 21,
        step: 1,
        cycleStep: 1,
        cycleLag: 2,
        fhrMinutes: false,
        pathStyle: 'flat',
        areas: { conus: 'conus', ne: 'conus', se: 'conus', sp: 'conus', nw: 'conus', np: 'conus' }
    },
    gfs: {
        name: 'GFS',
        magModel: 'gfs',
        viewerModel: 'GFS',
        maxHour: 240,
        step: 3,
        cycleStep: 6,
        cycleLag: 2,
        fhrMinutes: false,
        pathStyle: 'nested',
        areas: { conus: 'conus', ne: 'conus', se: 'conus', sp: 'conus', nw: 'conus', np: 'conus' }
    }
};

const FIELD_META = {
    refc:      { name: 'Comp. Reflectivity', param: 'sim_radar_comp', byModel: { nam: 'sim_radar_1km' } },
    ptype:     { name: 'Precip Type / Rate',  param: 'precip_rate_type' },
    mslp_pcpn: { name: 'MSLP / Precip',       param: '1000_500_thick' },
    '500h':    { name: '500 mb Hgt / Vort',   param: '500_vort_ht' },
    '850t':    { name: '850 mb T / Wind',     param: '850_temp_ht' },
    cape:      { name: 'CAPE / Convective',   param: 'sfc_cape_cin', byModel: { rap: 'cape_cin', gfs: 'sim_radar_comp' } },
    snowfall:  { name: 'Snow / Snow Depth',   param: 'snow_total', byModel: { nam3km: 'snodpth_chng', nam: 'snodpth_chng', gfs: 'snodpth_chng' } }
};

const MODEL_REGION_LABELS = {
    conus: 'CONUS',
    'us-ne': 'Northeast',
    'us-se': 'Southeast',
    'us-sc': 'South Central',
    'us-nw': 'Northwest',
    'us-nc': 'North Central'
};

function modelParam(meta, field) {
    return field.byModel?.[state.modelModel] || field.param;
}

function modelArea(meta) {
    return meta.areas[state.modelRegion] || meta.areas.conus || 'conus';
}

function modelFhr(meta, hour) {
    const rounded = Math.max(0, Math.min(meta.maxHour, Math.round(hour / meta.step) * meta.step));
    return meta.fhrMinutes ? `${pad(rounded, 3)}00` : pad(rounded, 3);
}

function modelCycleCandidates(meta) {
    const now = new Date();
    const step = meta.cycleStep || 1;
    const laggedHour = (now.getUTCHours() - (meta.cycleLag || 0) + 24) % 24;
    const latestLikely = Math.floor(laggedHour / step) * step;
    const count = step === 6 ? 8 : 24;
    const cycles = [];
    for (let i = 0; i < count; i++) {
        cycles.push(pad((latestLikely - i * step + 2400) % 24));
    }
    return [...new Set(cycles)];
}

function modelImgUrl(meta, area, param, cycle, hour) {
    const fhr = modelFhr(meta, hour);
    if (meta.pathStyle === 'nested') {
        return `${MAG_BASE}/data/${meta.magModel}/${cycle}/${area}/${param}/${meta.magModel}_${area}_${fhr}_${param}.gif`;
    }
    return `${MAG_BASE}/data/${meta.magModel}/${cycle}/${meta.magModel}_${area}_${fhr}_${param}.gif`;
}

function modelViewerLink(meta, area, param) {
    const params = new URLSearchParams({
        group: 'Model Guidance',
        model: meta.viewerModel,
        area: area.toUpperCase(),
        param,
        ps: 'area'
    });
    return `${MAG_BASE}/model-guidance-model-parameter.php?${params.toString()}`;
}

function buildModelCandidates(meta, field) {
    const area = modelArea(meta);
    const param = modelParam(meta, field);
    return modelCycleCandidates(meta).map(cycle => ({
        url: modelImgUrl(meta, area, param, cycle, state.modelHour),
        cycle,
        area,
        param
    }));
}

let modelRenderToken = 0;
let modelPreloadToken = 0;
const modelImageCache = new Map();
const modelRunCache = new Map();

function modelCacheBucket() {
    return Math.floor(Date.now() / (5 * 60 * 1000));
}

function modelCacheKey(url) {
    return `${url}?_=${modelCacheBucket()}`;
}

function modelRunKey(model, field, area, param, cycle) {
    return `${model}|${field}|${area}|${param}|${cycle}|${modelCacheBucket()}`;
}

function modelHourValues(meta) {
    const hours = [];
    for (let h = 0; h <= meta.maxHour; h += meta.step) hours.push(h);
    return hours;
}

function loadModelImage(url) {
    const src = modelCacheKey(url);
    let rec = modelImageCache.get(src);
    if (rec) return rec.promise;

    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    rec = {
        src,
        status: 'loading',
        img,
        promise: new Promise((resolve, reject) => {
            img.onload = () => {
                rec.status = 'loaded';
                resolve(rec);
            };
            img.onerror = () => {
                rec.status = 'error';
                reject(new Error('model image unavailable'));
            };
        })
    };
    modelImageCache.set(src, rec);
    img.src = src;
    return rec.promise;
}

function cachedModelRecord(url) {
    const rec = modelImageCache.get(modelCacheKey(url));
    return rec?.status === 'loaded' ? rec : null;
}

function displayModelImage(view, rec, meta, field, loaded, hour) {
    const regionLabel = MODEL_REGION_LABELS[loaded.area] || loaded.area.toUpperCase();
    const img = new Image();
    img.decoding = 'async';
    img.alt = `${meta.name} ${field.name} ${regionLabel} F${hour}`;
    img.src = rec.src;
    view.innerHTML = '';
    view.appendChild(img);
    const a = document.createElement('a');
    a.className = 'open-src';
    a.target = '_blank';
    a.rel = 'noopener';
    a.href = loaded.url;
    a.textContent = `MAG ${loaded.cycle}Z →`;
    view.appendChild(a);
}

function loadFirstModelImage(candidates, token, onLoad, onFail) {
    let idx = 0;
    const tryNext = () => {
        if (token !== modelRenderToken) return;
        const candidate = candidates[idx++];
        if (!candidate) {
            onFail();
            return;
        }
        loadModelImage(candidate.url).then(rec => {
            if (token !== modelRenderToken) return;
            onLoad(rec, candidate);
        }).catch(tryNext);
    };
    tryNext();
}

function updateModelPreloadStatus(run, text) {
    const status = $('#model-preload-status');
    const count = $('#model-preload-count');
    const bar = $('#model-preload-bar');
    if (!status || !count || !bar) return;
    if (!run) {
        status.textContent = text || 'preload waiting for model run';
        count.textContent = '0 / 0';
        bar.style.width = '0%';
        return;
    }
    const done = run.loaded + run.failed;
    const pct = run.total ? Math.round((done / run.total) * 100) : 0;
    status.textContent = text || `${run.modelName} ${run.fieldName} ${run.regionLabel} ${run.cycle}Z preloading`;
    count.textContent = `${run.loaded} / ${run.total}`;
    bar.style.width = `${pct}%`;
}

function invalidateModelPreload(text) {
    modelPreloadToken += 1;
    state.modelActiveRunKey = null;
    updateModelPreloadStatus(null, text);
}

function startModelPreload(meta, field, loaded) {
    const token = ++modelPreloadToken;
    const hours = modelHourValues(meta);
    const key = modelRunKey(state.modelModel, state.modelField, loaded.area, loaded.param, loaded.cycle);
    let run = modelRunCache.get(key);
    if (!run) {
        run = {
            key,
            modelName: meta.name,
            fieldName: field.name,
            regionLabel: MODEL_REGION_LABELS[loaded.area] || loaded.area.toUpperCase(),
            cycle: loaded.cycle,
            total: hours.length,
            loaded: 0,
            failed: 0,
            completed: new Set(),
            failedHours: new Set()
        };
        modelRunCache.set(key, run);
    }
    state.modelActiveRunKey = key;
    updateModelPreloadStatus(run, `${run.modelName} ${run.fieldName} ${run.regionLabel} ${run.cycle}Z preloading`);

    const queue = hours
        .filter(hour => !run.completed.has(hour) && !run.failedHours.has(hour))
        .map(hour => ({ hour, url: modelImgUrl(meta, loaded.area, loaded.param, loaded.cycle, hour) }));

    let idx = 0;
    let active = 0;
    const maxActive = 5;

    const next = () => {
        if (token !== modelPreloadToken || state.modelActiveRunKey !== key) return;
        while (active < maxActive && idx < queue.length) {
            const item = queue[idx++];
            active += 1;
            loadModelImage(item.url).then(() => {
                if (!run.completed.has(item.hour)) {
                    run.completed.add(item.hour);
                    run.loaded += 1;
                }
            }).catch(() => {
                if (!run.failedHours.has(item.hour)) {
                    run.failedHours.add(item.hour);
                    run.failed += 1;
                }
            }).finally(() => {
                active -= 1;
                if (state.modelActiveRunKey === key) {
                    if (run.loaded + run.failed >= run.total) {
                        updateModelPreloadStatus(run, `${run.modelName} ${run.fieldName} ${run.regionLabel} ${run.cycle}Z ready`);
                    } else {
                        updateModelPreloadStatus(run);
                    }
                }
                next();
            });
        }
        if (!queue.length && run.loaded + run.failed >= run.total) {
            updateModelPreloadStatus(run, `${run.modelName} ${run.fieldName} ${run.regionLabel} ${run.cycle}Z ready`);
        }
    };
    next();
}

function renderModelFromActiveCache(meta, field, area, param) {
    const run = modelRunCache.get(state.modelActiveRunKey);
    if (!run) return false;
    const key = modelRunKey(state.modelModel, state.modelField, area, param, run.cycle);
    if (key !== state.modelActiveRunKey) return false;
    const url = modelImgUrl(meta, area, param, run.cycle, state.modelHour);
    const rec = cachedModelRecord(url);
    if (!rec) return false;
    displayModelImage($('#model-view'), rec, meta, field, { url, cycle: run.cycle, area, param }, state.modelHour);
    updateModelPreloadStatus(run, run.loaded + run.failed >= run.total ? `${run.modelName} ${run.fieldName} ${run.regionLabel} ${run.cycle}Z ready` : undefined);
    return true;
}

function renderModel() {
    const view = $('#model-view');
    const meta = MODEL_META[state.modelModel];
    const field = FIELD_META[state.modelField];
    if (!meta || !field) return;

    const token = ++modelRenderToken;
    const area = modelArea(meta);
    const param = modelParam(meta, field);
    const regionLabel = MODEL_REGION_LABELS[area] || area.toUpperCase();

    // update hour slider limits
    const slider = $('#model-hour');
    slider.max = meta.maxHour;
    slider.step = meta.step;
    if (state.modelHour > meta.maxHour) state.modelHour = meta.maxHour;
    state.modelHour = Math.round(state.modelHour / meta.step) * meta.step;
    slider.value = state.modelHour;
    $('#model-hour-label').textContent = 'F' + pad(state.modelHour, 3);

    if (renderModelFromActiveCache(meta, field, area, param)) return;

    view.innerHTML = `<div class="placeholder">loading ${meta.name} &bull; ${field.name} &bull; ${regionLabel} &bull; F${pad(state.modelHour,3)}…</div>`;
    updateModelPreloadStatus(null, `resolving ${meta.name} ${field.name} ${regionLabel} run`);

    const candidates = buildModelCandidates(meta, field);
    loadFirstModelImage(candidates, token, (rec, loaded) => {
        displayModelImage(view, rec, meta, field, loaded, state.modelHour);
        startModelPreload(meta, field, loaded);
    }, () => {
        updateModelPreloadStatus(null, `${meta.name} ${field.name} ${regionLabel} unavailable`);
        view.innerHTML = `<div class="placeholder" style="padding:24px">
            MAG model image unavailable for this combination.<br/>
            <br/>
            <a class="btn" href="${modelViewerLink(meta, area, param)}" target="_blank" rel="noopener">Open ${meta.name} on MAG &rarr;</a>
            <br/><br/>
            <span style="font-size:11px;color:var(--text-faint);font-family:var(--mono)">
                Tried recent cycles for ${meta.name} &bull; ${field.name} &bull; ${regionLabel} &bull; F${pad(state.modelHour,3)}
            </span>
        </div>`;
    });
}

function startModelAnim() {
    if (state.modelPlayTimer) return;
    $('#model-play').textContent = '⏸';
    const meta = MODEL_META[state.modelModel];
    state.modelPlayTimer = setInterval(() => {
        state.modelHour += meta.step;
        if (state.modelHour > meta.maxHour) state.modelHour = 0;
        renderModel();
    }, 900);
}
function stopModelAnim() {
    clearInterval(state.modelPlayTimer);
    state.modelPlayTimer = null;
    $('#model-play').textContent = '▶';
}

/* =========================================================
   QUOTES (rotating field notes)
   ========================================================= */
const QUOTES = [
    { q: 'Get the pattern right, and the forecast will mostly take care of itself.', c: 'forecasting aphorism' },
    { q: 'The sounding is the ground truth; the model is an opinion.', c: '— operational adage' },
    { q: 'Diagnosis before prognosis. Always.', c: '— synoptic rule' },
    { q: 'If the mid-level dry slot and the warm sector meet a backing low-level jet, pay attention.', c: '— severe-weather heuristic' },
    { q: 'In winter, watch the 850 mb thermal ridge — it betrays the mesoscale banding.', c: '— winter-weather desk' },
    { q: 'A quiet water-vapor image rarely stays quiet for long.', c: '— satellite interpretation' }
];

function rotateQuote() {
    const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    $('#quote-box').innerHTML = `&ldquo;${escapeHtml(q.q)}&rdquo;<span class="cite">${escapeHtml(q.c)}</span>`;
}
setInterval(rotateQuote, 25000);

/* =========================================================
   WORKFLOW SIDEBAR (active section highlight + scroll)
   ========================================================= */
$$('#workflow-list li').forEach(li => {
    li.addEventListener('click', () => {
        const t = document.getElementById(li.dataset.target);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});
const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
        if (e.isIntersecting) {
            const id = e.target.id;
            $$('#workflow-list li').forEach(li => {
                li.classList.toggle('active', li.dataset.target === id);
            });
        }
    }
}, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
$$('section[id]').forEach(s => io.observe(s));

/* =========================================================
   EVENT WIRING
   ========================================================= */

// Location
$('#loc-go').addEventListener('click', onLocSubmit);
$('#loc-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') onLocSubmit(); });
$('#loc-geo').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            state.lat = pos.coords.latitude;
            state.lon = pos.coords.longitude;
            state.placeLabel = null;
            refreshLocation();
        },
        (err) => alert('Geolocation denied: ' + err.message)
    );
});

async function onLocSubmit() {
    const v = $('#loc-input').value.trim();
    if (!v) return;
    let parsed = parseLoc(v);
    if (!parsed) {
        $('#loc-input').disabled = true;
        parsed = await geocode(v);
        $('#loc-input').disabled = false;
        if (!parsed) { alert('Could not find that location.'); return; }
    }
    state.lat = parsed.lat; state.lon = parsed.lon; state.placeLabel = parsed.label;
    refreshLocation();
}

async function refreshLocation() {
    $('#now-loc').textContent = 'Loading…';
    $('#now-temp').textContent = '—';
    try {
        await loadPointForecast(state.lat, state.lon);
    } catch (e) {
        console.warn(e);
        $('#now-loc').textContent = state.placeLabel || `${state.lat.toFixed(3)}, ${state.lon.toFixed(3)}`;
        $('#now-cond').textContent = 'NWS API not available for this point (outside US or service issue).';
    }
    if (radarMap) {
        radarMap.setView([state.lat, state.lon], radarMap.getZoom());
        if (state.locMarker) state.locMarker.setLatLng([state.lat, state.lon]);
    }
}

// Satellite tabs
$$('#sat-tabs .tab').forEach(t => {
    t.addEventListener('click', () => {
        state.satTab = t.dataset.sat;
        $$('#sat-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
        renderSatellite();
    });
});

// Radar controls
$$('.tab[data-radar-mode]').forEach(t => {
    t.addEventListener('click', () => setRadarMode(t.dataset.radarMode));
});
$('#radar-play').addEventListener('click', () => {
    playRadar(!state.radarTimer);
});
$('#radar-prev').addEventListener('click', () => {
    if (!state.radarFrames?.length) return;
    state.radarIdx = (state.radarIdx - 1 + state.radarFrames.length) % state.radarFrames.length;
    showRadarFrame();
});
$('#radar-next').addEventListener('click', () => {
    if (!state.radarFrames?.length) return;
    state.radarIdx = (state.radarIdx + 1) % state.radarFrames.length;
    showRadarFrame();
});
$('#radar-warnings-overlay').addEventListener('change', (e) => {
    if (!radarMap || !state.warningsLayer) return;
    if (e.target.checked) state.warningsLayer.addTo(radarMap);
    else radarMap.removeLayer(state.warningsLayer);
});

// Meso tabs
$$('#meso-tabs .tab').forEach(t => {
    t.addEventListener('click', () => {
        state.mesoTab = t.dataset.meso;
        $$('#meso-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
        renderMeso();
    });
});

// Model wall tabs
$$('.tab[data-model]').forEach(t => t.addEventListener('click', () => {
    state.modelModel = t.dataset.model;
    invalidateModelPreload('preload waiting for model run');
    $$('.tab[data-model]').forEach(x => x.classList.toggle('active', x === t));
    renderModel();
}));
$$('.tab[data-field]').forEach(t => t.addEventListener('click', () => {
    state.modelField = t.dataset.field;
    invalidateModelPreload('preload waiting for model run');
    $$('.tab[data-field]').forEach(x => x.classList.toggle('active', x === t));
    renderModel();
}));
$$('.tab[data-region]').forEach(t => t.addEventListener('click', () => {
    state.modelRegion = t.dataset.region;
    invalidateModelPreload('preload waiting for model run');
    $$('.tab[data-region]').forEach(x => x.classList.toggle('active', x === t));
    renderModel();
}));
$('#model-hour').addEventListener('input', (e) => {
    state.modelHour = parseInt(e.target.value, 10) || 0;
    $('#model-hour-label').textContent = 'F' + pad(state.modelHour, 3);
});
$('#model-hour').addEventListener('change', renderModel);
$('#model-play').addEventListener('click', () => {
    if (state.modelPlayTimer) stopModelAnim(); else startModelAnim();
});

/* =========================================================
   PAGE NAVIGATION
   ========================================================= */
const PAGE_INIT = {};
function switchPage(pageId) {
    $$('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.page === pageId));
    $$('.page-view').forEach(v => v.classList.toggle('active', v.dataset.pageView === pageId));

    // Invalidate radar/map tile cache if switching away
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (typeof PAGE_INIT[pageId] === 'function') {
        try { PAGE_INIT[pageId](); } catch (e) { console.warn('page init', pageId, e); }
    }
    if (pageId === 'dashboard' && radarMap) {
        setTimeout(() => radarMap.invalidateSize(), 160);
    }
}
$$('.page-tab').forEach(t => {
    t.addEventListener('click', () => switchPage(t.dataset.page));
});

/* =========================================================
   SATELLITE LOOP PAGE
   STAR does not expose a CORS-readable frame index, so the
   standalone page uses the official animated GIF products.
   ========================================================= */
const SAT_SLIDER_STATE = {
    sector: 'CONUS',
    channel: 'GEOCOLOR',
    token: 0
};

const SAT_LOOP_META = {
    CONUS: { path: 'CONUS', prefix: 'CONUS', size: '625x375' },
    FD:    { path: 'FD', prefix: 'FD', size: '1808x1808', staticSize: '1808x1808' },
    ne:    { path: 'SECTOR/ne', prefix: 'NE', size: '600x600' },
    se:    { path: 'SECTOR/se', prefix: 'SE', size: '600x600' },
    sp:    { path: 'SECTOR/sp', prefix: 'SP', size: '600x600' },
    nw:    { path: 'SECTOR/nw', prefix: 'NW', size: '600x600' },
    gm:    { path: 'SECTOR/gm', prefix: 'GM', size: '600x600' },
    taw:   { path: 'SECTOR/taw', prefix: 'TAW', size: '600x600' },
    pnw:   { path: 'SECTOR/pnw', prefix: 'PNW', size: '600x600' }
};

function satLoopBase(sector, channel) {
    const meta = SAT_LOOP_META[sector] || SAT_LOOP_META.CONUS;
    return `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/${meta.path}/${channel}`;
}

function satLoopGifUrl(sector, channel) {
    const meta = SAT_LOOP_META[sector] || SAT_LOOP_META.CONUS;
    return `${satLoopBase(sector, channel)}/GOES19-${meta.prefix}-${channel}-${meta.size}.gif`;
}

function satLoopStaticUrl(sector, channel) {
    const meta = SAT_LOOP_META[sector] || SAT_LOOP_META.CONUS;
    const size = meta.staticSize || (sector === 'CONUS' ? '1250x750' : '1200x1200');
    return `${satLoopBase(sector, channel)}/${size}.jpg`;
}

function renderSatLoop() {
    const token = ++SAT_SLIDER_STATE.token;
    const stage = $('#satslider-stage');
    const placeholder = $('#satslider-placeholder');
    const timestamp = $('#satslider-time');
    const cacheCount = $('#satslider-cache-count');
    const status = $('#satslider-status');
    if (!stage) return;

    if (placeholder) {
        placeholder.style.display = '';
        placeholder.textContent = 'loading GOES-East animated loop…';
    }
    if (timestamp) timestamp.textContent = '—';
    if (cacheCount) cacheCount.textContent = 'preloading';
    if (status) status.textContent = `${SAT_SLIDER_STATE.channel} • ${SAT_SLIDER_STATE.sector}`;
    stage.querySelectorAll('img.sat-slider-img').forEach(el => el.remove());

    const gifUrl = satLoopGifUrl(SAT_SLIDER_STATE.sector, SAT_SLIDER_STATE.channel);
    const staticUrl = satLoopStaticUrl(SAT_SLIDER_STATE.sector, SAT_SLIDER_STATE.channel);
    const img = new Image();
    img.className = 'sat-slider-img';
    img.alt = `GOES-East ${SAT_SLIDER_STATE.sector} ${SAT_SLIDER_STATE.channel} animated loop`;
    img.onload = () => {
        if (token !== SAT_SLIDER_STATE.token) return;
        if (placeholder) placeholder.style.display = 'none';
        stage.insertBefore(img, stage.firstChild);
        if (timestamp) timestamp.textContent = `loop refreshed ${fmtTime(new Date())} (${fmtUTC(new Date())})`;
        if (cacheCount) cacheCount.textContent = 'animated loop loaded';
        const open = $('#satslider-open');
        if (open) open.href = gifUrl;
    };
    img.onerror = () => {
        if (token !== SAT_SLIDER_STATE.token) return;
        const still = new Image();
        still.className = 'sat-slider-img';
        still.alt = `GOES-East ${SAT_SLIDER_STATE.sector} ${SAT_SLIDER_STATE.channel} latest frame`;
        still.onload = () => {
            if (placeholder) placeholder.style.display = 'none';
            stage.insertBefore(still, stage.firstChild);
            if (timestamp) timestamp.textContent = 'animated loop unavailable; showing latest frame';
            if (cacheCount) cacheCount.textContent = 'single frame fallback';
            const open = $('#satslider-open');
            if (open) open.href = staticUrl;
        };
        still.onerror = () => {
            if (placeholder) {
                placeholder.style.display = '';
                placeholder.textContent = 'This channel is unavailable for the selected sector.';
            }
            if (timestamp) timestamp.textContent = 'try another channel or sector';
            if (cacheCount) cacheCount.textContent = 'unavailable';
        };
        still.src = staticUrl + '?_=' + Date.now();
    };
    img.src = gifUrl + '?_=' + Date.now();
}

function initSatSliderEvents() {
    if (initSatSliderEvents._wired) return;
    initSatSliderEvents._wired = true;
    $$('#satslider-sector-tabs .tab').forEach(t => t.addEventListener('click', () => {
        SAT_SLIDER_STATE.sector = t.dataset.ssSector;
        $$('#satslider-sector-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
        renderSatLoop();
    }));
    $$('#satslider-channel-tabs .tab').forEach(t => t.addEventListener('click', () => {
        SAT_SLIDER_STATE.channel = t.dataset.ssChan;
        $$('#satslider-channel-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
        renderSatLoop();
    }));
    $('#satslider-refresh')?.addEventListener('click', renderSatLoop);
}
PAGE_INIT.satslider = () => {
    initSatSliderEvents();
    renderSatLoop();
};

/* =========================================================
   SHARED ANALYTIC CHART HELPERS
   ========================================================= */
const PARAM_CHARTS = {};

function buildParamSeries() {
    const periods = state.hourly?.properties?.periods;
    if (!periods || !periods.length) return null;
    const take = periods.slice(0, 72);
    const out = take.map((p, i) => {
        const tempF = p.temperature;
        const rh = p.relativeHumidity?.value ?? null;
        const pop = p.probabilityOfPrecipitation?.value ?? 0;
        const wind = parseWindMph(p.windSpeed);
        const wdir = windDirToDeg(p.windDirection) ?? null;
        // Dewpoint via Magnus
        let td = null;
        if (tempF != null && rh != null) {
            const tc = (tempF - 32) * 5 / 9;
            const a = 17.625, b = 243.04;
            const alpha = Math.log(Math.max(rh, 0.0001) / 100) + (a * tc) / (b + tc);
            td = (b * alpha) / (a - alpha) * 9 / 5 + 32;
        }
        // Wet-bulb via Stull (rh in percent, T in C)
        let tw = null;
        if (tempF != null && rh != null) {
            const T = (tempF - 32) * 5 / 9;
            const Tw_c = T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
                + Math.atan(T + rh) - Math.atan(rh - 1.676331)
                + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
                - 4.686035;
            tw = Tw_c * 9 / 5 + 32;
        }
        const apparent = apparentTempF(tempF, rh, wind);
        // Dewpoint depression
        const dd = (tempF != null && td != null) ? (tempF - td) : null;
        // Mixing-ratio proxy (very crude) from Td
        let mixr = null;
        if (td != null) {
            const tdc = (td - 32) * 5 / 9;
            const es = 6.112 * Math.exp(17.67 * tdc / (tdc + 243.5)); // hPa
            mixr = 621.97 * es / (1013 - es); // g/kg at ~1013 hPa
        }
        // Moisture flux proxy = mixing ratio × wind
        const mflux = (mixr != null) ? mixr * wind : null;
        return {
            start: new Date(p.startTime), i,
            tempF, td, tw, rh, pop, wind, wdir, apparent, dd, mixr, mflux,
            windDir: p.windDirection || '',
            wx: p.shortForecast || ''
        };
    });
    // Pressure tendency proxy = -d(apparent)/dt (very rough analog)
    for (let i = 1; i < out.length; i++) {
        const a = out[i].apparent ?? out[i].tempF;
        const b = out[i - 1].apparent ?? out[i - 1].tempF;
        out[i].ptend = (a != null && b != null) ? (b - a) : null;
        out[i].dwind = (out[i].wind - out[i - 1].wind);
    }
    out[0].ptend = 0;
    out[0].dwind = 0;
    return out;
}

function labelEveryN(series, n, formatter) {
    return series.map((x, i) => (i % n === 0) ? formatter(x) : '');
}

function renderParamCards(series) {
    const host = $('#param-cards');
    if (!host) return;
    if (!series) { host.innerHTML = '<div class="alert-empty" style="grid-column:1/-1">Forecast unavailable for this point.</div>'; return; }
    const win24 = series.slice(0, 24);
    const hiT = maxBy(win24, x => x.tempF ?? -999);
    const loT = minBy(win24, x => x.tempF ?? 999);
    const hiPoP = maxBy(win24, x => x.pop);
    const hiWind = maxBy(win24, x => x.wind);
    const loDD = minBy(win24.filter(x => x.dd != null), x => x.dd);
    const hiFlux = maxBy(win24.filter(x => x.mflux != null), x => x.mflux);
    const avgRh = Math.round(win24.reduce((s, x) => s + (x.rh ?? 0), 0) / win24.length);
    const hiShear = maxBy(win24, x => Math.abs(x.dwind || 0));
    const cards = [
        card('High / Low', `${Math.round(hiT.tempF)}° / ${Math.round(loT.tempF)}°`, `Δ ${Math.round(hiT.tempF - loT.tempF)}°F diurnal range`, (hiT.tempF >= 90 || loT.tempF <= 32) ? 'warm' : ''),
        card('Lowest Dewpoint Depression', loDD ? `${loDD.dd.toFixed(1)}°F` : '—', loDD ? `near ${shortTimeLabel(loDD.start)} — saturation risk` : '', loDD && loDD.dd < 4 ? 'cool' : ''),
        card('Peak Moisture Flux', hiFlux ? `${hiFlux.mflux.toFixed(1)}` : '—', hiFlux ? `${Math.round(hiFlux.mixr)} g/kg × ${hiFlux.wind} mph` : '', hiFlux && hiFlux.mflux > 100 ? 'hot' : hiFlux && hiFlux.mflux > 60 ? 'warm' : ''),
        card('Peak PoP', `${hiPoP.pop}%`, shortTimeLabel(hiPoP.start), hiPoP.pop >= 70 ? 'cool' : ''),
        card('Peak Wind', `${hiWind.wind} mph`, `${hiWind.windDir || ''} near ${shortTimeLabel(hiWind.start)}`.trim(), hiWind.wind >= 30 ? 'warm' : ''),
        card('Avg RH', `${avgRh}%`, `mean over next 24 h`, avgRh >= 80 ? 'cool' : avgRh <= 30 ? 'warm' : ''),
        card('Biggest Wind Shift', hiShear ? `Δ${Math.abs(Math.round(hiShear.dwind))} mph/hr` : '—', hiShear ? `hourly delta near ${shortTimeLabel(hiShear.start)}` : '', hiShear && Math.abs(hiShear.dwind) > 12 ? 'warm' : ''),
        card('Forecast Span', `${series.length} h`, `${fmtShortDate(series[0].start)} → ${fmtShortDate(series[series.length-1].start)}`, '')
    ];
    host.innerHTML = cards.join('');
    function card(k, v, sub, cls) {
        return `<div class="param-card ${cls}"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    }
}

function paramLabels(series) {
    return series.map((x, i) => {
        const h = x.start.getHours();
        if (h === 0 || h === 12 || i === 0) {
            return x.start.toLocaleDateString([], { weekday: 'short' }) + ' ' + pad(h) + ':00';
        }
        return pad(h) + ':00';
    });
}

function renderParamThermo(series) {
    const canvas = $('#param-thermo');
    if (!canvas || typeof Chart === 'undefined') return;
    if (PARAM_CHARTS.thermo) PARAM_CHARTS.thermo.destroy();
    if (!series) return;
    const labels = paramLabels(series);
    PARAM_CHARTS.thermo = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Temp (°F)',    data: series.map(x => x.tempF),    borderColor: '#ff5a7a', backgroundColor: 'rgba(255,90,122,0.08)', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Dewpoint',     data: series.map(x => x.td),       borderColor: '#7df0c8', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.35, borderDash: [3,3] },
                { label: 'Wet-bulb',     data: series.map(x => x.tw),       borderColor: '#5eb8ff', borderWidth: 1.6, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Feels-like',   data: series.map(x => x.apparent), borderColor: '#ffb454', borderWidth: 1.4, pointRadius: 0, fill: false, tension: 0.35, borderDash: [1,2] }
            ]
        },
        options: chartBase('°F')
    });
}

function renderParamFlux(series) {
    const canvas = $('#param-flux');
    if (!canvas || typeof Chart === 'undefined') return;
    if (PARAM_CHARTS.flux) PARAM_CHARTS.flux.destroy();
    if (!series) return;
    const labels = paramLabels(series);
    PARAM_CHARTS.flux = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { type: 'bar',  label: 'Moisture flux proxy', data: series.map(x => x.mflux), backgroundColor: 'rgba(125,240,200,0.35)', borderColor: 'rgba(125,240,200,0.7)', borderWidth: 1, yAxisID: 'y' },
                { type: 'line', label: 'Pressure tendency proxy (°F/h)', data: series.map(x => x.ptend), borderColor: '#b48cff', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y1', tension: 0.35 },
                { type: 'line', label: 'Wind Δ (mph/h)', data: series.map(x => x.dwind), borderColor: '#ffb454', borderWidth: 1.2, pointRadius: 0, yAxisID: 'y1', tension: 0.35, borderDash: [2,2] }
            ]
        },
        options: chartBase('g·mph/kg', 'Δ')
    });
}

function chartBase(leftTitle, rightTitle) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
            legend: { labels: { color: '#9aa7bd', font: { family: 'JetBrains Mono, monospace', size: 10 } } },
            tooltip: {
                backgroundColor: 'rgba(10,15,26,0.95)',
                borderColor: 'rgba(120,180,255,0.3)', borderWidth: 1,
                titleColor: '#e6edf7', bodyColor: '#9aa7bd'
            }
        },
        scales: {
            x: {
                ticks: { color: '#6b7a93', maxRotation: 0, autoSkip: true, autoSkipPadding: 20, font: { size: 10, family: 'JetBrains Mono, monospace' } },
                grid: { color: 'rgba(120,150,200,0.08)' }
            },
            y: {
                position: 'left',
                ticks: { color: '#9aa7bd', font: { size: 10 } },
                grid: { color: 'rgba(120,150,200,0.08)' },
                title: { display: !!leftTitle, text: leftTitle || '', color: '#9aa7bd', font: { size: 10 } }
            },
            y1: rightTitle ? {
                position: 'right',
                ticks: { color: '#b48cff', font: { size: 10 } },
                grid: { display: false },
                title: { display: true, text: rightTitle, color: '#b48cff', font: { size: 10 } }
            } : { display: false }
        }
    };
}

function renderParamTimeHeight(series) {
    const canvas = $('#param-timeheight');
    if (!canvas || !series) return;
    // Draw a time (columns) × layer (rows) heatmap on a canvas
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
    const cssHeight = 260;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.height = cssHeight + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const pad = { l: 110, r: 14, t: 10, b: 28 };
    const plotW = cssWidth - pad.l - pad.r;
    const plotH = cssHeight - pad.t - pad.b;
    const n = series.length;
    const cellW = plotW / n;

    // rows — higher index = higher in metaphorical column
    const rows = [
        { label: 'Surface T',      get: x => x.tempF,    min: 0, max: 100, color: 'hot' },
        { label: 'Dewpoint',       get: x => x.td,       min: 0, max: 80, color: 'cool' },
        { label: 'Wet-bulb',       get: x => x.tw,       min: 0, max: 90, color: 'cool' },
        { label: 'Feels-like',     get: x => x.apparent, min: 0, max: 110, color: 'hot' },
        { label: 'RH (%)',         get: x => x.rh,       min: 0, max: 100, color: 'cool' },
        { label: 'Dew Depression', get: x => x.dd,       min: 0, max: 40, color: 'warm' },
        { label: 'Wind (mph)',     get: x => x.wind,     min: 0, max: 50, color: 'warm' },
        { label: 'PoP (%)',        get: x => x.pop,      min: 0, max: 100, color: 'accent' },
        { label: 'Moist. Flux',    get: x => x.mflux,    min: 0, max: 200, color: 'cool' }
    ];
    const cellH = plotH / rows.length;

    // Color ramps
    function ramp(frac, kind) {
        frac = Math.max(0, Math.min(1, frac));
        if (kind === 'hot') {
            // dark->orange->red
            const r = Math.round(20 + 235 * frac);
            const g = Math.round(30 + 120 * (1 - Math.abs(frac - 0.5) * 2));
            const b = Math.round(60 * (1 - frac));
            return `rgba(${r},${g},${b},0.9)`;
        }
        if (kind === 'cool') {
            const r = Math.round(30 + 100 * (1 - frac));
            const g = Math.round(60 + 180 * frac);
            const b = Math.round(120 + 135 * frac);
            return `rgba(${r},${g},${b},0.9)`;
        }
        if (kind === 'warm') {
            const r = Math.round(50 + 200 * frac);
            const g = Math.round(50 + 150 * frac);
            const b = Math.round(30 + 40 * frac);
            return `rgba(${r},${g},${b},0.85)`;
        }
        // accent
        const r = Math.round(30 + 64 * frac);
        const g = Math.round(60 + 120 * frac);
        const b = Math.round(180 + 75 * frac);
        return `rgba(${r},${g},${b},0.92)`;
    }

    // Draw cells
    rows.forEach((row, ri) => {
        for (let ci = 0; ci < n; ci++) {
            const v = row.get(series[ci]);
            if (v == null || isNaN(v)) continue;
            const frac = (v - row.min) / (row.max - row.min);
            ctx.fillStyle = ramp(frac, row.color);
            ctx.fillRect(pad.l + ci * cellW, pad.t + ri * cellH, Math.max(1, cellW - 0.5), cellH - 1);
        }
        // row label
        ctx.fillStyle = '#9aa7bd';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        ctx.fillText(row.label, pad.l - 8, pad.t + ri * cellH + cellH / 2);
    });

    // x-axis labels (every 6 hours)
    ctx.fillStyle = '#6b7a93';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let ci = 0; ci < n; ci++) {
        if (ci % 6 !== 0) continue;
        const d = series[ci].start;
        const h = d.getHours();
        const lbl = (h === 0) ? d.toLocaleDateString([], { weekday: 'short' }) : pad(h) + ':00';
        ctx.fillText(lbl, pad.l + ci * cellW + cellW / 2, pad.t + plotH + 4);
    }

    // Frame
    ctx.strokeStyle = 'rgba(120,150,200,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, pad.t, plotW, plotH);
}

function renderParamConvective(series) {
    const canvas = $('#param-convective');
    if (!canvas || typeof Chart === 'undefined') return;
    if (PARAM_CHARTS.conv) PARAM_CHARTS.conv.destroy();
    if (!series) return;
    const labels = paramLabels(series);
    // Proxies normalized 0-100
    const moisture = series.map(x => {
        if (x.td == null) return 0;
        // map 40°F -> 0, 75°F -> 100
        return Math.max(0, Math.min(100, (x.td - 40) / 35 * 100));
    });
    const instability = series.map(x => {
        if (x.tempF == null || x.td == null) return 0;
        // higher sfc T with low dewpoint depression and warm apparent = more "buoyant"
        const dd = Math.max(0, x.dd ?? 40);
        const app = x.apparent ?? x.tempF;
        const score = (app - 60) * 1.4 - dd * 1.2;
        return Math.max(0, Math.min(100, score));
    });
    const shear = series.map(x => {
        return Math.max(0, Math.min(100, Math.abs(x.dwind || 0) * 4 + x.wind * 1.0));
    });
    const composite = series.map((x, i) => Math.round(0.45 * moisture[i] + 0.35 * instability[i] + 0.20 * shear[i]));

    PARAM_CHARTS.conv = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Moisture proxy',      data: moisture,    borderColor: '#7df0c8', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Instability proxy',   data: instability, borderColor: '#ff5a7a', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Shear proxy',         data: shear,       borderColor: '#b48cff', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.35 },
                { label: 'Composite',           data: composite,   borderColor: '#ffb454', borderWidth: 2.2, pointRadius: 0, fill: 'origin', backgroundColor: 'rgba(255,180,84,0.10)', tension: 0.35 }
            ]
        },
        options: chartBase('0–100 proxy')
    });
}

function renderParamsLab() {
    const series = buildParamSeries();
    renderParamCards(series);
    renderParamThermo(series);
    renderParamFlux(series);
    renderParamConvective(series);
    renderParamTimeHeight(series);
}
/* =========================================================
   SPACE WEATHER
   NOAA SWPC: planetary K-index JSON + real-time solar wind
   ========================================================= */
async function loadSpaceWeather() {
    const status = $('#space-updated');
    if (status) status.textContent = 'fetching SWPC…';

    // Planetary Kp - 3 days
    try {
        const res = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json');
        const rows = await res.json();
        // rows[0] = header; ["time_tag","Kp","a_running","station_count"]
        const data = rows.slice(1).slice(-28); // last ~3.5 days of 3-hour bins
        renderKpChart(data);
        renderKpStatus(data);
    } catch (e) { console.warn('Kp fetch failed', e); const box = $('#kp-status'); if (box) box.textContent = 'Kp unavailable'; }

    // Real-time solar wind (plasma + magnetic)
    try {
        const plasmaRes = await fetch('https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json');
        const plasma = await plasmaRes.json();
        const magRes = await fetch('https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json');
        const mag = await magRes.json();
        renderSolarWind(plasma, mag);
    } catch (e) { console.warn('Solar wind fetch failed', e); const box = $('#sw-status'); if (box) box.textContent = 'Solar wind unavailable'; }

    try {
        const xrayRes = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json');
        const xray = await xrayRes.json();
        renderXrayFlux(xray);
    } catch (e) {
        console.warn('X-ray fetch failed', e);
        const box = $('#xray-current');
        if (box) box.textContent = 'X-ray flux unavailable';
    }

    if (status) status.textContent = 'updated ' + fmtTime(new Date());
}

function renderKpChart(data) {
    const canvas = $('#space-kp');
    if (!canvas || typeof Chart === 'undefined') return;
    const labels = data.map(r => {
        const d = new Date(r[0] + 'Z');
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + pad(d.getUTCHours()) + 'Z';
    });
    const kp = data.map(r => parseFloat(r[1]));
    if (PARAM_CHARTS.kp) PARAM_CHARTS.kp.destroy();
    PARAM_CHARTS.kp = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Planetary Kp',
                data: kp,
                backgroundColor: kp.map(v => v >= 7 ? 'rgba(255,90,122,0.75)' : v >= 5 ? 'rgba(255,180,84,0.7)' : v >= 4 ? 'rgba(180,140,255,0.6)' : 'rgba(94,184,255,0.55)'),
                borderColor: 'rgba(120,180,255,0.35)', borderWidth: 1
            }]
        },
        options: Object.assign(chartBase('Kp'), { scales: { x: chartBase().scales.x, y: { min: 0, max: 9, ticks: { stepSize: 1, color: '#9aa7bd', font: { size: 10 } }, grid: { color: 'rgba(120,150,200,0.08)' }, title: { display: true, text: 'Kp', color: '#9aa7bd', font: { size: 10 } } } } })
    });
}

function renderKpStatus(data) {
    const box = $('#kp-status');
    if (!box) return;
    const latest = data[data.length - 1];
    const kp = parseFloat(latest[1]);
    const tm = new Date(latest[0] + 'Z');
    let level = 'Quiet', cls = '';
    if (kp >= 5 && kp < 6) { level = 'G1 Minor storm'; cls = 'g1'; }
    else if (kp >= 6 && kp < 7) { level = 'G2 Moderate storm'; cls = 'g2'; }
    else if (kp >= 7 && kp < 8) { level = 'G3 Strong storm'; cls = 'g3'; }
    else if (kp >= 8 && kp < 9) { level = 'G4 Severe storm'; cls = 'g4'; }
    else if (kp >= 9) { level = 'G5 Extreme storm'; cls = 'g5'; }
    box.className = 'kp-status ' + cls;
    box.innerHTML = `Latest Kp <b style="color:var(--text)">${kp.toFixed(2)}</b> at ${fmtTime(tm)} (${fmtUTC(tm)} UTC) — ${level}. Aurora likely equatorward of ~${Math.max(55 - kp * 3, 45)}° geomagnetic latitude on storm nights.`;
}

function renderSolarWind(plasma, mag) {
    const canvas = $('#space-solarwind');
    if (!canvas || typeof Chart === 'undefined') return;
    // plasma header: ["time_tag","density","speed","temperature"]
    const pdata = plasma.slice(1).slice(-80);
    // mag header: ["time_tag","bx_gsm","by_gsm","bz_gsm","lon_gsm","lat_gsm","bt"]
    const mdata = mag.slice(1).slice(-80);

    const labels = pdata.map(r => {
        const d = new Date(r[0]);
        return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    });
    const speed = pdata.map(r => parseFloat(r[2]));
    const density = pdata.map(r => parseFloat(r[1]));
    const bz = mdata.map(r => parseFloat(r[3]));

    if (PARAM_CHARTS.sw) PARAM_CHARTS.sw.destroy();
    PARAM_CHARTS.sw = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                { label: 'Speed (km/s)', data: speed, borderColor: '#ffb454', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y', tension: 0.3 },
                { label: 'Density (p/cm³)', data: density, borderColor: '#7df0c8', borderWidth: 1.4, pointRadius: 0, yAxisID: 'y1', tension: 0.3 },
                { label: 'Bz (nT, GSM)', data: bz, borderColor: '#ff5a7a', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y1', tension: 0.3 }
            ]
        },
        options: chartBase('km/s', 'nT / p·cm⁻³')
    });

    const latest = pdata[pdata.length - 1];
    const latestMag = mdata[mdata.length - 1];
    const sw = $('#sw-status');
    if (sw) {
        sw.textContent = `Speed ${parseFloat(latest[2]).toFixed(0)} km/s · Density ${parseFloat(latest[1]).toFixed(1)} p/cm³ · Bz ${parseFloat(latestMag[3]).toFixed(1)} nT (south Bz drives auroral activity)`;
    }
}

function flareClassFromFlux(flux) {
    if (flux == null || !isFinite(flux)) return '—';
    const bands = [
        ['X', 1e-4],
        ['M', 1e-5],
        ['C', 1e-6],
        ['B', 1e-7],
        ['A', 1e-8]
    ];
    for (const [letter, base] of bands) {
        if (flux >= base) return `${letter}${(flux / base).toFixed(1)}`;
    }
    return `<A1`;
}

function renderXrayFlux(rows) {
    const canvas = $('#space-xray');
    if (!canvas || typeof Chart === 'undefined') return;
    const primary = rows
        .filter(r => r.energy === '0.1-0.8nm' && r.flux != null)
        .slice(-360);
    const secondary = rows
        .filter(r => r.energy === '0.05-0.4nm' && r.flux != null)
        .slice(-360);
    if (!primary.length) throw new Error('No X-ray rows');

    const labels = primary.map(r => {
        const d = new Date(r.time_tag);
        return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z';
    });
    if (PARAM_CHARTS.xray) PARAM_CHARTS.xray.destroy();
    PARAM_CHARTS.xray = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '0.1-0.8 nm',
                    data: primary.map(r => Math.log10(Math.max(r.flux, 1e-9))),
                    borderColor: '#ffb454',
                    backgroundColor: 'rgba(255,180,84,0.08)',
                    borderWidth: 1.8,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: true
                },
                {
                    label: '0.05-0.4 nm',
                    data: secondary.map(r => Math.log10(Math.max(r.flux, 1e-9))),
                    borderColor: '#5eb8ff',
                    borderWidth: 1.2,
                    pointRadius: 0,
                    tension: 0.25
                }
            ]
        },
        options: Object.assign(chartBase('flare class'), {
            scales: {
                x: chartBase().scales.x,
                y: {
                    min: -8,
                    max: -3,
                    ticks: {
                        color: '#9aa7bd',
                        font: { size: 10 },
                        callback: v => ({ '-8':'A1', '-7':'B1', '-6':'C1', '-5':'M1', '-4':'X1', '-3':'X10' }[String(v)] || '')
                    },
                    grid: { color: 'rgba(120,150,200,0.08)' },
                    title: { display: true, text: 'GOES X-ray class', color: '#9aa7bd', font: { size: 10 } }
                }
            }
        })
    });

    const latest = primary[primary.length - 1];
    const peak = maxBy(primary, r => r.flux);
    const latestTime = new Date(latest.time_tag);
    const current = $('#xray-current');
    if (current) {
        current.innerHTML = `Current <b style="color:var(--text)">${flareClassFromFlux(latest.flux)}</b> at ${fmtUTC(latestTime)} UTC · 6-hour peak ${flareClassFromFlux(peak.flux)}.`;
    }
    const status = $('#xray-status');
    if (status) status.textContent = 'SWPC JSON · 6-hour';
}

PAGE_INIT.space = () => {
    if (!PAGE_INIT.space._loaded) {
        PAGE_INIT.space._loaded = true;
        loadSpaceWeather();
    }
};

/* =========================================================
   MARINE PAGE — nearest NDBC buoy
   ========================================================= */
const NDBC_STATIONS = [
    // A curated set of NDBC stations near common coastlines. The "nearest"
    // is selected by great-circle distance to the user's lat/lon.
    { id: '44025', name: 'Long Island, NY',     lat: 40.250, lon: -73.164 },
    { id: '44009', name: 'Delaware Bay, DE',    lat: 38.457, lon: -74.703 },
    { id: '44013', name: 'Boston Approach, MA', lat: 42.346, lon: -70.651 },
    { id: '44065', name: 'New York Harbor, NY', lat: 40.369, lon: -73.703 },
    { id: '41002', name: 'S. Hatteras, NC',     lat: 31.887, lon: -74.919 },
    { id: '41010', name: 'Canaveral East, FL',  lat: 28.878, lon: -78.485 },
    { id: '42001', name: 'Mid Gulf, LA',        lat: 25.897, lon: -89.664 },
    { id: '42036', name: 'W of Tampa, FL',      lat: 28.499, lon: -84.517 },
    { id: '42056', name: 'Yucatan Basin',       lat: 19.874, lon: -84.938 },
    { id: '46026', name: 'San Francisco, CA',   lat: 37.755, lon: -122.839 },
    { id: '46086', name: 'San Clemente, CA',    lat: 32.491, lon: -118.034 },
    { id: '46005', name: 'W Washington, WA',    lat: 46.134, lon: -131.005 },
    { id: '46089', name: 'Tillamook, OR',       lat: 45.908, lon: -125.754 },
    { id: '51201', name: 'Waimea Bay, HI',      lat: 21.671, lon: -158.120 },
    { id: '46072', name: 'Cent. Aleutians, AK', lat: 51.668, lon: -172.000 },
    { id: '44008', name: 'Nantucket, MA',       lat: 40.504, lon: -69.248 },
    { id: '41001', name: 'E of Hatteras, NC',   lat: 34.704, lon: -72.697 }
];

function haversineKm(a, b, c, d) {
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(c - a);
    const dLon = toRad(d - b);
    const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
    const h = s1 * s1 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * s2 * s2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function nearestBuoy(lat, lon) {
    let best = null, bestD = Infinity;
    for (const s of NDBC_STATIONS) {
        const d = haversineKm(lat, lon, s.lat, s.lon);
        if (d < bestD) { bestD = d; best = s; }
    }
    return { ...best, distanceKm: bestD };
}

async function fetchBuoyObs(id, limit = 96) {
    const res = await fetch(`https://api.weather.gov/stations/${id}/observations?limit=${limit}`, {
        headers: { 'Accept': 'application/geo+json' }
    });
    if (!res.ok) throw new Error('api.weather.gov buoy ' + res.status);
    const data = await res.json();
    const rows = data.features || [];
    if (!rows.length) throw new Error('No buoy observations');
    return rows;
}

async function loadBuoy() {
    let info = nearestBuoy(state.lat, state.lon);
    const idEl = $('#buoy-id');

    const cardsHost = $('#buoy-cards');
    const chartCanvas = $('#buoy-chart');
    const noteHost = $('#buoy-note');
    if (!cardsHost) return;
    cardsHost.innerHTML = '<div class="skeleton" style="height:86px"></div><div class="skeleton" style="height:86px"></div><div class="skeleton" style="height:86px"></div><div class="skeleton" style="height:86px"></div>';

    try {
        let rows;
        try {
            rows = await fetchBuoyObs(info.id);
        } catch (e) {
            info = { id: '44065', name: 'New York Harbor, NY', lat: 40.369, lon: -73.703, distanceKm: haversineKm(state.lat, state.lon, 40.369, -73.703) };
            rows = await fetchBuoyObs(info.id);
        }
        if (idEl) idEl.textContent = `${info.id} • ${info.name} • ${Math.round(info.distanceKm)} km away`;

        const latest = rows[0].properties;
        const q = (obj, key) => obj?.[key]?.value ?? null;
        const WDIR = q(latest, 'windDirection');
        const WSPD = q(latest, 'windSpeed'); // km/h
        const GST = q(latest, 'windGust');
        const PRES = q(latest, 'seaLevelPressure') ?? q(latest, 'barometricPressure'); // Pa
        const ATMP = q(latest, 'temperature');
        const DEWP = q(latest, 'dewpoint');
        const RH = q(latest, 'relativeHumidity');
        const CHILL = q(latest, 'windChill');
        const ts = new Date(latest.timestamp);

        const cards = [
            bc('Wind', WSPD != null ? `${(WSPD * 0.539957).toFixed(0)} kt` : '—', (WDIR != null ? `${degToCompass(WDIR)} ${Math.round(WDIR)}°` : 'direction unavailable') + (GST != null ? ` · gust ${(GST * 0.539957).toFixed(0)} kt` : ''), WSPD != null && WSPD >= 45 ? 'hot' : WSPD != null && WSPD >= 25 ? 'warm' : ''),
            bc('Air Temp', ATMP != null ? `${Math.round(cToF(ATMP))} °F` : '—', ATMP != null ? `${ATMP.toFixed(1)} °C` : '', ''),
            bc('Dewpoint / RH', DEWP != null ? `${Math.round(cToF(DEWP))} °F` : '—', RH != null ? `${Math.round(RH)}% relative humidity` : '', RH != null && RH >= 85 ? 'cool' : ''),
            bc('Pressure', PRES != null ? `${(PRES / 100).toFixed(1)} hPa` : '—', PRES != null ? `${paToInHg(PRES).toFixed(2)} inHg` : '', ''),
            bc('Wind Chill', CHILL != null ? `${Math.round(cToF(CHILL))} °F` : '—', `latest ${fmtTime(ts)} (${fmtUTC(ts)} UTC)`, ''),
            bc('Station', info.id, info.name, 'cool')
        ];
        cardsHost.innerHTML = cards.join('');

        const series = rows.slice(0, 72).reverse().map(f => f.properties);
        const labels = series.map(p => {
            const d = new Date(p.timestamp);
            return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z';
        });
        const ws = series.map(p => q(p, 'windSpeed') != null ? q(p, 'windSpeed') * 0.539957 : null);
        const temp = series.map(p => q(p, 'temperature') != null ? cToF(q(p, 'temperature')) : null);
        const pres = series.map(p => q(p, 'seaLevelPressure') != null ? q(p, 'seaLevelPressure') / 100 : null);

        if (PARAM_CHARTS.buoy) PARAM_CHARTS.buoy.destroy();
        PARAM_CHARTS.buoy = new Chart(chartCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Wind (kt)', data: ws, borderColor: '#ffb454', backgroundColor: 'rgba(255,180,84,0.08)', borderWidth: 1.8, pointRadius: 0, tension: 0.35, yAxisID: 'y', fill: true },
                    { label: 'Air Temp (°F)', data: temp, borderColor: '#5eb8ff', borderWidth: 1.4, pointRadius: 0, tension: 0.35, yAxisID: 'y1' },
                    { label: 'MSLP (hPa)', data: pres, borderColor: '#7df0c8', borderWidth: 1.2, pointRadius: 0, tension: 0.35, yAxisID: 'y2' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { labels: { color: '#9aa7bd', font: { family: 'JetBrains Mono, monospace', size: 10 } } },
                    tooltip: { backgroundColor: 'rgba(10,15,26,0.95)', borderColor: 'rgba(120,180,255,0.3)', borderWidth: 1, titleColor: '#e6edf7', bodyColor: '#9aa7bd' }
                },
                scales: {
                    x: chartBase().scales.x,
                    y: { position: 'left', ticks: { color: '#ffb454', font: { size: 10 } }, grid: { color: 'rgba(120,150,200,0.08)' }, title: { display: true, text: 'kt', color: '#ffb454', font: { size: 10 } } },
                    y1: { position: 'right', ticks: { color: '#5eb8ff', font: { size: 10 } }, grid: { display: false }, title: { display: true, text: '°F', color: '#5eb8ff', font: { size: 10 } } },
                    y2: { display: false }
                }
            }
        });

        if (noteHost) noteHost.innerHTML = `<strong>Data source</strong>
            Live station ${info.id} observations are loaded through api.weather.gov, which exposes the NDBC buoy as CORS-readable GeoJSON. The direct NDBC realtime text feed is live but blocks browser reads, so the dashboard uses the NOAA API mirror for smooth in-page plotting.`;
    } catch (e) {
        console.warn('NDBC fetch failed', e);
        if (idEl) idEl.textContent = '44065 • New York Harbor, NY';
        cardsHost.innerHTML = '<div class="alert-empty" style="grid-column:1/-1">Buoy data temporarily unavailable. <a href="https://www.ndbc.noaa.gov/station_page.php?station=44065" target="_blank" rel="noopener">Open station 44065 →</a></div>';
    }

    function bc(k, v, sub, cls) {
        return `<div class="param-card ${cls}"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div><div class="sub">${escapeHtml(sub)}</div></div>`;
    }
}
PAGE_INIT.marine = () => {
    if (!PAGE_INIT.marine._loaded) {
        PAGE_INIT.marine._loaded = true;
        loadBuoy();
        initWaveWatch();
    }
};

const WAVEWATCH_STATE = {
    hour: 0,
    cycle: null,
    token: 0
};

function waveCycleCandidates() {
    const now = new Date();
    const latest = Math.floor(((now.getUTCHours() - 8 + 24) % 24) / 6) * 6;
    return [0, 6, 12, 18].map((_, i) => pad((latest - i * 6 + 2400) % 24));
}

function waveWatchUrl(cycle, hour) {
    return `https://mag.ncep.noaa.gov/data/gfs-wave/${cycle}/gfs-wave_atl-pac_${pad(hour, 3)}_sig_wv_ht.gif`;
}

function renderWaveWatch() {
    const view = $('#wavewatch-view');
    const status = $('#wavewatch-status');
    const label = $('#wavewatch-hour-label');
    const slider = $('#wavewatch-hour');
    if (!view) return;
    const token = ++WAVEWATCH_STATE.token;
    WAVEWATCH_STATE.hour = Math.round(WAVEWATCH_STATE.hour / 3) * 3;
    if (slider) slider.value = WAVEWATCH_STATE.hour;
    if (label) label.textContent = 'F' + pad(WAVEWATCH_STATE.hour, 3);
    view.innerHTML = '<div class="placeholder">loading GFS-WAVE significant wave height…</div>';
    const fallbackCycles = waveCycleCandidates();
    const cycles = WAVEWATCH_STATE.cycle
        ? [WAVEWATCH_STATE.cycle, ...fallbackCycles.filter(c => c !== WAVEWATCH_STATE.cycle)]
        : fallbackCycles;
    let idx = 0;
    const tryNext = () => {
        if (token !== WAVEWATCH_STATE.token) return;
        const cycle = cycles[idx++];
        if (!cycle) {
            view.innerHTML = `<div class="placeholder">GFS-WAVE image unavailable.<br><a href="https://mag.ncep.noaa.gov/model-guidance-model-parameter.php?group=Model%20Guidance&model=GFS-WAVE&area=ATL-PAC&param=sig_wv_ht&ps=area" target="_blank" rel="noopener" style="color:var(--accent)">Open GFS-WAVE on MAG &rarr;</a></div>`;
            if (status) status.textContent = 'unavailable';
            return;
        }
        const url = waveWatchUrl(cycle, WAVEWATCH_STATE.hour);
        const img = new Image();
        img.alt = `GFS-WAVE Atlantic-Pacific significant wave height F${WAVEWATCH_STATE.hour}`;
        img.onload = () => {
            if (token !== WAVEWATCH_STATE.token) return;
            WAVEWATCH_STATE.cycle = cycle;
            view.innerHTML = '';
            view.appendChild(img);
            const a = document.createElement('a');
            a.className = 'open-src';
            a.target = '_blank';
            a.rel = 'noopener';
            a.href = url;
            a.textContent = `MAG ${cycle}Z →`;
            view.appendChild(a);
            if (status) status.textContent = `GFS-WAVE ${cycle}Z · F${pad(WAVEWATCH_STATE.hour, 3)}`;
        };
        img.onerror = tryNext;
        img.src = url + '?_=' + Math.floor(Date.now() / (5 * 60 * 1000));
    };
    tryNext();
}

function initWaveWatch() {
    if (initWaveWatch._wired) {
        renderWaveWatch();
        return;
    }
    initWaveWatch._wired = true;
    $('#wavewatch-hour')?.addEventListener('input', e => {
        WAVEWATCH_STATE.hour = parseInt(e.target.value, 10) || 0;
        $('#wavewatch-hour-label').textContent = 'F' + pad(WAVEWATCH_STATE.hour, 3);
    });
    $('#wavewatch-hour')?.addEventListener('change', renderWaveWatch);
    $('#wavewatch-prev')?.addEventListener('click', () => {
        WAVEWATCH_STATE.hour = Math.max(0, WAVEWATCH_STATE.hour - 3);
        renderWaveWatch();
    });
    $('#wavewatch-next')?.addEventListener('click', () => {
        WAVEWATCH_STATE.hour = Math.min(180, WAVEWATCH_STATE.hour + 3);
        renderWaveWatch();
    });
    renderWaveWatch();
}

/* Reload marine whenever the user changes location */
const _origRefresh = refreshLocation;
refreshLocation = async function() {
    await _origRefresh.apply(this, arguments);
    const marinePage = $('.page-view[data-page-view="marine"]');
    if (marinePage?.classList.contains('active')) {
        PAGE_INIT.marine._loaded = false;
        PAGE_INIT.marine();
    }
};

/* =========================================================
   BOOT
   ========================================================= */
window.addEventListener('load', () => {
    initRadarMap();
    renderSatellite();
    renderMeso();
    renderModel();
    refreshLocation();
    const requestedPage = new URLSearchParams(location.search).get('page');
    const pageExists = requestedPage && $$('.page-tab').some(tab => tab.dataset.page === requestedPage);
    if (pageExists) {
        switchPage(requestedPage);
    }
    if (location.hash) {
        setTimeout(() => {
            const target = document.querySelector(location.hash);
            if (target) target.scrollIntoView({ block: 'start' });
        }, 1800);
    }
});
