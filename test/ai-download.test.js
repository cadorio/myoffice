'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { download, isInstalled } = require('../ai-download');

const data = crypto.randomBytes(300000);
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mo-dl-'));
const dest = path.join(dir, 'modelo.bin');

const server = http.createServer((req, res) => {
  if (req.url === '/redirect') return res.writeHead(302, { location: '/file' }).end();
  if (req.url === '/slow') {
    res.writeHead(200);
    res.write(data.subarray(0, 1000));
    return; // nunca termina: serve para testar o cancelamento
  }
  res.writeHead(req.url === '/missing' ? 404 : 200).end(req.url === '/short' ? data.subarray(0, 1000) : data);
});

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const opts = (extra) => ({ url: base + '/redirect', dest, bytes: data.length, sha256, allowedHost: (h) => h === '127.0.0.1', allowInsecure: true, ...extra });
  const fails = async (extra, pattern) => {
    await assert.rejects(download(opts(extra)), pattern);
    assert.equal(fs.existsSync(dest), false, 'nada fica no destino quando falha');
    assert.equal(fs.existsSync(dest + '.part'), false, 'o ficheiro parcial é apagado');
  };
  try {
    await fails({ sha256: '0'.repeat(64) }, /integridade/);
    await fails({ url: base + '/short' }, /incompleto/);
    await fails({ bytes: 1000 }, /maior do que o esperado/);
    await fails({ url: base + '/missing' }, /código 404/);
    await fails({ allowedHost: () => false }, /não autorizada/);
    await fails({ allowInsecure: false }, /não autorizada/);
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 150);
    await fails({ url: base + '/slow', signal: abort.signal }, /cancelado/);

    let last = 0;
    await download(opts({ onProgress: (got) => (last = got) }));
    assert.equal(last, data.length);
    assert.ok(fs.readFileSync(dest).equals(data));
    assert.equal(await isInstalled(dest, data.length), true);
    assert.equal(await isInstalled(dest, data.length + 1), false);
    console.log('Testes do descarregamento do modelo passaram.');
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
