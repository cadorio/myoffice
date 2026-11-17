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
  { name: 'pdf.js', version: version('pdfjs-dist'), url: 'https://github.com/mozilla/pdf.js', license: read('node_modules/pdfjs-dist/LICENSE'), note: 'Leitura e desenho de ficheiros PDF no programa PDF.' },
  { name: 'pdf-lib', version: version('pdf-lib'), url: 'https://github.com/Hopding/pdf-lib', license: read('node_modules/pdf-lib/LICENSE.md'), note: 'Gravação de ficheiros PDF com anotações, assinaturas e páginas reorganizadas.' },
  { name: 'sql.js', version: version('sql.js'), url: 'https://github.com/sql-js/sql.js', license: read('node_modules/sql.js/LICENSE'), note: 'Motor SQLite (domínio público) compilado para WebAssembly, usado no programa Bases de dados.' },
  { name: 'mdb-reader', version: version('mdb-reader'), url: 'https://github.com/andipaetzold/mdb-reader', license: read('node_modules/mdb-reader/LICENSE'), note: 'Leitura de ficheiros do Microsoft Access (.accdb, .mdb) para importação.' },
  { name: 'pako', version: version('mdb-reader/node_modules/pako'), url: 'https://github.com/nodeca/pako', license: read('node_modules/mdb-reader/node_modules/pako/LICENSE'), note: 'Descompressão usada pelo leitor de ficheiros do Access.' },
  { name: 'fast-xml-parser', version: version('fast-xml-parser'), url: 'https://github.com/NaturalIntelligence/fast-xml-parser', license: read('node_modules/fast-xml-parser/LICENSE'), note: 'Leitura de XML usada pelo leitor de ficheiros do Access.' },
  { name: 'buffer', version: version('buffer'), url: 'https://github.com/feross/buffer', license: read('node_modules/buffer/LICENSE'), note: 'Suporte de dados binários usado pelo leitor de ficheiros do Access.' },
  { name: 'base64-js', version: version('base64-js'), url: 'https://github.com/beatgammit/base64-js', license: read('node_modules/base64-js/LICENSE'), note: 'Dependência do pacote buffer.' },
  { name: 'ieee754', version: version('ieee754'), url: 'https://github.com/feross/ieee754', license: read('node_modules/ieee754/LICENSE'), note: 'Dependência do pacote buffer.' },
  { name: 'strnum', version: version('strnum'), url: 'https://github.com/NaturalIntelligence/strnum', license: read('node_modules/strnum/LICENSE'), note: 'Dependência do fast-xml-parser.' },
  { name: 'fflate', version: version('fflate'), url: 'https://github.com/101arrowz/fflate', license: read('node_modules/fflate/LICENSE'), note: 'Compressão ZIP, usada para ler e escrever ficheiros .docx, .xlsx e .pptx.' }
];

const own = `MyOffice ${JSON.parse(read('package.json')).version}\nhttps://github.com/cadorio/myoffice\nLicenciado sob a Licença Apache, versão 2.0. O texto completo está no ficheiro LICENSE.\n\nCopyright 2026 cadorio\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.`;
const text = [own, ...components.map((c) => `${c.name} ${c.version}\n${c.url}\n${c.note}\n\n${c.license}`)].join('\n\n' + '-'.repeat(72) + '\n\n');

fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), `# Avisos de licença de terceiros\n\nEsta aplicação inclui os seguintes componentes.\n\n\`\`\`\n${text}\n\`\`\`\n`);
fs.writeFileSync(
  path.join(root, 'src/js/notices.js'),
  `'use strict';\n\n// Ficheiro gerado por tools/notices.js. Não editar à mão.\n(window.MO = window.MO || {}).NOTICES = ${JSON.stringify(text)};\n`
);
console.log(`Avisos gerados para: ${components.map((c) => `${c.name} ${c.version}`).join(', ')}`);
