'use strict';

// Prepara as bibliotecas do programa Bases de dados em src/vendor (scripts clássicos, sem rede):
// - sql.js: o motor SQLite, com o WebAssembly embutido no próprio script;
// - mdb-reader: leitura de ficheiros do Microsoft Access (.accdb, .mdb), só para importar.
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor');
const version = (p) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', p, 'package.json'), 'utf8')).version;

fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm-inline.js'), path.join(out, 'sql.js'));

const entry = path.join(__dirname, '.mdb-entry.mjs');
// As bibliotecas de encriptação só servem para ficheiros Access protegidos por palavra-passe e
// dependem do Node; são trocadas por um aviso (esses ficheiros não são importados).
const stub = path.join(__dirname, '.mdb-crypto-stub.js');
// O mdb-reader usa o Buffer global do Node; no browser vem do pacote "buffer".
fs.writeFileSync(path.join(__dirname, '.mdb-buffer.mjs'), "export { Buffer } from 'buffer';\n");
fs.writeFileSync(stub, "const no = () => { throw new Error('Ficheiros Access encriptados não são suportados.'); };\nmodule.exports = no;\nmodule.exports.createDecipheriv = no;\n");
fs.writeFileSync(entry, "import MDBReader from 'mdb-reader';\nimport { Buffer } from 'buffer';\nexport { MDBReader, Buffer };\n");
try {
  esbuild.build({
    entryPoints: [entry],
    outfile: path.join(out, 'mdb-reader.js'),
    bundle: true,
    format: 'iife',
    globalName: 'MDBReaderLib',
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    target: 'chrome120',
    define: { global: 'globalThis' },
    plugins: [{ name: 'sem-encriptacao', setup(b) { b.onResolve({ filter: /^(create-hash|browserify-aes)(\/.*)?$/ }, () => ({ path: stub })); } }],
    inject: [path.join(__dirname, '.mdb-buffer.mjs')],
    banner: { js: `/* mdb-reader ${version('mdb-reader')} (MIT) e dependências; buffer ${version('buffer')} (MIT). Gerado por tools/vendor-db.js. */` },
    logLevel: 'warning'
  }).then(() => console.log(`Bibliotecas de bases de dados atualizadas: sql.js ${version('sql.js')}, mdb-reader ${version('mdb-reader')}`))
    .finally(() => { for (const f of [entry, stub, path.join(__dirname, '.mdb-buffer.mjs')]) fs.rmSync(f, { force: true }); });
} finally {
  // os ficheiros temporários são apagados quando a compilação termina
}
