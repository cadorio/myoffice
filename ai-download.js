'use strict';

// Descarrega um ficheiro grande (o modelo de IA) com verificação de integridade.
// Sem dependências do Electron, para poder ser testado em Node.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');

// Devolve true se o ficheiro existir com o tamanho esperado.
async function isInstalled(file, bytes) {
  try {
    return (await fsp.stat(file)).size === bytes;
  } catch {
    return false;
  }
}

// opts: { url, dest, bytes, sha256, allowedHost(hostname) -> bool, onProgress(recebidos, total), signal }
// O ficheiro só fica em `dest` depois de o tamanho e o SHA-256 conferirem.
async function download(opts) {
  const part = opts.dest + '.part';
  const hash = crypto.createHash('sha256');
  let received = 0;
  let handle = null;
  try {
    const response = await fetch(opts.url, { redirect: 'follow', signal: opts.signal });
    // O servidor redireciona para uma rede de distribuição; só se aceitam anfitriões conhecidos, por HTTPS.
    const final = new URL(response.url);
    if (!opts.allowedHost(final.hostname) || (final.protocol !== 'https:' && !opts.allowInsecure)) throw new Error('Origem do ficheiro não autorizada.');
    if (!response.ok || !response.body) throw new Error(`O servidor respondeu com o código ${response.status}.`);
    await fsp.mkdir(require('path').dirname(opts.dest), { recursive: true });
    handle = await fsp.open(part, 'w');
    let lastReport = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > opts.bytes) throw new Error('O ficheiro recebido é maior do que o esperado.');
      hash.update(chunk);
      await handle.write(chunk);
      const now = Date.now();
      if (opts.onProgress && now - lastReport > 400) {
        lastReport = now;
        opts.onProgress(received, opts.bytes);
      }
    }
    await handle.close();
    handle = null;
    if (received !== opts.bytes) throw new Error('O descarregamento ficou incompleto.');
    if (hash.digest('hex') !== opts.sha256) throw new Error('O ficheiro descarregado não corresponde ao original (verificação de integridade falhou).');
    await fsp.rename(part, opts.dest);
    if (opts.onProgress) opts.onProgress(received, opts.bytes);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    fs.rmSync(part, { force: true });
    if (error.name === 'AbortError') throw new Error('Descarregamento cancelado.');
    throw error;
  }
}

module.exports = { download, isInstalled };
