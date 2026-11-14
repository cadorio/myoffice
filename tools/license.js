#!/usr/bin/env node
'use strict';

// Ferramenta do vendedor para gerir chaves de licença. Não faz parte da aplicação instalada.
//
//   node tools/license.js init
//       Cria o par de chaves. A pública (license-public.pem) vai com a aplicação;
//       a privada (license-private.pem) fica só consigo e NUNCA deve ir para o repositório.
//
//   node tools/license.js issue "Nome do cliente" [AAAA-MM-DD]
//       Emite uma chave para esse cliente, opcionalmente com data de validade.
//
//   node tools/license.js check <chave>
//       Verifica uma chave.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createKey, verifyKey } = require('../license');

const root = path.join(__dirname, '..');
const publicFile = path.join(root, 'license-public.pem');
const privateFile = process.env.LICENSE_PRIVATE_KEY || path.join(root, 'license-private.pem');
const [command, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (command === 'init') {
  if (fs.existsSync(privateFile) || fs.existsSync(publicFile)) fail('Já existem chaves. Apagar a chave privada invalida todas as licenças já emitidas.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicFile, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`Chave pública:  ${publicFile}  (incluir no repositório)`);
  console.log(`Chave privada:  ${privateFile}  (guardar em local seguro, com cópia de segurança)`);
} else if (command === 'issue') {
  const [name, expires] = args;
  if (!name) fail('Uso: node tools/license.js issue "Nome do cliente" [AAAA-MM-DD]');
  if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires)))) fail('A data de validade tem de ter o formato AAAA-MM-DD.');
  if (!fs.existsSync(privateFile)) fail('Falta a chave privada. Execute primeiro: node tools/license.js init');
  const payload = { name, issued: new Date().toISOString().slice(0, 10) };
  if (expires) payload.expires = expires;
  console.log(createKey(payload, fs.readFileSync(privateFile, 'utf8')));
} else if (command === 'check') {
  if (!args[0] || !fs.existsSync(publicFile)) fail('Uso: node tools/license.js check <chave>  (requer license-public.pem)');
  console.log(verifyKey(args[0], fs.readFileSync(publicFile, 'utf8')));
} else {
  fail('Comandos: init | issue "Nome" [AAAA-MM-DD] | check <chave>');
}
