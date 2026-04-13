#!/usr/bin/env node
// extract-cookies.js — Extract cookies from Datadog Chrome profile via CDP
// Connects to Chrome on remote debugging port 9223 (headless extraction)
// Falls back to 9222 (interactive session)

const http = require('http');

const primaryPort = Number.parseInt(process.env.DATADOG_CHROME_CDP_PORT || '9223', 10);
const PORTS = [...new Set([primaryPort, 9223, 9222].filter(Number.isFinite))];
const DOMAIN = '.datadoghq.com';

function pickBestTarget(targets) {
  if (!Array.isArray(targets)) return null;

  const withWs = targets.filter((t) => t && t.webSocketDebuggerUrl);
  if (withWs.length === 0) return null;

  // Prefer the Datadog page target, then any page target, then fallback to first target with WS.
  return (
    withWs.find((t) => t.type === 'page' && String(t.url || '').includes('app.datadoghq.com')) ||
    withWs.find((t) => t.type === 'page') ||
    withWs[0]
  );
}

async function tryPort(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}/json`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const target = pickBestTarget(targets);
          if (target) {
            resolve({ port, wsUrl: target.webSocketDebuggerUrl, targetType: target.type, targetUrl: target.url });
          } else {
            reject(new Error('No suitable targets'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function getCookies(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 1;
    const requestId = id++;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: requestId,
        method: 'Network.getCookies',
        params: { urls: ['https://app.datadoghq.com'] }
      }));
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.id !== requestId) return;

      if (msg.error) {
        ws.close();
        reject(new Error(msg.error.message || 'CDP Network.getCookies failed'));
        return;
      }

      if (msg.result && Array.isArray(msg.result.cookies)) {
        const ddCookies = msg.result.cookies.filter((c) =>
          String(c.domain || '').endsWith('datadoghq.com')
        );
        ws.close();
        resolve(ddCookies);
      }
    });

    ws.on('error', reject);
    setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 10000);
  });
}

async function main() {
  // Try each port
  let connection;
  for (const port of PORTS) {
    try {
      connection = await tryPort(port);
      break;
    } catch (e) {
      continue;
    }
  }

  if (!connection) {
    process.stderr.write(`Error: No Chrome instance found on ports ${PORTS.join('/')}\n`);
    process.exit(1);
  }

  try {
    const cookies = await getCookies(connection.wsUrl);
    if (cookies.length === 0) {
      process.stderr.write('Error: No Datadog cookies found. Run "datadog login" first.\n');
      process.exit(1);
    }
    console.log(JSON.stringify(cookies));
  } catch (e) {
    process.stderr.write(`Error extracting cookies: ${e.message}\n`);
    process.exit(1);
  }
}

main();
