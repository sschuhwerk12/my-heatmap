import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = normalize(__dirname);
const port = Number(process.env.PORT || 4173);

const contentTypeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function resolvePath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split('?')[0]);
  const requested = cleaned === '/' ? '/index.html' : cleaned;
  const full = normalize(join(root, requested));

  if (!full.startsWith(root)) {
    return null;
  }

  return full;
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(payload));
}

async function geocodeWithNominatim(address) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'asset-intelligence-workbench/1.0 (local prototype)'
    }
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
    headers: {
      Accept: 'application/json',
      'User-Agent': 'asset-intelligence-workbench/1.0 (local prototype)'
    }
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

function milesToMeters(miles) {
  return miles * 1609.34;
}

function metersToMiles(meters) {
  return meters / 1609.34;
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

function normalizeRouteName(tags) {
  const ref = tags.ref ? tags.ref.trim() : '';
  const name = tags.name ? tags.name.trim() : '';
  if (ref && name) {
    return `${ref} (${name})`;
  }
  return ref || name || 'Unnamed route';
}

async function fetchNearbyRoutes(lat, lng, radiusMiles = 20) {
  const query = `
[out:json][timeout:25];
(
  way(around:${Math.round(milesToMeters(radiusMiles))},${lat},${lng})[highway~"motorway|trunk|primary"];
);
out tags center;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'asset-intelligence-workbench/1.0 (local prototype)'
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

    const distance = haversineMiles(lat, lng, el.center.lat, el.center.lon);
    const existing = deduped.get(label);
    if (!existing || distance < existing.distance) {
      deduped.set(label, { name: label, distance });
    }
  });

  return Array.from(deduped.values()).sort((a, b) => a.distance - b.distance).slice(0, 8);
}

const server = createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (reqUrl.pathname === '/api/geocode') {
      const q = (reqUrl.searchParams.get('q') || '').trim();
      if (!q) {
        jsonResponse(res, 400, { error: 'Missing required query parameter: q' });
        return;
      }

      try {
        const result = await geocodeWithNominatim(q);
        jsonResponse(res, 200, { result, provider: 'nominatim' });
        return;
      } catch {
        try {
          const result = await geocodeWithPhoton(q);
          jsonResponse(res, 200, { result, provider: 'photon' });
          return;
        } catch {
          jsonResponse(res, 502, {
            error: 'Unable to locate that address right now. Please try a fuller street/city/state format.'
          });
          return;
        }
      }
    }

    if (reqUrl.pathname === '/api/routes') {
      const lat = Number(reqUrl.searchParams.get('lat'));
      const lng = Number(reqUrl.searchParams.get('lng'));
      const radiusMiles = Number(reqUrl.searchParams.get('radiusMiles') || '20');

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        jsonResponse(res, 400, { error: 'Missing or invalid lat/lng query params' });
        return;
      }

      try {
        const routes = await fetchNearbyRoutes(lat, lng, radiusMiles);
        jsonResponse(res, 200, { routes });
      } catch {
        jsonResponse(res, 502, { error: 'Unable to retrieve nearby routes dynamically right now.' });
      }
      return;
    }

    const filePath = resolvePath(reqUrl.pathname || '/');

    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = contentTypeByExt[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    createReadStream(filePath).pipe(res);
  } catch {
    jsonResponse(res, 500, { error: 'Unexpected server error.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Asset Intelligence Workbench running at http://localhost:${port}`);
});
