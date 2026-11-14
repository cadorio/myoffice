#!/usr/bin/env node
'use strict';

// Gera os avisos de licença dos componentes de terceiros incluídos na aplicação:
// THIRD-PARTY-NOTICES.md (para o repositório e o instalador) e src/js/notices.js (mostrado em Ficheiro › Acerca).
// Executar depois de atualizar dependências: npm run notices

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').trim();
const version = (pkg) => JSON.parse(read(`node_modules/${pkg}/package.json`)).version;

const components = [
  {
    name: 'Electron',
    version: version('electron'),
    url: 'https://github.com/electron/electron',
    license: read('node_modules/electron/LICENSE'),
    note: 'Inclui o Chromium e o Node.js; os avisos de licença completos desses projetos estão no ficheiro LICENSES.chromium.html, na pasta de instalação.'
  },
  { name: 'fflate', version: version('fflate'), url: 'https://github.com/101arrowz/fflate', license: read('node_modules/fflate/LICENSE'), note: 'Compressão ZIP, usada para ler e escrever ficheiros .docx, .xlsx e .pptx.' }
];

const text = components.map((c) => `${c.name} ${c.version}\n${c.url}\n${c.note}\n\n${c.license}`).join('\n\n' + '-'.repeat(72) + '\n\n');

fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), `# Avisos de licença de terceiros\n\nEsta aplicação inclui os seguintes componentes.\n\n\`\`\`\n${text}\n\`\`\`\n`);
fs.writeFileSync(
  path.join(root, 'src/js/notices.js'),
  `'use strict';\n\n// Ficheiro gerado por tools/notices.js. Não editar à mão.\n(window.MO = window.MO || {}).NOTICES = ${JSON.stringify(text)};\n`
);
console.log(`Avisos gerados para: ${components.map((c) => `${c.name} ${c.version}`).join(', ')}`);
