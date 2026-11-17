'use strict';

// Ligações a servidores (dbserver.js): validação e mensagens, sem precisar de um servidor real.
const assert = require('node:assert/strict');
const os = require('os');
const { createManager } = require('../dbserver.js');

const handlers = {};
const manager = createManager({ getPath: () => os.tmpdir() }, { isEncryptionAvailable: () => false });
manager.register({ handle: (name, fn) => (handlers[name] = fn) }, (event) => event.trusted === true);
const call = (name, ...args) => handlers['dbs:' + name]({ trusted: true }, ...args);

(async () => {
  // Só a janela autorizada pode usar as ligações.
  assert.equal((await handlers['dbs:saved']({ trusted: false })).ok, false);
  // Endereços, portas e tipos inválidos são recusados antes de qualquer ligação.
  assert.match((await call('connect', { kind: 'oracle', host: 'x' })).error, /Tipo de servidor/);
  assert.match((await call('connect', { kind: 'mysql', host: 'a b; rm -rf /' })).error, /Endereço/);
  assert.match((await call('connect', { kind: 'postgres', host: 'localhost', port: 70000 })).error, /Porta/);
  // Servidor que não está a correr: mensagem compreensível.
  const refused = await call('connect', { kind: 'postgres', host: '127.0.0.1', port: 1, user: 'x', password: 'y' });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /recusou|não respondeu/);
  // Sem ligação aberta, as operações falham com clareza.
  assert.match((await call('query', 'c999', 'SELECT 1')).error, /ligação foi fechada/);
  // Sem cofre seguro no sistema, a palavra-passe não é guardada.
  assert.match((await call('save', { kind: 'mysql', host: 'localhost', user: 'a', password: 'segredo' }, true)).error, /não permite guardar palavras-passe/);
  await manager.closeAll();
  console.log('Testes das ligações a servidores passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
