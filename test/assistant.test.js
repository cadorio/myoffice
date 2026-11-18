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

// Conversa: fórmulas, guias e apresentações
const ask = (q) => A.assist({ module: 'assistant', task: 'chat', content: 'Utilizador: ' + q }).answer;
assert.ok(ask('soma de B2 a B10').includes('=SOMA(B2:B10)'));
assert.ok(ask('quantos valores maiores que 100 na coluna C').includes('=CONTAR.SE(C2:C100;">100")'));
assert.ok(ask('média da coluna D').includes('=MÉDIA(D2:D100)'));
assert.ok(ask('qual o máximo de A1:A20').includes('=MÁXIMO(A1:A20)'));
assert.ok(ask('como unir células?').startsWith('Unir células'));
assert.ok(ask('como imprimo').startsWith('Imprimir'));
assert.ok(ask('quero pôr a página na horizontal').startsWith('Configurar a página'));
assert.ok(ask('como ativo o controlo de alterações').startsWith('Controlo de alterações'));
assert.ok(ask('cria uma apresentação sobre plano de marketing').includes('1. Contexto'));
assert.ok(ask('qual a capital de frança').startsWith('Não tenho uma resposta'));
assert.equal(A.assist({ module: 'assistant', task: 'chat', content: 'Utilizador: xyz', searchDocs: () => 'da documentação' }).answer, 'da documentação');

// Revisão com reescritas e análise com tendência
assert.ok(A.assist({ module: 'writer', task: 'review', content: 'É importante referir que a empresa cresceu. Os clientes gostam.' }).answer.includes('→ «A empresa cresceu.»'));
const table = A.assist({ module: 'sheets', task: 'analyse', content: 'Mês | Vendas\nJan | 100\nFev | 120\nMar | 150' }).answer;
assert.ok(table.includes('máximo 150 (Mar)') && table.includes('subiu 50%'));
console.log('Testes da conversa do assistente passaram.');
assert.ok(ask('o que ainda não faz?').startsWith('O que o MyOffice ainda não faz'));

// Rascunhos, seguimento e ações
const chatTo = (c) => A.assist({ module: 'assistant', task: 'chat', content: c });
const draft = chatTo('Utilizador: escreve uma reclamação sobre a fatura da luz');
assert.equal(draft.action.kind, 'draft');
assert.ok(draft.answer.includes('Assunto: Reclamação sobre a fatura da luz'));
assert.ok(draft.action.html.startsWith('<p>'));
assert.ok(chatTo('Utilizador: preciso de um pedido de férias').answer.includes('Assunto: Pedido de férias'));
assert.ok(chatTo('Utilizador: escreve um email para a equipa sobre a reunião').answer.startsWith('Email'));
const follow = chatTo('Utilizador: soma de B2 a B10\n\nAssistente: Fórmula: =SOMA(B2:B10)\n\nUtilizador: e a média?');
assert.deepEqual(follow.action, { kind: 'formula', label: 'Inserir na célula ativa', value: '=MÉDIA(B2:B10)' });
console.log('Testes de rascunhos e seguimento passaram.');

// Contas feitas na resposta
assert.match(A.calculate('quanto é 15% de 230'), /= 34,5/);
assert.match(A.calculate('IVA de 100'), /23,00 €[\s\S]*123,00 €/);
assert.match(A.calculate('tirar o iva a 246 euros'), /sem IVA 200,00 €/);
assert.match(A.calculate('desconto de 20% em 50'), /→ 40/);
assert.match(A.calculate('(250-30)/4'), /= 55$/);
assert.match(A.calculate('2^10'), /= 1024$/);
assert.match(A.calculate('dias entre 01/02/2026 e 15/03/2026'), /42 dias/);
assert.equal(A.calculate('olá, tudo bem?'), null);
assert.equal(A.calculate('quanto custa um café'), null);

// Novos guias, rascunhos e sugestões
assert.ok(ask('como uso a caneta?').startsWith('Desenhar à mão'));
assert.ok(ask('como ponho uma marca de água').startsWith('Marca de água'));
assert.ok(ask('como crio uma tabela dinâmica').startsWith('Tabela dinâmica'));
assert.ok(ask('o antivírus bloqueou o instalador, como faço?').startsWith('O antivírus'));
assert.ok(ask('escreve uma carta de candidatura a técnico de vendas').startsWith('Carta de candidatura'));
assert.ok(ask('faz uma proposta comercial para manutenção de jardins').startsWith('Proposta comercial'));
assert.ok(ask('fórmula para a idade').includes('DATADIF'));
const unsure = chatTo('Utilizador: como faço para por bordas e unir');
assert.ok(Array.isArray(unsure.suggestions));
console.log('Testes de contas, guias novos e sugestões passaram.');
assert.ok(ask('como faço um gráfico de gantt?').startsWith('Planear um projeto'));
assert.ok(ask('como vejo o caminho crítico').startsWith('Caminho crítico'));
assert.ok(ask('como crio um gráfico').startsWith('Criar um gráfico'));
console.log('Testes dos guias de Projetos passaram.');
