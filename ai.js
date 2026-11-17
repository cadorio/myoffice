'use strict';

// Motor de consulta documental próprio, treinado sobre a documentação do MyOffice.
// Usa BM25 e regras locais; não carrega pesos pré-treinados nem liga à rede.
const Assistant = require('./src/js/assistant');
const model = require('./src/ai-model.json');

const STOP_WORDS = new Set('a ao aos as com como da das de do dos e em entre esta este foi na nas no nos o os ou para pela pelo por que se sem um uma'.split(' '));
const SYNONYMS = {
  apresentacao: ['diapositivos', 'slides'],
  diapositivo: ['apresentacao', 'slides'],
  folha: ['folhas', 'calculo', 'celulas'],
  celula: ['folha', 'celulas'],
  documento: ['texto', 'ficheiro'],
  gravar: ['guardar', 'exportar'],
  guardar: ['gravar', 'exportar'],
  instalar: ['instalacao', 'instalador'],
  formula: ['formulas', 'soma', 'media', 'procv'],
  importar: ['abrir', 'docx', 'xlsx', 'pptx'],
  exportar: ['guardar', 'pdf', 'docx', 'xlsx', 'pptx'],
  escuro: ['tema', 'aparencia'],
  noite: ['tema', 'aparencia']
};
const terms = (text) => String(text || '').toLocaleLowerCase('pt-PT').normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{2,}/gu) || [];

function latestQuestion(content) {
  const messages = [...String(content || '').matchAll(/(?:^|\n\n)Utilizador:\s*([\s\S]*?)(?=\n\n(?:Assistente|Utilizador):|$)/g)];
  return (messages.length ? messages[messages.length - 1][1] : content).trim();
}

function search(question) {
  const query = new Set();
  for (const term of terms(question)) {
    if (STOP_WORDS.has(term)) continue;
    query.add(term);
    for (const synonym of SYNONYMS[term] || []) query.add(synonym);
  }
  if (!query.size || !model.averageLength) return [];
  const k1 = 1.2;
  const b = 0.75;
  return model.documents
    .map((document) => {
      let score = 0;
      for (const term of query) {
        const frequency = document.termFrequency[term] || 0;
        if (!frequency) continue;
        const idf = model.idf[term] || 0;
        score += idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * document.length / model.averageLength));
      }
      return { ...document, score };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// Resposta curta a partir da documentação: as frases mais relevantes do melhor trecho.
function docAnswer(question) {
  const hits = search(question);
  if (!hits.length || hits[0].score < 2) return null;
  const query = new Set(terms(question).filter((t) => !STOP_WORDS.has(t)));
  const best = hits[0];
  const sentences = best.text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý"«(])/u).map((x) => x.trim()).filter(Boolean);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: terms(sentence).filter((t) => query.has(t)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.sentence);
  const more = hits.slice(1).filter((h) => h.section !== best.section).map((h) => h.section);
  return `${ranked.join(' ')}\n\n(Da secção «${best.section}» da documentação${more.length ? `; veja também «${[...new Set(more)].join('», «')}»` : ''}.)`;
}

function answerFromDocs(input) {
  return Assistant.assist({ ...input, searchDocs: docAnswer });
}

const operations = {
  generate: (input) => Assistant.generateDeck(input),
  suggest: (input) => Assistant.suggest(input),
  assist: (input) => input && input.module === 'assistant' && input.task === 'chat' ? answerFromDocs(input) : Assistant.assist(input)
};

function register(ipcMain, isTrusted) {
  for (const [name, operation] of Object.entries(operations)) {
    ipcMain.handle(`ai:${name}`, async (event, input) => {
      if (!isTrusted(event)) return { error: 'Pedido não autorizado.' };
      try {
        return await operation(input || {});
      } catch {
        return { error: 'O Assistente MyOffice não conseguiu analisar este conteúdo.' };
      }
    });
  }
}

module.exports = { register };
