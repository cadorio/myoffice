'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.equal(lock.name, pkg.name, 'O nome do pacote deve coincidir com o lockfile.');
assert.equal(lock.version, pkg.version, 'A versão principal do lockfile deve coincidir com package.json.');
assert.equal(lock.packages[''].name, pkg.name, 'O pacote raiz do lockfile deve ter o mesmo nome.');
assert.equal(lock.packages[''].version, pkg.version, 'A versão do pacote raiz do lockfile deve coincidir com package.json.');

console.log('Metadados npm coerentes:', pkg.name, pkg.version);
