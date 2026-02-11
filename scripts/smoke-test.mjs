import { spawn } from 'node:child_process';

const port = 4173;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 25) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      lastErr = err;
    }
    await wait(200);
  }
  throw lastErr;
}

const server = spawn('node', ['server.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', () => {});
server.stderr.on('data', () => {});

try {
  const indexRes = await fetchWithRetry(`${baseUrl}/`);
  const indexHtml = await indexRes.text();

  if (!indexHtml.includes('Asset Intelligence Workbench') || !indexHtml.includes('id="asset-form"')) {
    throw new Error('Index page does not contain expected app shell markers.');
  }

  const dataRes = await fetchWithRetry(`${baseUrl}/Heatmap.json`);
  const data = await dataRes.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Heatmap.json did not return a non-empty array.');
  }

  console.log('Smoke test passed: app shell and Heatmap data are reachable.');
} finally {
  server.kill('SIGTERM');
}
