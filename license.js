'use strict';

// Licenciamento offline. Uma chave é um pequeno documento (nome, validade) assinado com Ed25519;
// a aplicação só traz a chave pública, por isso consegue verificar chaves mas não criá-las.
// Sem o ficheiro license-public.pem, o licenciamento fica desligado e a aplicação funciona sem limites.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const TRIAL_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 4096;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// Cria uma chave (usado só pela ferramenta tools/license.js, nunca pela aplicação).
function createKey(payload, privatePem) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privatePem));
  return `${body}.${b64url(signature)}`;
}

// Devolve { valid, name, expires, reason }.
function verifyKey(key, publicPem, now = Date.now()) {
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) return { valid: false, reason: 'A chave não é válida.' };
  const parts = key.trim().replace(/\s+/g, '').split('.');
  if (parts.length !== 2) return { valid: false, reason: 'A chave não é válida.' };
  try {
    const ok = crypto.verify(null, Buffer.from(parts[0]), crypto.createPublicKey(publicPem), Buffer.from(parts[1], 'base64url'));
    if (!ok) return { valid: false, reason: 'A chave não é válida.' };
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const name = typeof payload.name === 'string' ? payload.name.slice(0, 200) : '';
    const expires = typeof payload.expires === 'string' && !Number.isNaN(Date.parse(payload.expires)) ? payload.expires : null;
    if (expires && Date.parse(expires) + DAY <= now) return { valid: false, name, expires, reason: 'A licença expirou.' };
    return { valid: true, name, expires };
  } catch {
    return { valid: false, reason: 'A chave não é válida.' };
  }
}

// Estado do período experimental a partir da data da primeira utilização.
function trialState(firstRun, now = Date.now()) {
  const elapsed = Math.max(0, now - firstRun);
  return { daysLeft: Math.max(0, TRIAL_DAYS - Math.floor(elapsed / DAY)) };
}

function createManager(app) {
  const publicFile = path.join(__dirname, 'license-public.pem');
  const publicPem = fs.existsSync(publicFile) ? fs.readFileSync(publicFile, 'utf8') : null;
  const keyFile = () => path.join(app.getPath('userData'), 'license.key');
  const installFile = () => path.join(app.getPath('userData'), 'install.json');

  async function firstRun() {
    try {
      const saved = JSON.parse(await fsp.readFile(installFile(), 'utf8'));
      if (Number.isFinite(saved.firstRun)) return Math.min(saved.firstRun, Date.now());
    } catch {
      /* primeira utilização */
    }
    const now = Date.now();
    await fsp.writeFile(installFile(), JSON.stringify({ firstRun: now }), { mode: 0o600 }).catch(() => {});
    return now;
  }

  async function status() {
    if (!publicPem) return { enabled: false, canSave: true };
    let key = null;
    try {
      key = await fsp.readFile(keyFile(), 'utf8');
    } catch {
      key = null;
    }
    const check = key ? verifyKey(key, publicPem) : null;
    if (check && check.valid) return { enabled: true, licensed: true, canSave: true, name: check.name, expires: check.expires };
    const trial = trialState(await firstRun());
    return { enabled: true, licensed: false, canSave: trial.daysLeft > 0, trialDaysLeft: trial.daysLeft, reason: check ? check.reason : null };
  }

  async function activate(key) {
    if (!publicPem) return { error: 'O licenciamento não está configurado nesta versão.' };
    const check = verifyKey(key, publicPem);
    if (!check.valid) return { error: check.reason };
    await fsp.writeFile(keyFile(), String(key).trim(), { mode: 0o600 });
    return status();
  }

  return { status, activate };
}

module.exports = { createKey, verifyKey, trialState, createManager, TRIAL_DAYS };
