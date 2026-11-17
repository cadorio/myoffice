'use strict';

// Constrói um índice estatístico local a partir da documentação do MyOffice.
// Não importa modelos, dados ou bibliotecas de terceiros.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const output = path.join(root, 'src', 'ai-model.json');
const tokens = (text) => String(text || '').toLocaleLowerCase('pt-PT').normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{2,}/gu) || [];

function clean(line) {
  return line
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/\|/g, ' · ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const documents = [];
let section = 'MyOffice';
let paragraph = [];
let code = false;
function flush() {
  const text = clean(paragraph.join(' '));
  paragraph = [];
  if (text.length < 32 || /^[-:·\s]+$/.test(text)) return;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý"«(])/u);
  let chunk = '';
  for (const sentence of sentences) {
    const next = `${chunk}${chunk ? ' ' : ''}${sentence.trim()}`;
    if (next.length > 520 && chunk) {
      addDocument(chunk);
      chunk = sentence.trim();
    } else chunk = next;
  }
  if (chunk) addDocument(chunk);
}
function addDocument(text) {
  const terms = tokens(text);
  if (terms.length < 6) return;
  documents.push({ section, text, terms });
}

for (const line of source.split(/\r?\n/)) {
  if (/^\s*\|/.test(line) || /^\s*!\[/.test(line)) { flush(); continue; }
  if (/^\s*```/.test(line)) {
    flush();
    code = !code;
    continue;
  }
  const heading = line.match(/^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/);
  if (heading) {
    flush();
    section = clean(heading[1]) || 'MyOffice';
    continue;
  }
  if (!line.trim() || /^\s*\|?\s*:?-{3,}/.test(line)) {
    flush();
    continue;
  }
  if (code) {
    if (section === 'Desenvolvimento' || section === 'Estrutura') continue;
    const codeLine = clean(line);
    if (codeLine) addDocument(codeLine);
  } else {
    if (section === 'Índice' || section === 'Desenvolvimento' || section === 'Estrutura') continue;
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) flush();
    paragraph.push(line);
  }
}
flush();

const documentFrequency = new Map();
let totalTerms = 0;
for (const document of documents) {
  const counts = new Map();
  for (const term of document.terms) counts.set(term, (counts.get(term) || 0) + 1);
  document.length = document.terms.length;
  document.termFrequency = Object.fromEntries(counts);
  delete document.terms;
  totalTerms += document.length;
  for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
}

const idf = {};
for (const [term, frequency] of documentFrequency) {
  idf[term] = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
}
const model = {
  format: 1,
  source: 'README.md',
  documents,
  averageLength: documents.length ? totalTerms / documents.length : 0,
  idf
};
fs.writeFileSync(output, JSON.stringify(model));
console.log(`Índice MyOffice criado: ${documents.length} trechos, ${Object.keys(idf).length} termos.`);
