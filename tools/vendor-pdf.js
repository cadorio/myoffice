'use strict';

// Converte o pdf.js (módulos ES) em scripts clássicos para src/vendor, para que a aplicação os
// carregue com <script> a partir de ficheiros locais, sem rede nem módulos.
// O motor do pdf.js corre na própria página (sem Worker): é o que funciona em file://.
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const out = path.join(root, 'src', 'vendor');
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8')).version;
const banner = (name) => `/* ${name} ${version} — Mozilla Foundation, Apache License 2.0. Gerado por tools/vendor-pdf.js. */`;

for (const [entry, file, globalName] of [
  ['node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdf.js', 'pdfjsLib'],
  ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.js', 'pdfjsWorkerModule']
]) {
  esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(out, file),
    bundle: true,
    format: 'iife',
    globalName,
    minify: true,
    legalComments: 'none',
    banner: { js: banner(file === 'pdf.js' ? 'pdf.js' : 'pdf.js worker') },
    target: 'chrome120',
    logLevel: 'warning'
  });
}
fs.copyFileSync(path.join(root, 'node_modules/pdf-lib/dist/pdf-lib.min.js'), path.join(out, 'pdf-lib.js'));
// O mapa de código não é distribuído; retira a referência para não gerar pedidos.
const lib = path.join(out, 'pdf-lib.js');
fs.writeFileSync(lib, fs.readFileSync(lib, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/m, ''));
console.log('Bibliotecas de PDF atualizadas: pdf.js ' + version + ', pdf-lib');
