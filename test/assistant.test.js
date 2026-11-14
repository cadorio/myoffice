'use strict';

const assert = require('node:assert/strict');
const A = require('../src/js/assistant.js');

// Estrutura escolhida pelo tema
assert.equal(A.classify('Plano de marketing para 2027'), 'plano');
assert.equal(A.classify('Resultados de vendas do 3.º trimestre'), 'relatorio');
assert.equal(A.classify('Introdução à fotografia'), 'formacao');
assert.equal(A.classify('Lançamento do novo produto'), 'produto');
assert.equal(A.classify('A história de Lisboa'), 'geral');

const deck = A.generateDeck({ topic: 'plano de marketing para 2027.', audience: 'direção', count: 5 });
assert.equal(deck.title, 'Plano de marketing para 2027');
assert.equal(deck.subtitle, 'Apresentação para direção');
assert.deepEqual(deck.slides.map((s) => s.title), ['Contexto', 'Objetivos', 'Estratégia', 'Plano de ação', 'Próximos passos']);
assert.ok(deck.slides.every((s) => s.bullets.length === 3 && s.notes.includes('plano de marketing')));
assert.equal(A.generateDeck({ topic: 'x', count: 99 }).slides.length, 8);
assert.equal(A.generateDeck({ topic: 'x', count: 1 }).slides.length, 3);
assert.ok(A.generateDeck({ topic: '  ' }).error);

// Sugestões
const s = A.suggest({
  title: 'É importante referir que as nossas vendas online estão a crescer de forma muito significativa este ano.',
  bullets: [
    'Devido ao facto de termos investido bastante em publicidade digital, com o objetivo de chegar a novos clientes, as visitas ao site aumentaram',
    'A nível de custos, o transporte ficou mais caro; os contratos vão ser revistos',
    'As encomendas cresceram 32% face a 2025'
  ],
  notes: ''
});
const byLabel = Object.fromEntries(s.suggestions.map((x) => [x.label, x]));
assert.deepEqual(byLabel['Mais conciso'].bullets, [
  'As visitas ao site aumentaram',
  'Em custos, o transporte ficou mais caro',
  'Os contratos vão ser revistos',
  'As encomendas cresceram 32% face a 2025'
]);
assert.ok(byLabel['Mais conciso'].title.startsWith('As nossas vendas online'));
assert.ok(byLabel['Mais conciso'].notes.includes('Devido ao facto de termos investido'));
assert.equal(byLabel['Uma ideia por tópico'].title, 'As nossas vendas online estão a crescer de forma significativa este ano');
assert.equal(byLabel['Números primeiro'].bullets[0], 'As encomendas cresceram 32% face a 2025');
assert.ok(s.tips.some((t) => t.includes('título é longo')));
assert.ok(s.suggestions.every((x) => x.bullets.length <= 6));

// Um diapositivo já conciso não recebe alterações
const ok = A.suggest({ title: 'Objetivos', bullets: ['Crescer 10%', 'Abrir duas lojas'], notes: 'Notas' });
assert.deepEqual(ok, { tips: [], suggestions: [] });
assert.ok(A.suggest({ title: '', bullets: [] }).error);

console.log('Testes do assistente passaram.');
