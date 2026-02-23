import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dappHtmlPath = path.resolve(__dirname, 'fixtures', 'dapp.html');
const dappHtml = await readFile(dappHtmlPath, 'utf8');

const dappPort = Number(process.env.DW_E2E_DAPP_PORT ?? '4173');
const backendPort = Number(process.env.DW_E2E_BACKEND_PORT ?? '4000');

const jsonHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,project_id',
};

const toHexHash = (input) => crypto.createHash('sha256').update(input).digest('hex');

const dappServer = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  if (req.url === '/' || req.url?.startsWith('/index.html')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(dappHtml);
    return;
  }

  res.writeHead(404, jsonHeaders);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const backendServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, jsonHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, jsonHeaders);
    res.end(
      JSON.stringify({
        ok: true,
        network: 'preview',
        processRole: 'all',
      }),
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/cardano/submit-tx') {
    const bodyBuffer = await parseBody(req);
    const raw = bodyBuffer.toString('utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.writeHead(400, jsonHeaders);
      res.end(JSON.stringify({ message: 'Invalid JSON' }));
      return;
    }

    const txCborHex = String(parsed?.txCborHex ?? '').trim();
    if (!/^[0-9a-fA-F]+$/.test(txCborHex) || txCborHex.length % 2 !== 0) {
      res.writeHead(400, jsonHeaders);
      res.end(JSON.stringify({ message: 'txCborHex must be an even-length hex string' }));
      return;
    }

    const txHash = toHexHash(txCborHex);
    res.writeHead(200, jsonHeaders);
    res.end(JSON.stringify({ txHash }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/addresses/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const address = decodeURIComponent(parts[1] ?? '');

    if (parts[2] === 'utxos') {
      res.writeHead(200, jsonHeaders);
      res.end(
        JSON.stringify([
          {
            tx_hash: 'ab'.repeat(32),
            tx_index: 0,
            output_index: 0,
            address,
            amount: [{ unit: 'lovelace', quantity: '900000000' }],
            block: 'mock-block',
            data_hash: null,
            inline_datum: null,
            reference_script_hash: null,
          },
        ]),
      );
      return;
    }

    if (parts[2] === 'transactions') {
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify([]));
      return;
    }

    res.writeHead(200, jsonHeaders);
    res.end(
      JSON.stringify({
        address,
        amount: [
          { unit: 'lovelace', quantity: '123456789' },
          { unit: `${'cd'.repeat(28)}746f6b656e`, quantity: '42' },
        ],
        tx_count: 3,
      }),
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/epochs/latest/parameters') {
    res.writeHead(200, jsonHeaders);
    res.end(
      JSON.stringify({
        min_fee_a: 44,
        min_fee_b: 155381,
        max_tx_size: 16384,
        max_val_size: '5000',
        key_deposit: '2000000',
        pool_deposit: '500000000',
        coins_per_utxo_byte: '4310',
      }),
    );
    return;
  }

  if (req.method === 'POST' && url.pathname === '/tx/submit') {
    const body = await parseBody(req);
    if (!body.length) {
      res.writeHead(400, jsonHeaders);
      res.end(JSON.stringify({ message: 'Missing transaction body' }));
      return;
    }
    const txHash = toHexHash(body);
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(txHash);
    return;
  }

  res.writeHead(404, jsonHeaders);
  res.end(JSON.stringify({ message: 'Not found' }));
});

dappServer.listen(dappPort, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-extension] dApp server listening on http://127.0.0.1:${dappPort}`);
});
backendServer.listen(backendPort, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-extension] backend + blockfrost mock listening on http://127.0.0.1:${backendPort}`);
});

const closeAll = () => {
  dappServer.close();
  backendServer.close();
};

process.on('SIGINT', closeAll);
process.on('SIGTERM', closeAll);
