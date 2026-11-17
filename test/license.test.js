'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createKey, verifyKey, trialState, TRIAL_DAYS } = require('../license.js');

const pair = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};
const a = pair();
const b = pair();
const DAY = 86400000;

const key = createKey({ name: 'Ana Silva', issued: '2026-11-14' }, a.priv);
assert.deepEqual(verifyKey(key, a.pub), { valid: true, name: 'Ana Silva', expires: null });
assert.equal(verifyKey(`  ${key.slice(0, 20)}\n${key.slice(20)}  `, a.pub).valid, true, 'espaços e quebras de linha são ignorados');

// Chaves de outro emissor, adulteradas ou malformadas são recusadas.
assert.equal(verifyKey(key, b.pub).valid, false);
const [body, sig] = key.split('.');
const forged = Buffer.from(JSON.stringify({ name: 'Outro', issued: '2026-11-14' })).toString('base64url');
assert.equal(verifyKey(`${forged}.${sig}`, a.pub).valid, false);
assert.equal(verifyKey(`${body}.${sig.slice(0, -4)}AAAA`, a.pub).valid, false);
for (const bad of ['', 'abc', 'a.b.c', null, 42, {}, 'x'.repeat(5000)]) assert.equal(verifyKey(bad, a.pub).valid, false);
assert.equal(verifyKey(key, 'não é uma chave pública').valid, false);

// Validade: a licença vale até ao fim do dia indicado.
const dated = createKey({ name: 'Rui', expires: '2027-01-31' }, a.priv);
assert.equal(verifyKey(dated, a.pub, Date.parse('2027-01-31T20:00:00Z')).valid, true);
const late = verifyKey(dated, a.pub, Date.parse('2027-02-02T00:00:00Z'));
assert.equal(late.valid, false);
assert.equal(late.reason, 'A licença expirou.');

// Período experimental.
const now = Date.parse('2026-11-14T12:00:00Z');
assert.equal(trialState(now, now).daysLeft, TRIAL_DAYS);
assert.equal(trialState(now - 10 * DAY, now).daysLeft, TRIAL_DAYS - 10);
assert.equal(trialState(now - 400 * DAY, now).daysLeft, 0);
assert.equal(trialState(now + 5 * DAY, now).daysLeft, TRIAL_DAYS, 'um relógio atrasado não dá dias extra');

console.log('Testes de licenciamento passaram.');
