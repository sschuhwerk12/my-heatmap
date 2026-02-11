const form = document.querySelector('#asset-form');
const statusEl = document.querySelector('#status');
const demographicsEl = document.querySelector('#demographics');
const compsSummaryEl = document.querySelector('#comps-summary');
const compsBodyEl = document.querySelector('#comps-table tbody');
const marketStatsEl = document.querySelector('#market-stats');
const routesEl = document.querySelector('#routes');
const summaryEl = document.querySelector('#summary');
const submitButtonEl = form.querySelector('button[type="submit"]');

let activeRequestId = 0;
let heatmapPointsPromise;

const milesToMeters = (miles) => miles * 1609.34;
const metersToMiles = (meters) => meters / 1609.34;

const map = L.map('map').setView([38.9, -77.1], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const layers = {
  subject: null,
  circles: [],
  comps: []
};

const assetTypeProfiles = {
  Industrial: { vacancyBase: 0.051, rentBase: 13.2, absorptionFactor: 1.18 },
  Office: { vacancyBase: 0.173, rentBase: 34.5, absorptionFactor: 0.85 },
  Retail: { vacancyBase: 0.091, rentBase: 27.9, absorptionFactor: 0.92 },
  Multifamily: { vacancyBase: 0.064, rentBase: 2.45, absorptionFactor: 1.08 }
};

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seeded(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return metersToMiles(R * c);
}

async function geocodeWithNominatim(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`Nominatim failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.length) {
    throw new Error('Nominatim returned no results');
  }

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    displayName: data[0].display_name
  };
}

async function geocodeWithPhoton(address) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', address);
  url.searchParams.set('limit', '1');

  const res = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`Photon failed (${res.status})`);
  }

  const data = await res.json();
  const feature = data?.features?.[0];
  if (!feature) {
    throw new Error('Photon returned no results');
  }

  const [lng, lat] = feature.geometry.coordinates;
  const props = feature.properties || {};
  const pieces = [props.name, props.city, props.state, props.country].filter(Boolean);

  return {
    lat: Number(lat),
    lng: Number(lng),
    displayName: pieces.join(', ') || address
  };
}

async function geocode(address) {
  try {
    return await geocodeWithNominatim(address);
  } catch (_) {
    try {
      return await geocodeWithPhoton(address);
    } catch {
      throw new Error('Unable to locate that address right now. Please try a fuller street/city/state format.');
    }
  }
}

async function loadHeatmapPoints() {
  if (!heatmapPointsPromise) {
    heatmapPointsPromise = fetch('./Heatmap.json').then((res) => res.json());
  }
  return heatmapPointsPromise;
}

function clearOutputPanels() {
  demographicsEl.innerHTML = '';
  compsSummaryEl.textContent = '';
  compsBodyEl.innerHTML = '';
  marketStatsEl.innerHTML = '';
  routesEl.innerHTML = '';
  summaryEl.innerHTML = '';
}

function clearMapLayers() {
  if (layers.subject) {
    layers.subject.remove();
  }
  layers.circles.forEach((c) => c.remove());
  layers.comps.forEach((c) => c.remove());
  layers.circles = [];
  layers.comps = [];
}

function drawSubjectAndRings(subject, assetType) {
  clearMapLayers();
  layers.subject = L.marker([subject.lat, subject.lng]).addTo(map).bindPopup(`<strong>Subject (${assetType})</strong><br>${subject.displayName}`);

  const circles = [
    { label: '2 mi', miles: 2, color: '#2265d8' },
    { label: '5 mi', miles: 5, color: '#2ea44f' },
    { label: '10 mi', miles: 10, color: '#c88700' },
    { label: '20-min drive (proxy)', miles: 11.7, color: '#9f3ab9' }
  ];

  circles.forEach((ring) => {
    layers.circles.push(
      L.circle([subject.lat, subject.lng], {
        radius: milesToMeters(ring.miles),
        color: ring.color,
        fillOpacity: 0.06
      })
        .addTo(map)
        .bindTooltip(ring.label)
    );
  });

  map.setView([subject.lat, subject.lng], 11);
}

function generateDemographics(subject, assetType) {
  const baseSeed = hashCode(`${subject.lat.toFixed(4)}|${subject.lng.toFixed(4)}|${assetType}`);
  const radiusProfiles = [
    { label: '2-mile radius', miles: 2 },
    { label: '5-mile radius', miles: 5 },
    { label: '10-mile radius', miles: 10 },
    { label: '20-minute drive-time proxy', miles: 11.7 }
  ];

  return radiusProfiles.map((ring, i) => {
    const noise = seeded(baseSeed + i * 11);
    const area = Math.PI * ring.miles * ring.miles;
    const popDensity = Math.round(2800 + noise * 4200 - ring.miles * 45);
    const households = Math.round(area * (popDensity / 2.35));
    const medianIncome = Math.round(62000 + noise * 70000 + ring.miles * 1500);
    const avgIncome = Math.round(medianIncome * (1.18 + noise * 0.14));

    return {
      ring: ring.label,
      populationDensity: popDensity,
      medianIncome,
      averageIncome: avgIncome,
      households
    };
  });
}

function renderDemographics(rows) {
  demographicsEl.innerHTML = rows
    .map(
      (row) => `
      <div class="kpi" style="margin-bottom:0.7rem;">
        <div class="label">${row.ring}</div>
        <div class="value">${row.populationDensity.toLocaleString()} people / sq mi</div>
        <div class="muted">Median HH Income: $${row.medianIncome.toLocaleString()} · Avg HH Income: $${row.averageIncome.toLocaleString()} · Households: ${row.households.toLocaleString()}</div>
      </div>
    `
    )
    .join('');
}

function buildComps(subject, assetType, subjectSF, filters, rawPoints) {
  const minSf = subjectSF * 0.5;
  const maxSf = subjectSF * 1.5;
  const profile = assetTypeProfiles[assetType];

  return rawPoints
    .map((p, idx) => {
      const distance = haversineMiles(subject.lat, subject.lng, p.lat, p.lng);
      const seed = hashCode(`${idx}|${assetType}`);
      const sf = Math.round(15000 + seeded(seed) * 110000);
      const clearHeight = Math.round(12 + seeded(seed + 99) * 30);
      const yearBuilt = 1970 + Math.round(seeded(seed + 199) * 55);
      const askRent = Number((profile.rentBase * (0.75 + seeded(seed + 299) * 0.5)).toFixed(2));

      return {
        id: idx,
        name: `${assetType} Comp ${idx + 1}`,
        lat: p.lat,
        lng: p.lng,
        type: assetType,
        distance,
        sf,
        clearHeight,
        yearBuilt,
        askRent
      };
    })
    .filter((c) => c.distance <= 5 && c.sf >= minSf && c.sf <= maxSf)
    .filter((c) => c.clearHeight >= filters.minClearHeight)
    .filter((c) => c.yearBuilt >= filters.yearBuiltMin && c.yearBuilt <= filters.yearBuiltMax)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 40);
}

function renderComps(comps) {
  compsBodyEl.innerHTML = comps
    .map(
      (comp) => `
      <tr>
        <td>${comp.name}</td>
        <td>${comp.type}</td>
        <td>${comp.sf.toLocaleString()}</td>
        <td>${comp.clearHeight} ft</td>
        <td>${comp.yearBuilt}</td>
        <td>${comp.distance.toFixed(2)}</td>
        <td>$${comp.askRent.toFixed(2)}</td>
      </tr>
    `
    )
    .join('');

  compsSummaryEl.textContent = comps.length
    ? `${comps.length} comps match the selected criteria.`
    : 'No comps met the filter criteria. Try lowering min clear height or widening year-built range.';
}

function plotCompsOnMap(comps) {
  comps.forEach((comp) => {
    const marker = L.circleMarker([comp.lat, comp.lng], {
      radius: 5,
      color: '#1f5cc1',
      fillOpacity: 0.85
    })
      .addTo(map)
      .bindPopup(`<strong>${comp.name}</strong><br/>${comp.sf.toLocaleString()} SF · ${comp.distance.toFixed(2)} mi`);
    layers.comps.push(marker);
  });
}

function buildMarketStats(comps, assetType) {
  const profile = assetTypeProfiles[assetType];
  const avgRent = comps.length ? comps.reduce((sum, c) => sum + c.askRent, 0) / comps.length : profile.rentBase;
  const avgYear = comps.length ? comps.reduce((sum, c) => sum + c.yearBuilt, 0) / comps.length : 2000;
  const avgDist = comps.length ? comps.reduce((sum, c) => sum + c.distance, 0) / comps.length : 2.8;

  const vacancyRate = Math.max(0.02, profile.vacancyBase + (avgDist - 2.5) * 0.007 - (avgYear - 2000) * 0.0003);
  const netAbsorption = Math.round((120000 + comps.length * 4600) * profile.absorptionFactor);

  return {
    vacancyRate,
    netAbsorption,
    avgAskingRent: avgRent
  };
}

function renderMarketStats(stats, assetType, subject) {
  const unit = assetType === 'Multifamily' ? '$/SF/mo' : '$/SF/yr';
  marketStatsEl.innerHTML = `
    <div class="kpi" style="grid-column: 1 / -1;">
      <div class="label">Subject analyzed</div>
      <div class="value" style="font-size:1rem;">${subject.displayName}</div>
    </div>
    <div class="kpi">
      <div class="label">Vacancy rate</div>
      <div class="value">${(stats.vacancyRate * 100).toFixed(1)}%</div>
    </div>
    <div class="kpi">
      <div class="label">Net absorption (12 mo)</div>
      <div class="value">${stats.netAbsorption.toLocaleString()} SF</div>
    </div>
    <div class="kpi">
      <div class="label">Average asking rents</div>
      <div class="value">$${stats.avgAskingRent.toFixed(2)} ${unit}</div>
    </div>
  `;
}

function normalizeRouteName(tags) {
  const ref = tags.ref ? tags.ref.trim() : '';
  const name = tags.name ? tags.name.trim() : '';
  if (ref && name) {
    return `${ref} (${name})`;
  }
  return ref || name || 'Unnamed route';
}

async function fetchNearbyRoutes(subject, radiusMiles = 20) {
  const query = `
[out:json][timeout:25];
(
  way(around:${Math.round(milesToMeters(radiusMiles))},${subject.lat},${subject.lng})[highway~"motorway|trunk|primary"];
);
out tags center;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: `data=${encodeURIComponent(query)}`
  });

  if (!res.ok) {
    throw new Error(`Route lookup failed (${res.status})`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const deduped = new Map();
  elements.forEach((el) => {
    const tags = el.tags || {};
    if (!el.center || !tags.highway) {
      return;
    }

    const label = normalizeRouteName(tags);
    if (label === 'Unnamed route') {
      return;
    }

    const distance = haversineMiles(subject.lat, subject.lng, el.center.lat, el.center.lon);
    const existing = deduped.get(label);
    if (!existing || distance < existing.distance) {
      deduped.set(label, { name: label, distance });
    }
  });

  return Array.from(deduped.values()).sort((a, b) => a.distance - b.distance).slice(0, 8);
}

async function renderRouteDistances(subject) {
  routesEl.innerHTML = '<li class="muted">Looking up nearby major routes...</li>';
  try {
    const ranked = await fetchNearbyRoutes(subject, 20);
    if (!ranked.length) {
      routesEl.innerHTML = '<li>No major interstates/routes found within 20 miles.</li>';
      return [];
    }

    routesEl.innerHTML = `<li class="muted">Subject: ${subject.displayName}</li>${ranked
      .map((route) => `<li><strong>${route.name}</strong>: ${route.distance.toFixed(2)} miles</li>`)
      .join('')}`;

    return ranked;
  } catch {
    routesEl.innerHTML = '<li>Unable to retrieve nearby routes dynamically right now.</li>';
    return [];
  }
}

function renderSummary({ assetType, demographics, comps, marketStats, routes, subjectSF, subject }) {
  const closeRoutes = routes.slice(0, 2).map((r) => r.name).join(' and ');
  const routeSentence = closeRoutes
    ? `Regional access is a major strength, with immediate connectivity to ${closeRoutes}.`
    : 'Regional access appears reasonable, but dynamic route-service data was unavailable for this run.';
  const fiveMile = demographics.find((d) => d.ring.includes('5-mile'));
  const incomeSignal = fiveMile.medianIncome > 90000 ? 'strong household purchasing power' : 'moderate household purchasing power';
  const vacancySignal = marketStats.vacancyRate < 0.08 ? 'tight' : marketStats.vacancyRate < 0.14 ? 'balanced' : 'soft';

  summaryEl.innerHTML = `
    <p class="muted"><strong>Analyzed location:</strong> ${subject.displayName}</p>
    <p>
      The ${subjectSF.toLocaleString()} SF ${assetType.toLowerCase()} asset sits in a trade area with ${incomeSignal}, with median household income of
      approximately $${fiveMile.medianIncome.toLocaleString()} in the 5-mile band.
    </p>
    <p>
      Competitive supply appears ${vacancySignal}: ${comps.length} comparable properties met your filters inside 5 miles and ±50% of subject size,
      with average asking rents around $${marketStats.avgAskingRent.toFixed(2)}.
    </p>
    <p>
      ${routeSentence} This supports tenant retention and future leasing velocity.
    </p>
    <p>
      Macro commentary: the broader MSA benefits from diversified employment (government, technology, and professional services), ongoing infrastructure
      investment, and above-average long-run population growth versus many peer markets, which should support durable demand over a full hold period.
    </p>
    <p class="muted">This prototype blends live geocoding with modeled market/demographic estimates. Plug in premium data APIs for production underwriting.</p>
  `;
}

async function handleSubmit(event) {
  event.preventDefault();
  const requestId = ++activeRequestId;
  statusEl.textContent = 'Analyzing...';
  submitButtonEl.disabled = true;
  clearOutputPanels();

  try {
    const address = document.querySelector('#address').value.trim();
    const assetType = document.querySelector('#asset-type').value;
    const subjectSF = Number(document.querySelector('#square-feet').value);
    const filters = {
      minClearHeight: Number(document.querySelector('#min-clear-height').value),
      yearBuiltMin: Number(document.querySelector('#year-built-min').value),
      yearBuiltMax: Number(document.querySelector('#year-built-max').value)
    };

    const [subject, rawPoints] = await Promise.all([geocode(address), loadHeatmapPoints()]);
    if (requestId !== activeRequestId) {
      return;
    }

    drawSubjectAndRings(subject, assetType);

    const demographics = generateDemographics(subject, assetType);
    renderDemographics(demographics);

    const comps = buildComps(subject, assetType, subjectSF, filters, rawPoints);
    renderComps(comps);
    plotCompsOnMap(comps);

    const marketStats = buildMarketStats(comps, assetType);
    renderMarketStats(marketStats, assetType, subject);

    const routes = await renderRouteDistances(subject);
    if (requestId !== activeRequestId) {
      return;
    }

    renderSummary({
      assetType,
      demographics,
      comps,
      marketStats,
      routes,
      subjectSF,
      subject
    });

    statusEl.textContent = `Analysis complete for ${subject.displayName}.`;
  } catch (error) {
    if (requestId === activeRequestId) {
      statusEl.textContent = error.message;
    }
  } finally {
    if (requestId === activeRequestId) {
      submitButtonEl.disabled = false;
    }
  }
}

form.addEventListener('submit', handleSubmit);
