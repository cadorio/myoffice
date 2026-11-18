'use strict';

// Assistente dos Diapositivos: motor de sugestões próprio, baseado em regras de escrita para
// apresentações. Corre no computador do utilizador, sem rede. Sem dependências do DOM, para
// poder ser testado em Node.
(function (root) {
  const MAX_BULLETS = 5;
  const MAX_BULLET_WORDS = 12;
  const MAX_TITLE_WORDS = 8;

  const words = (s) => s.trim().split(/\s+/).filter(Boolean);
  const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const plain = (s) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const tidy = (s) =>
    s
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim();
  const stripEnd = (s) => s.replace(/[\s.;:,]+$/, '');

  // ---------- Criar uma apresentação a partir de um tema ----------

  // Cada secção: [prioridade (menor = mais importante), título, tópicos, nota para o orador].
  const OUTLINES = {
    plano: {
      label: 'Plano',
      keywords: ['plano', 'estrategia', 'marketing', 'projeto', 'proposta', 'campanha', 'orcamento', 'roteiro', 'implementacao', 'objetivos'],
      sections: [
        [1, 'Contexto', ['Situação atual e o que mudou', 'Principais desafios a resolver', 'Oportunidades que justificam agir agora'], 'Comece pelo problema: o público precisa de perceber porque é que este plano existe.'],
        [2, 'Objetivos', ['Objetivo principal, com uma meta mensurável', 'Dois ou três objetivos secundários', 'Prazo para atingir cada meta'], 'Use números e datas: um objetivo sem meta não se consegue avaliar.'],
        [6, 'Público-alvo', ['A quem se dirige esta iniciativa', 'Necessidades e expectativas desse público', 'Canais para chegar até ele'], 'Descreva uma pessoa concreta em vez de um grupo abstrato.'],
        [3, 'Estratégia', ['Linha de ação principal', 'O que nos distingue das alternativas', 'Prioridades para os primeiros meses'], 'Explique a escolha: o que decidiu fazer e o que decidiu não fazer.'],
        [4, 'Plano de ação', ['Ações concretas, por ordem de prioridade', 'Responsável por cada ação', 'Dependências entre ações'], 'Uma ação por linha, começada por um verbo.'],
        [7, 'Calendário', ['Fases do trabalho e datas-chave', 'Marcos de controlo', 'Data prevista de conclusão'], 'Mostre só os marcos; o detalhe fica para um documento à parte.'],
        [5, 'Orçamento e recursos', ['Investimento necessário, por rubrica', 'Equipa e meios envolvidos', 'Retorno esperado'], 'Apresente o total primeiro e só depois a divisão.'],
        [8, 'Indicadores de sucesso', ['Indicadores que vamos acompanhar', 'Valor de partida e valor pretendido', 'Frequência de medição'], 'Escolha poucos indicadores, ligados diretamente aos objetivos.'],
        [9, 'Riscos e mitigação', ['Principais riscos identificados', 'Probabilidade e impacto de cada um', 'Como reduzir ou responder a cada risco'], 'Mostrar os riscos aumenta a confiança no plano.'],
        [0, 'Próximos passos', ['Decisões a tomar hoje', 'Primeiras ações e responsáveis', 'Data do próximo ponto de situação'], 'Termine com um pedido claro ao público.']
      ]
    },
    relatorio: {
      label: 'Relatório',
      keywords: ['relatorio', 'resultados', 'balanco', 'vendas', 'trimestre', 'semestre', 'anual', 'desempenho', 'ponto de situacao', 'analise', 'avaliacao'],
      sections: [
        [1, 'Resumo', ['Conclusão principal numa frase', 'Dois ou três números que a sustentam', 'O que isto significa para o público'], 'Diga a conclusão logo no início; o resto da apresentação serve para a fundamentar.'],
        [2, 'Resultados principais', ['Resultado face ao objetivo', 'Indicadores mais relevantes', 'Destaques do período'], 'Um número por tópico, sempre com a unidade e o período.'],
        [5, 'Evolução', ['Comparação com o período anterior', 'Tendência dos últimos meses', 'Fatores que explicam a variação'], 'Compare sempre com uma referência: período anterior, objetivo ou média.'],
        [3, 'O que correu bem', ['Principais sucessos', 'O que os tornou possíveis', 'Como repetir estes resultados'], 'Reconheça o contributo das pessoas e das equipas.'],
        [4, 'O que correu menos bem', ['Resultados abaixo do esperado', 'Causas identificadas', 'Medidas já tomadas'], 'Seja direto: apresentar as dificuldades com as respetivas medidas dá credibilidade.'],
        [7, 'Análise', ['Causas dos principais desvios', 'Fatores externos e internos', 'O que os dados ainda não explicam'], 'Separe os factos das interpretações.'],
        [8, 'Lições aprendidas', ['O que manter', 'O que mudar', 'O que experimentar a seguir'], 'Formule cada lição como uma decisão para o futuro.'],
        [6, 'Recomendações', ['Medida prioritária', 'Medidas complementares', 'Recursos necessários'], 'Cada recomendação deve responder a um resultado mostrado antes.'],
        [0, 'Próximos passos', ['Ações para o próximo período', 'Responsáveis e prazos', 'Data do próximo relatório'], 'Feche com o que vai acontecer a seguir e quem o faz.']
      ]
    },
    formacao: {
      label: 'Formação',
      keywords: ['introducao', 'formacao', 'curso', 'aula', 'guia', 'tutorial', 'como ', 'o que e', 'aprender', 'workshop', 'explicar', 'conceitos', 'manual'],
      sections: [
        [1, 'Objetivos da sessão', ['O que vai ficar a saber', 'O que vai conseguir fazer no fim', 'O que fica fora desta sessão'], 'Diga ao público o que ganha em estar atento.'],
        [2, 'O que é', ['Definição em linguagem simples', 'Para que serve', 'Um exemplo do dia a dia'], 'Evite jargão; se usar um termo técnico, explique-o de imediato.'],
        [5, 'Porque é importante', ['Problema que resolve', 'O que acontece quando se ignora', 'Quem beneficia'], 'Ligue o tema a uma situação que o público conhece.'],
        [3, 'Como funciona', ['Primeiro passo', 'Segundo passo', 'Terceiro passo'], 'Um passo por tópico; se houver mais de cinco, divida em dois diapositivos.'],
        [4, 'Exemplo prático', ['Situação de partida', 'O que foi feito', 'Resultado obtido'], 'Um exemplo concreto vale mais do que três explicações.'],
        [7, 'Erros comuns', ['Erro mais frequente e como o evitar', 'Sinais de que algo está errado', 'Onde pedir ajuda'], 'Apresente os erros como coisas normais de quem está a aprender.'],
        [6, 'Boas práticas', ['O que fazer sempre', 'O que evitar', 'Como verificar o resultado'], 'Dê regras simples, fáceis de recordar.'],
        [8, 'Exercício', ['Tarefa proposta', 'Tempo disponível', 'Como vamos rever os resultados'], 'Dê tempo para praticar antes de avançar.'],
        [0, 'Resumo', ['As três ideias a reter', 'Onde encontrar mais informação', 'Perguntas'], 'Repita as ideias principais com as mesmas palavras que usou antes.']
      ]
    },
    produto: {
      label: 'Produto',
      keywords: ['produto', 'lancamento', 'startup', 'investidores', 'servico', 'pitch', 'solucao', 'aplicacao', 'app ', 'clientes', 'negocio', 'empresa'],
      sections: [
        [1, 'O problema', ['Quem tem este problema', 'Quanto custa não o resolver', 'Porque as soluções atuais não chegam'], 'Conte uma história curta de alguém que sente este problema.'],
        [2, 'A solução', ['O que é, numa frase', 'Como resolve o problema', 'O que a torna diferente'], 'Se não couber numa frase, ainda não está claro.'],
        [4, 'Como funciona', ['O que o cliente faz primeiro', 'O que acontece a seguir', 'O resultado que obtém'], 'Mostre o produto a funcionar, se puder.'],
        [3, 'Benefícios', ['Benefício principal para o cliente', 'Tempo ou custo poupado', 'Outros ganhos'], 'Fale de benefícios, não de características técnicas.'],
        [5, 'Mercado', ['A quem se destina', 'Dimensão do mercado', 'Segmento por onde começar'], 'Indique a fonte dos números de mercado.'],
        [7, 'Concorrência', ['Alternativas existentes', 'Onde somos melhores', 'Onde ainda temos de evoluir'], 'Reconhecer a concorrência mostra que conhece o mercado.'],
        [6, 'Modelo de negócio', ['Como se gera receita', 'Preço e condições', 'Custos principais'], 'Explique quem paga, quanto e com que frequência.'],
        [8, 'Resultados até agora', ['Clientes ou utilizadores atuais', 'Indicadores de crescimento', 'Testemunhos ou casos'], 'Provas concretas convencem mais do que previsões.'],
        [9, 'Equipa', ['Quem está por trás do projeto', 'Experiência relevante', 'Competências que ainda faltam'], 'Destaque porque é esta a equipa certa para este problema.'],
        [0, 'Próximos passos', ['O que pedimos ao público', 'Para que vai servir', 'Como avançar a partir de hoje'], 'Termine com um pedido concreto e um contacto.']
      ]
    },
    geral: {
      label: 'Geral',
      keywords: [],
      sections: [
        [1, 'Introdução', ['De que vamos falar', 'Porque interessa a este público', 'O que vai ficar a saber'], 'Apresente-se e diga quanto tempo vai durar a apresentação.'],
        [3, 'Contexto', ['Como chegámos aqui', 'Situação atual', 'O que está em causa'], 'Dê só o contexto necessário para perceber o resto.'],
        [2, 'Pontos principais', ['Primeira ideia a reter', 'Segunda ideia a reter', 'Terceira ideia a reter'], 'Três ideias é o que o público consegue recordar.'],
        [4, 'Exemplos', ['Exemplo que ilustra a primeira ideia', 'Exemplo que ilustra a segunda ideia', 'O que estes exemplos têm em comum'], 'Prefira exemplos próximos da realidade do público.'],
        [6, 'Vantagens', ['Vantagem principal', 'Outras vantagens', 'Para quem são mais relevantes'], 'Ordene da vantagem mais importante para a menos importante.'],
        [7, 'Desafios', ['Dificuldades a ter em conta', 'Como podem ser ultrapassadas', 'O que ainda está por decidir'], 'Antecipe as objeções que o público pode ter.'],
        [5, 'Recomendações', ['O que propomos', 'Porque esta é a melhor opção', 'O que é preciso para avançar'], 'Seja específico sobre o que recomenda.'],
        [0, 'Conclusão', ['A ideia principal, numa frase', 'O que fazer a seguir', 'Perguntas'], 'Repita a mensagem principal e agradeça.']
      ]
    }
  };

  function classify(topic) {
    const text = ' ' + plain(topic) + ' ';
    let best = 'geral';
    let bestScore = 0;
    for (const [id, outline] of Object.entries(OUTLINES)) {
      const score = outline.keywords.filter((k) => text.includes(k)).length;
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  // Devolve { type, title, subtitle, slides: [{ title, bullets, notes }] }.
  function generateDeck(input) {
    const topic = tidy(String((input && input.topic) || ''));
    const audience = tidy(String((input && input.audience) || ''));
    if (!topic) return { error: 'Indique o tema da apresentação.' };
    const outline = OUTLINES[classify(topic)];
    const count = Math.max(3, Math.min(outline.sections.length, parseInt(input && input.count, 10) || 6));

    // Mantém as secções mais importantes, pela ordem em que contam a história.
    const keep = new Set(
      outline.sections
        .map((section, index) => ({ index, priority: section[0] }))
        .sort((a, b) => a.priority - b.priority)
        .slice(0, count)
        .map((x) => x.index)
    );
    const slides = outline.sections
      .filter((_section, index) => keep.has(index))
      .map(([, title, bullets, note]) => ({
        title,
        bullets: [...bullets],
        notes: `${note} Substitua os tópicos pelo conteúdo sobre «${topic}»${audience ? `, a pensar em: ${audience}` : ''}.`
      }));

    return {
      type: outline.label,
      title: capitalise(stripEnd(topic)),
      subtitle: audience ? `Apresentação para ${audience}` : 'Subtítulo ou nome do autor',
      slides
    };
  }

  // ---------- Sugestões para um diapositivo ----------

  // Expressões longas e a forma curta equivalente. Os limites de palavra usam \p{L} porque \b não
  // reconhece letras acentuadas.
  const phrase = (source) => new RegExp('(?<!\\p{L})(?:' + source + ')(?!\\p{L})', 'giu');
  const SHORTER = [
    [phrase('é importante (?:referir|salientar|notar|destacar|sublinhar) que'), ''],
    [phrase('(?:importa|convém|vale a pena|gostaria de) (?:referir|salientar|notar|destacar|sublinhar) que'), ''],
    [phrase('(?:como é sabido|como todos sabem|de um modo geral|de uma forma geral|de facto|na verdade|na realidade|basicamente|essencialmente|efetivamente|obviamente|naturalmente),?'), ''],
    [phrase('com o (?:objetivo|intuito|propósito) de'), 'para'],
    [phrase('de forma a|de modo a|por forma a|no sentido de|a fim de|com vista a'), 'para'],
    [phrase('devido ao facto de|pelo facto de'), 'por'],
    [phrase('uma vez que|dado que|visto que|tendo em conta que'), 'porque'],
    [phrase('a nível de|ao nível de|em termos de|no que diz respeito a|no que toca a|relativamente a'), 'em'],
    [phrase('neste momento|atualmente|nos dias de hoje|hoje em dia'), 'hoje'],
    [phrase('a grande maioria de'), 'a maioria de'],
    [phrase('(?:bastante|muito|extremamente|realmente|verdadeiramente|claramente|totalmente)(?= \\p{L})'), '']
  ];

  function shorten(text) {
    let out = text;
    for (const [pattern, replacement] of SHORTER) out = out.replace(pattern, replacement);
    return tidy(out.replace(/^[\s,]+/, ''));
  }

  // "Por termos investido em X, para chegar a Y, as visitas aumentaram" -> "As visitas aumentaram".
  // Só se aplica quando a frase abre com uma oração subordinada; o resto fica nas notas do orador.
  const SUBORDINATE = /^(por|porque|como|devido|dado|uma vez|tendo|apesar|embora|para|com o|se|quando|depois|antes|ao|após|graças)\s/i;
  function mainClause(text) {
    if (!SUBORDINATE.test(text)) return text;
    const last = text.split(/,\s+/).pop();
    return words(last).length >= 3 && !SUBORDINATE.test(last) ? last : text;
  }

  // Corta num limite natural (vírgula, ponto e vírgula, travessão) em vez de a meio de uma ideia.
  function clip(text, maxWords) {
    const list = words(text);
    if (list.length <= maxWords) return text;
    const head = list.slice(0, maxWords).join(' ');
    const at = Math.max(head.lastIndexOf(','), head.lastIndexOf(';'), head.lastIndexOf(' – '), head.lastIndexOf(' - '));
    const cut = at > head.length * 0.5 ? head.slice(0, at) : head;
    return stripEnd(cut.replace(/\s+(e|ou|de|da|do|das|dos|a|o|as|os|em|na|no|para|por|com|que|um|uma)$/i, '')) + '…';
  }

  const clean = (text) => capitalise(stripEnd(shorten(text)));
  const concise = (text, maxWords) => capitalise(clip(stripEnd(mainClause(stripEnd(shorten(text)))), maxWords));

  // Divide um tópico com várias ideias em tópicos separados.
  function split(text) {
    const parts = text
      .split(/(?<=[.!?])\s+|\s*;\s*|\s+–\s+/)
      .flatMap((part) => {
        const halves = part.split(/,\s+(?:e|mas|bem como)\s+|\s+(?:e também|bem como|assim como)\s+/i);
        return halves.every((h) => words(h).length >= 3) ? halves : [part];
      })
      .map((part) => capitalise(stripEnd(tidy(part))))
      .filter(Boolean);
    return parts.length ? parts : [text];
  }

  const hasNumber = (text) => /\d/.test(text);
  const same = (a, b) => a.title === b.title && a.bullets.join('\n') === b.bullets.join('\n');

  function tipsFor(title, bullets, notes) {
    const tips = [];
    const total = words(title).length + bullets.reduce((n, b) => n + words(b).length, 0);
    const long = bullets.filter((b) => words(b).length > 15).length;
    if (!title) tips.push('Falta um título: diga numa linha a ideia principal do diapositivo.');
    else if (words(title).length > 10) tips.push('O título é longo. Tente ficar por oito palavras ou menos.');
    if (bullets.length > 6) tips.push(`Tem ${bullets.length} tópicos. Com mais de cinco ou seis, vale a pena dividir em dois diapositivos.`);
    if (long) tips.push(`${long === 1 ? 'Há um tópico' : `Há ${long} tópicos`} com mais de 15 palavras. Frases curtas leem-se melhor à distância.`);
    if (total > 60) tips.push(`O diapositivo tem cerca de ${total} palavras. Passe o detalhe para as notas do orador.`);
    if (bullets.length === 1 && words(bullets[0]).length > 25) tips.push('O texto está num único parágrafo. Em tópicos, o público acompanha melhor.');
    if (bullets.length && !bullets.some(hasNumber)) tips.push('Não há números. Um dado concreto torna a mensagem mais convincente.');
    if (!notes) tips.push('Sem notas do orador. Escreva aí o que vai dizer, para o diapositivo poder ficar curto.');
    return tips;
  }

  // Devolve { tips: [texto], suggestions: [{ label, reason, title, bullets, notes }] }.
  function suggest(input) {
    const title = tidy(String((input && input.title) || ''));
    const bullets = (Array.isArray(input && input.bullets) ? input.bullets : []).map((b) => tidy(String(b))).filter(Boolean);
    const notes = String((input && input.notes) || '').trim();
    if (!title && !bullets.length) return { error: 'Este diapositivo ainda não tem texto para melhorar.' };

    const original = { title, bullets };
    const shortTitle = title ? concise(title, MAX_TITLE_WORDS) : '';
    const detail = bullets.length ? 'Pontos a desenvolver oralmente:\n' + bullets.map((b) => '• ' + b).join('\n') : '';
    const withDetail = notes ? notes + (detail ? '\n\n' + detail : '') : detail;
    const candidates = [];

    // 1. Mais conciso: menos palavras por tópico, no máximo cinco tópicos; o detalhe passa para as notas.
    const tight = bullets.flatMap(split).map((b) => concise(b, MAX_BULLET_WORDS));
    candidates.push({
      label: 'Mais conciso',
      reason: 'Só a ideia principal de cada frase, sem expressões de enchimento. O texto original passa para as notas do orador.',
      title: shortTitle,
      bullets: tight.slice(0, MAX_BULLETS),
      notes: withDetail
    });

    // 2. Uma ideia por tópico: divide frases com várias ideias.
    const separated = bullets.flatMap(split).map((b) => capitalise(clip(clean(b), MAX_BULLET_WORDS + 6)));
    candidates.push({
      label: 'Uma ideia por tópico',
      reason: 'Cada frase com várias ideias foi separada, para o público acompanhar ponto a ponto.',
      title: title ? clean(title) : '',
      bullets: separated.slice(0, MAX_BULLETS + 1),
      notes: separated.length > MAX_BULLETS + 1 ? withDetail : notes
    });

    // 3. Números primeiro: os tópicos com dados concretos sobem para o topo.
    if (bullets.some(hasNumber) && !hasNumber(bullets[0])) {
      const ordered = [...tight.filter(hasNumber), ...tight.filter((b) => !hasNumber(b))];
      candidates.push({
        label: 'Números primeiro',
        reason: 'Os tópicos com dados concretos aparecem primeiro, onde o público mais repara.',
        title: shortTitle,
        bullets: ordered.slice(0, MAX_BULLETS),
        notes: withDetail
      });
    }

    const suggestions = [];
    for (const candidate of candidates) {
      if (same(candidate, original) || suggestions.some((s) => same(s, candidate))) continue;
      suggestions.push(candidate);
    }
    return { tips: tipsFor(title, bullets, notes), suggestions };
  }

  // Imagens vetoriais simples que o editor pode desenhar localmente e inserir em DOCX/PPTX.
  function suggestVisuals(input) {
    const title = String((input && input.title) || '');
    const bullets = Array.isArray(input && input.bullets) ? input.bullets.join(' ') : '';
    const text = plain(`${title} ${bullets}`);
    if (!text.trim()) return { error: 'Adicione um título ou alguns tópicos para receber ideias visuais.' };
    const options = [
      { kind: 'chart', label: 'Evolução dos resultados', reason: 'Um gráfico visual ajuda a mostrar tendências, vendas, metas ou indicadores.', terms: ['vendas', 'receita', 'crescimento', 'resultados', 'indicador', 'dados', 'evolucao', 'meta', 'orcamento'] },
      { kind: 'team', label: 'Pessoas e colaboração', reason: 'Uma ilustração de equipa ajuda a apresentar clientes, participantes ou trabalho conjunto.', terms: ['equipa', 'pessoas', 'cliente', 'colaboracao', 'colaboradores', 'publico', 'formacao', 'comunidade'] },
      { kind: 'process', label: 'Etapas do plano', reason: 'Uma sequência visual torna fases, processos e próximos passos mais fáceis de acompanhar.', terms: ['processo', 'etapa', 'fase', 'plano', 'implementacao', 'calendario', 'projeto', 'passos', 'metodo'] },
      { kind: 'target', label: 'Objetivo e direção', reason: 'Um alvo visual destaca objetivos, prioridades e resultados pretendidos.', terms: ['objetivo', 'prioridade', 'estrategia', 'visao', 'proposta', 'direcao', 'foco', 'meta'] },
      { kind: 'leaf', label: 'Natureza e sustentabilidade', reason: 'Uma ilustração natural funciona bem para ambiente, energia e sustentabilidade.', terms: ['ambiente', 'sustentabilidade', 'energia', 'natureza', 'clima', 'reciclagem', 'verde'] },
      { kind: 'idea', label: 'Ideia principal', reason: 'Uma imagem simples pode reforçar o conceito central sem acrescentar dados inventados.', terms: [] }
    ];
    const matched = options.filter((option) => option.terms.some((term) => text.includes(term)));
    const visuals = [...matched, ...options.filter((option) => !matched.includes(option))].slice(0, 3)
      .map(({ kind, label, reason }) => ({ kind, label, reason }));
    return { visuals };
  }

  // ---------- Análise inteligente local de texto, tabelas e pedidos ----------

  const STOP_WORDS = new Set(('a ao aos as até com como da das de dela delas dele deles depois do dos e é em entre era essa essas esse esses esta estas este estes foi foram há isso isto já mais mas me mesmo meu minha muito na nas nem no nos nós o os ou para pela pelas pelo pelos por porque que se sem ser seu sua suas também tem ter um uma umas uns vai vão').split(' '));
  const tokens = (text) => String(text || '').toLocaleLowerCase('pt-PT').match(/[\p{L}\p{N}]+/gu) || [];

  function reviewText(content) {
    const paragraphs = content.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    const sentences = content.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
    const allWords = tokens(content);
    const terms = new Map();
    for (const word of allWords) {
      if (word.length < 4 || STOP_WORDS.has(word)) continue;
      terms.set(word, (terms.get(word) || 0) + 1);
    }
    const ranked = sentences.map((sentence, index) => ({
      sentence,
      index,
      score: tokens(sentence).reduce((sum, word) => sum + (terms.get(word) || 0), 0) / Math.max(1, tokens(sentence).length)
    }));
    const summary = ranked
      .slice()
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, Math.min(3, ranked.length))
      .sort((a, b) => a.index - b.index)
      .map((item) => item.sentence);
    const longSentences = sentences.filter((sentence) => tokens(sentence).length > 30).length;
    const repeated = [...terms.entries()].filter(([, count]) => count >= 4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const observations = [
      `O texto tem ${allWords.length} palavras, ${sentences.length} frases e ${paragraphs.length} parágrafos.`,
      summary.length ? `Resumo extraído do próprio texto: ${summary.join(' ')}` : ''
    ].filter(Boolean);
    const suggestions = [];
    if (longSentences) suggestions.push(`${longSentences} frase(s) têm mais de 30 palavras; considere dividi-las.`);
    if (paragraphs.length === 1 && allWords.length > 180) suggestions.push('O documento é um único parágrafo longo; separe-o por assunto.');
    if (repeated.length) suggestions.push(`Termos repetidos com frequência: ${repeated.map(([word, count]) => `${word} (${count}×)`).join(', ')}.`);
    const rewrites = sentences
      .map((sentence) => ({ sentence, short: capitalise(shorten(sentence)) }))
      .filter((x) => words(x.sentence).length - words(x.short).length >= 2)
      .slice(0, 4);
    if (!suggestions.length && !rewrites.length) suggestions.push('Não encontrei frases excessivamente longas nem repetições frequentes pelas regras locais.');
    const rewriteText = rewrites.length
      ? '\n\nPropostas mais diretas:\n' + rewrites.map((x) => `• «${x.sentence}»\n  → «${x.short}»`).join('\n')
      : '';
    return { answer: `${observations.join('\n\n')}${suggestions.length ? `\n\nPontos a rever: ${suggestions.join(' ')}` : ''}${rewriteText}` };
  }

  function numberValue(value) {
    let text = String(value || '').trim().replace(/[€$£%\s]/g, '');
    if (!/^-?\d[\d.,]*$/.test(text)) return null;
    if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function analyseTable(content) {
    const rows = content.split(/\r?\n/).map((line) => line.split(/\s*\|\s*/).map((cell) => cell.trim())).filter((row) => row.some(Boolean));
    if (!rows.length) return { error: 'Selecione dados antes de pedir uma análise.' };
    const headers = rows[0];
    const data = rows.slice(1);
    const numericColumns = headers.map((header, column) => ({
      header: header || `Coluna ${column + 1}`,
      values: data.map((row) => numberValue(row[column])).filter((value) => value !== null)
    })).filter((column) => column.values.length >= 2);
    const missing = data.reduce((sum, row) => sum + Math.max(0, headers.length - row.filter((cell) => cell !== '').length), 0);
    const findings = [`A seleção tem ${data.length} linha(s) de dados e ${headers.length} coluna(s).`];
    const labelColumn = headers.findIndex((_h, column) => data.some((row) => row[column] && numberValue(row[column]) === null));
    const fmt = (n) => n.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
    const labelOf = (row) => (labelColumn >= 0 && row[labelColumn]) || null;
    for (const column of numericColumns.slice(0, 6)) {
      const index = headers.indexOf(column.header) >= 0 ? headers.indexOf(column.header) : headers.findIndex((h, i) => (h || `Coluna ${i + 1}`) === column.header);
      const rowsWithValues = data.map((row) => ({ row, value: numberValue(row[index]) })).filter((x) => x.value !== null);
      const values = rowsWithValues.map((x) => x.value);
      const total = values.reduce((sum, value) => sum + value, 0);
      const top = rowsWithValues.reduce((a, b) => (b.value > a.value ? b : a));
      const low = rowsWithValues.reduce((a, b) => (b.value < a.value ? b : a));
      const parts = [`total ${fmt(total)}`, `média ${fmt(total / values.length)}`,
        `máximo ${fmt(top.value)}${labelOf(top.row) ? ` (${labelOf(top.row)})` : ''}`,
        `mínimo ${fmt(low.value)}${labelOf(low.row) ? ` (${labelOf(low.row)})` : ''}`];
      const first = values[0];
      const last = values[values.length - 1];
      let trend = '';
      if (values.length >= 3 && first !== 0) {
        const change = ((last - first) / Math.abs(first)) * 100;
        if (Math.abs(change) >= 1) trend = ` Do primeiro ao último valor ${change > 0 ? 'subiu' : 'desceu'} ${fmt(Math.abs(change))}%.`;
      }
      const share = total > 0 && values.every((v) => v >= 0) && values.length >= 3 ? ` O maior valor representa ${fmt((top.value / total) * 100)}% do total.` : '';
      findings.push(`${column.header}: ${parts.join(', ')}.${trend}${share}`);
    }
    if (missing) findings.push(`Há ${missing} célula(s) vazia(s) nas linhas de dados.`);
    if (!numericColumns.length) findings.push('Não encontrei colunas com pelo menos dois valores numéricos reconhecíveis.');
    findings.push('A análise é calculada localmente e descreve apenas os valores selecionados; confirme cabeçalhos, unidades e período.');
    return { answer: findings.join('\n\n') };
  }

  // ---------- Guias passo a passo ----------

  // Cada guia: palavras-chave (sem acentos), título e passos. A pontuação conta palavras-chave
  // presentes na pergunta; as expressões com várias palavras valem mais.
  const GUIDES = [
    ['bordas borda linhas celulas contorno grelha', 'Pôr bordas em células (Folhas)', ['Selecione as células.', 'No painel Ferramentas › Base, secção Bordas, escolha Todas as bordas, Bordas exteriores, Borda inferior ou Sem bordas.', 'As bordas seguem para o Excel ao exportar em XLSX.']],
    ['unir juntar fundir celulas merge centrar', 'Unir células (Folhas)', ['Selecione o intervalo a unir.', 'Em Base › Alinhamento, clique em Unir e centrar.', 'Para desfazer, selecione a célula unida e clique em Separar.']],
    ['fixar congelar paineis linha cabecalho coluna rolar', 'Fixar linhas ou colunas (Folhas)', ['Abra Esquema de página › Fixar painéis.', 'Escolha Fixar linha superior, Fixar primeira coluna ou Fixar até à célula ativa.', 'Para voltar ao normal, use Libertar painéis.']],
    ['largura coluna ajustar alargar redimensionar', 'Mudar a largura de uma coluna (Folhas)', ['Aponte para a linha entre duas letras de coluna, no cabeçalho.', 'Arraste para alargar ou estreitar.', 'Faça duplo clique nessa linha para ajustar ao conteúdo.']],
    ['preencher preenchimento automatico serie arrastar sequencia meses dias numerar', 'Preenchimento automático (Folhas)', ['Escreva o início da série (por exemplo 1 e 2, Janeiro, ou segunda).', 'Selecione essas células e arraste o pequeno quadrado no canto inferior direito.', 'Números, meses, dias da semana e fórmulas continuam automaticamente.']],
    ['formatacao condicional cores realcar destacar escala valores maior menor', 'Formatação condicional (Folhas)', ['Selecione os valores.', 'Em Base › Formatação condicional, clique em Realçar células.', 'Escolha a regra (maior que, menor que, entre, igual, contém texto ou escala de cores) e a cor.', 'Limpar regras remove a formatação da seleção.']],
    ['grafico graficos barras colunas linhas circular pizza visualizar', 'Criar um gráfico', ['Selecione a tabela com os cabeçalhos: categorias na 1.ª coluna e uma ou mais colunas de valores.', 'Abra Dados › Gráfico e escolha o tipo: colunas, empilhadas, barras, linhas, área, circular, anel ou dispersão.', 'Dê um título e clique em Inserir na folha. Arraste para mover, use o canto para mudar o tamanho e faça duplo clique para editar.', 'No Texto e nos Diapositivos: Inserir › Gráfico, e escreva ou cole os dados.']],
    ['tabela dinamica resumo agrupar pivot cruzar', 'Tabela dinâmica (Folhas)', ['Clique numa célula dos dados (com cabeçalhos na 1.ª linha).', 'Abra Dados › Tabela dinâmica.', 'Escolha o campo das Linhas, o das Colunas (opcional, para cruzar), o dos Valores e o resumo: soma, contagem, média, máximo ou mínimo.', 'Coloque-a numa folha nova ou ao lado dos dados. Tem totais e atualiza-se quando os dados mudam.']],
    ['ordenar filtrar filtro ordem crescente decrescente', 'Ordenar e filtrar (Folhas)', ['Clique numa célula da coluna.', 'Em Dados › Ordenar, escolha Ascendente ou Descendente, ou use Filtrar.', 'Limpar filtro mostra de novo todas as linhas.']],
    ['comentario comentarios anotar nota margem', 'Comentários (Texto)', ['Selecione o texto a comentar.', 'Abra o separador Rever e clique em Novo comentário.', 'Os comentários aparecem na lista do painel; Resolver remove-os. Seguem para o Word ao exportar.']],
    ['controlo alteracoes revisoes registar aceitar rejeitar track', 'Controlo de alterações (Texto)', ['No separador Rever, ative Controlar alterações.', 'O texto novo fica sublinhado e o apagado riscado.', 'No fim da revisão, use Aceitar todas ou Rejeitar todas.']],
    ['indice sumario conteudos toc', 'Índice automático (Texto)', ['Use estilos de título (Título 1, 2, 3) nos capítulos.', 'Em Inserir › Referências, clique em Índice.', 'Clique de novo para o atualizar depois de mudar os títulos.']],
    ['nota rodape notas rodape referencia', 'Notas de rodapé (Texto)', ['Coloque o cursor onde quer a referência.', 'Em Inserir › Referências, clique em Nota de rodapé e escreva o texto da nota.', 'As notas aparecem no fim da página, no PDF e no DOCX.']],
    ['margens orientacao horizontal vertical paisagem tamanho pagina a4 carta configurar', 'Configurar a página (Texto)', ['Abra Estrutura › Página › Configurar página.', 'Escolha o tamanho (A4, Carta, A5), a orientação e as margens.', 'A configuração vale para a impressão, o PDF e o DOCX.']],
    ['cabecalho rodape numero pagina paginas', 'Cabeçalho, rodapé e números de página (Texto)', ['Abra Estrutura › Página › Cabeçalho e rodapé.', 'Escreva o texto e escolha a numeração de páginas (página atual e total).']],
    ['tabela tabelas diapositivo slides linhas colunas', 'Tabela num diapositivo', ['Em Inserir › Tabela, indique linhas e colunas.', 'Faça duplo clique numa célula para escrever; Tab passa à seguinte.', 'Com a tabela selecionada, use Linha + ou Coluna + no painel.']],
    ['alinhar distribuir agrupar objetos varios elementos', 'Alinhar e agrupar objetos (Diapositivos)', ['Clique num objeto e Shift+clique nos outros.', 'Em Base › Alinhar, escolha o alinhamento ou Distribuir.', 'Agrupar faz com que se movam juntos.']],
    ['apresentador vista apresentador notas cronometro proximo apresentar', 'Vista do apresentador (Diapositivos)', ['Abra Apresentação › Vista do apresentador.', 'Vê o diapositivo atual, o seguinte, as notas e o tempo.', 'Durante a apresentação, a tecla P alterna esta vista.']],
    ['organizar ordem reordenar diapositivos sorter mover', 'Organizar diapositivos', ['Abra Apresentação › Organizar diapositivos.', 'Arraste cada miniatura para a nova posição.']],
    ['transicao transicoes animacao efeitos entrada', 'Transições e efeitos (Diapositivos)', ['Selecione o diapositivo ou o elemento.', 'Em Apresentação, escolha a transição ou o efeito de entrada.']],
    ['tema temas cores design aspeto ideias', 'Temas e Ideias de design (Diapositivos)', ['Em Estrutura, escolha um dos 13 temas e a variante de cor.', 'Em Assistente › Ideias de design, aplique uma composição com um clique.']],
    ['fluxograma diagrama desenho organograma mapa mental ligar formas', 'Fazer um diagrama (Desenho)', ['Abra o Desenho e escolha um modelo (Fluxo, Mapa mental, Organização, Linha temporal, SWOT) ou Em branco.', 'Em Inserir › Formas, acrescente caixas, decisões, notas…; faça duplo clique numa forma para escrever.', 'Para ligar, arraste a partir de um ponto azul da forma até outra. Em Formatar escolhe setas, tracejado e cotovelo.', 'Exporte em SVG, PNG ou PDF no separador Ficheiro.']],
    ['base dados tabela tabelas registos access clientes inventario', 'Criar uma base de dados', ['Abra Bases de dados e comece por um modelo (Clientes, Inventário, Encomendas) ou por uma base em branco.', 'Em Base › Estrutura acrescente campos e escolha o tipo: texto, número, moeda, data, sim/não, lista de opções ou ligação a outra tabela.', 'Na Folha de dados ou no Formulário escreva os registos; tudo fica num único ficheiro .modb.', 'Em Dados externos importe do Excel, de um CSV ou do Access, e exporte para Excel ou CSV.']],
    ['servidor mysql mariadb postgresql postgres sql server ligar ligacao remota', 'Ligar a um servidor (Bases de dados)', ['No programa Bases de dados, abra Dados externos › Ligar a servidor.', 'Escolha o tipo (MySQL/MariaDB, PostgreSQL ou SQL Server), o endereço, a base de dados, o utilizador e a palavra-passe.', 'As tabelas do servidor aparecem em Servidores: edite registos, use Consulta SQL ou Copiar para a base local.', 'Para enviar uma tabela local para o servidor, abra-a e use Dados externos › Enviar tabela.']],
    ['perguntar portugues pergunta linguagem natural consulta sem sql', 'Perguntar em português (Bases de dados)', ['Abra Criar › Consulta.', 'Escreva a pergunta, por exemplo "clientes de Lisboa ativos" ou "total de encomendas por cliente", e carregue em Perguntar.', 'O programa mostra o que entendeu, o SQL gerado (que pode editar) e o resultado.']],
    ['regras obrigatorio unico minimo maximo integridade validacao', 'Regras dos campos (Bases de dados)', ['Abra a tabela em Base › Estrutura.', 'Na coluna Regras marque Obrigatório ou Único e, nos números, indique o mínimo e o máximo.', 'Registos ligados a outros (ex.: cliente com encomendas) não podem ser eliminados.']],
    ['subformulario formulario relacoes diagrama personalizar', 'Formulários e relações (Bases de dados)', ['Em Base › Formulário, cada registo mostra os registos ligados (ex.: as encomendas do cliente); pode editá-los e acrescentar novos.', 'Personalizar permite mudar a ordem dos campos e esconder campos.', 'Base › Relações mostra o diagrama das tabelas e das ligações.']],
    ['consulta consultas sql filtrar juntar relatorio', 'Consultas e relatórios (Bases de dados)', ['Em Criar › Consulta escolha a tabela, a condição e a ordenação e clique em Criar consulta, ou escreva SQL.', 'Execute com Ctrl+Enter e guarde a consulta para a usar mais tarde.', 'Em Criar › Relatório pré-visualiza e imprime a tabela ou o resultado como um relatório.']],
    ['mala direta cartas serie correspondencia etiquetas destinatarios', 'Mala direta (Texto)', ['Escreva a carta no Texto.', 'Em Correspondência › Escolher lista, abra um Excel ou CSV com os cabeçalhos na primeira linha (Nome, Cidade…).', 'Use Inserir campo para pôr «Nome», «Cidade»… no texto.', 'Clique em Concluir e juntar: é criado um documento com uma carta por destinatário.']],
    ['espacamento linhas entrelinha paragrafo espaco antes depois avanco', 'Espaçamento e avanços (Texto)', ['Selecione os parágrafos.', 'Em Base › Parágrafo escolha Entre linhas (1,0 a 3,0), Espaço antes e Espaço depois.', 'O botão ↦ liga ou desliga o avanço da primeira linha.']],
    ['expoente indice sobrescrito subscrito potencia quimica', 'Expoente e índice (Texto)', ['Selecione o texto.', 'Em Base › Tipo de letra clique em x² (expoente, Ctrl+Shift++) ou x₂ (índice, Ctrl+=).']],
    ['pincel formatacao copiar formato', 'Pincel de formatação (Texto)', ['Coloque o cursor no texto com o formato que quer copiar.', 'Clique no pincel (Base › Tipo de letra) e selecione o texto onde o quer aplicar. Esc cancela.']],
    ['imprimir impressao impressora pre visualizar previsualizar', 'Imprimir', ['Ctrl+Shift+P abre a pré-visualização da impressão.', 'Ctrl+P imprime.', 'Também estão no menu Ficheiro.']],
    ['assinar assinatura assinado rubricar', 'Assinar um PDF', ['Abra o PDF no programa PDF (Ficheiro › Abrir).', 'Em Anotar › Assinar, clique em Assinatura e desenhe-a com o rato, a caneta ou o dedo.', 'Clique na página onde a quer colocar; pode arrastá-la depois.', 'Guarde (Ctrl+S). Também pode usar Imagem para uma assinatura digitalizada.']],
    ['juntar combinar pdfs merge acrescentar paginas', 'Juntar vários PDF', ['Abra o primeiro PDF no programa PDF.', 'Em Páginas › Combinar, clique em Juntar PDF e escolha o outro ficheiro: as páginas entram depois da página atual.', 'Reorganize arrastando as miniaturas à esquerda e guarde.']],
    ['extrair separar dividir paginas', 'Extrair páginas de um PDF', ['No programa PDF, abra Páginas › Combinar › Extrair páginas.', 'Indique as páginas, por exemplo 1-3, 5, e escolha onde guardar o PDF novo.']],
    ['rodar girar virar pagina', 'Rodar páginas de um PDF', ['No programa PDF, selecione a página nas miniaturas.', 'Em Páginas › Rodar, escolha Rodar à esquerda ou à direita, e guarde.']],
    ['anotar realcar sublinhar escrever pdf preencher formulario', 'Escrever e realçar num PDF', ['Abra o PDF no programa PDF.', 'Em Anotar, escolha Texto e clique na página para escrever (ótimo para preencher formulários).', 'Realçar marca texto a cores; Desenhar e Retângulo servem para assinalar; Tapar cobre uma zona com branco.', 'Selecionar permite mover ou apagar (Delete) qualquer anotação. Guarde com Ctrl+S.']],
    ['pdf exportar exportacao converter', 'Exportar para PDF ou formatos do Office', ['Abra Ficheiro › Exportar (ou Ctrl+Shift+E para PDF).', 'Escolha PDF, DOCX, XLSX ou PPTX conforme a aplicação.', 'O ficheiro original não é alterado.']],
    ['abrir word excel powerpoint docx xlsx pptx importar', 'Abrir ficheiros do Office', ['Use Ficheiro › Abrir ou Ctrl+O e escolha o ficheiro .docx, .xlsx ou .pptx.', 'O MyOffice avisa o que pode não ser convertido e guarda a conversão num ficheiro próprio.']],
    ['guardar gravar salvar', 'Guardar', ['Ctrl+S guarda no formato próprio do MyOffice.', 'Para guardar como Word, Excel ou PowerPoint, use Ficheiro › Exportar.']],
    ['recuperar perdido fechou crash rascunho', 'Recuperar trabalho não guardado', ['Se a aplicação fechar de repente, ao abrir de novo oferece-se para recuperar o trabalho.', 'Aceite e depois guarde o ficheiro.']],
    ['escuro claro modo noite tema aparencia', 'Modo claro ou escuro', ['Clique no ícone da lua (ou do sol) no canto superior direito.', 'Também pode procurar "modo escuro" com Ctrl+K.']],
    ['comando procurar atalho atalhos ctrl botao onde encontrar', 'Encontrar qualquer comando', ['Carregue em Ctrl+K.', 'Escreva o que quer fazer, por exemplo "borda" ou "PDF", e carregue em Enter.', 'Ctrl+. esconde ou mostra o painel de ferramentas.']],
    ['zoom ampliar aumentar diminuir', 'Zoom', ['Use o controlo de zoom no canto inferior direito, de 50% a 200%.']],
    ['instalar instalacao instalador windows smartscreen setup msi portatil zip empresa', 'Instalar o MyOffice', ['Na página de versões no GitHub escolha: MyOffice-Setup (.exe) para uso pessoal, o .msi para empresas (todos os utilizadores, GPO ou Intune) ou o ZIP portátil, que não precisa de instalação.', 'Se o Windows mostrar "O Windows protegeu o computador", clique em Mais informações › Executar mesmo assim (o instalador ainda não tem assinatura digital).', 'Cada programa fica com o seu atalho e ícone no menu Iniciar e no ambiente de trabalho.']],
    ['antivirus antivirus virus bloqueou bloqueado defender falso positivo seguro sha256 hash', 'O antivírus bloqueou o MyOffice', ['É um falso positivo comum em programas novos sem assinatura digital.', 'Confirme que o ficheiro é o original: no PowerShell, Get-FileHash ficheiro.exe, e compare com o SHA256SUMS.txt da versão.', 'Reporte o falso positivo à Microsoft em microsoft.com/wdsi/filesubmission (Software developer › Incorrectly detected).']],
    ['limitacoes limites falta faltam suporta', 'O que o MyOffice ainda não faz', ['Exportar tabelas dinâmicas para o Excel como tabelas dinâmicas (vão como valores).', 'Animações complexas, gráficos e SmartArt do PowerPoint.', 'Abrir ficheiros do OneNote; marca de água no Word exportado.', 'Coautoria em tempo real, nuvem, correio e calendário.', 'Instaladores oficiais para macOS e Linux.']],
    ['notas caderno onenote seccao seccoes pagina paginas apontamentos', 'Tomar notas (Notas)', ['Abra o MyOffice Notas: à esquerda ficam as secções e a lista de páginas.', 'Clique em qualquer sítio da página para escrever; arraste a barra no topo do bloco para o mudar de lugar.', 'Base › Nova página e Nova secção organizam o caderno; duplo clique numa secção muda-lhe o nome.', 'Depois de guardar uma vez (Ctrl+S), o caderno grava sozinho.']],
    ['tarefas checklist caixa marcar lista tarefa etiqueta etiquetas importante', 'Listas de tarefas e etiquetas (Notas)', ['Em Inserir › Lista de tarefas aparece uma lista com caixas; clique na caixa para marcar como feita.', 'Em Base › Etiquetas marque o parágrafo como Importante, A fazer, Pergunta ou Ideia.', 'Procurar no caderno (em cima, à esquerda) encontra o texto em todas as páginas.']],
    ['caneta mao livre desenhar marcador borracha tatil escrever mao', 'Desenhar à mão (Desenho e Notas)', ['Abra o separador Desenhar e escolha Caneta ou Marcador; escolha a cor e, no Desenho, a espessura.', 'Desenhe com o rato, uma caneta ou o dedo. A Borracha apaga um traço ao passar por cima.', 'Esc ou Selecionar/Escrever volta ao modo normal. Ctrl+Z desfaz.']],
    ['formas estrela triangulo hexagono nuvem balao seta imagem logotipo desenho', 'Formas e imagens (Desenho)', ['Em Inserir › Formas e Mais formas há caixa, decisão, círculo, triângulo, hexágono, estrela, seta grossa, balão de fala, nuvem e outras.', 'Inserir › Imagem acrescenta uma fotografia ou um logótipo que se redimensiona como as formas.', 'Em Formatar muda as cores; pode trocar o tipo de forma sem perder o texto.']],
    ['marca agua confidencial rascunho copia fundo diagonal', 'Marca de água (Texto)', ['Abra Estrutura › Página › Marca de água.', 'Escreva o texto (por exemplo CONFIDENCIAL ou RASCUNHO) e clique em Aplicar.', 'Aparece no ecrã, na impressão e no PDF. Deixe vazio para a tirar.']],
    ['legenda legendas figura figuras numerar numeracao imagem tabela', 'Legendas numeradas (Texto)', ['Clique por baixo da imagem ou da tabela.', 'Em Inserir › Referências › Legenda escolha Figura, Tabela, Gráfico ou Equação e escreva o texto.', 'A numeração atualiza-se sozinha quando acrescenta ou apaga legendas.']],
    ['caixa destaque letra capital capitular limite sombreado moldura', 'Destaques no texto (Texto)', ['Caixa de destaque (Inserir › Elementos): selecione parágrafos e clique para os pôr numa caixa com fundo; clique outra vez para tirar.', 'Letra capital: com o cursor no parágrafo, faz a primeira letra grande.', 'Limite e sombreado (Base › Parágrafo, botão ▢) põe uma moldura à volta do parágrafo.']],
    ['navegacao painel titulos leitura modo estatisticas palavras paginas contar contagem', 'Navegação, leitura e estatísticas (Texto)', ['Ver › Navegação mostra os títulos à esquerda; clique para saltar para a secção.', 'Ver › Modo de leitura esconde as ferramentas; Esc volta a editar.', 'Ver › Estatísticas mostra páginas, palavras, carateres, frases e tempo de leitura.']],
    ['ordenar paragrafos alfabetica lista nomes az', 'Ordenar parágrafos (Texto)', ['Selecione os parágrafos ou os itens da lista.', 'Em Base › Parágrafo, clique em Ordenar de A a Z ou de Z a A.']],
    ['ortografia ortografica erros revisao', 'Revisão ortográfica (Texto)', ['As palavras com erro ficam sublinhadas a vermelho, quando o Windows tem o dicionário de português.', 'Clique com o botão direito para ver sugestões.']]
  ].map(([keys, title, steps]) => ({ keys: keys.split(' '), title, steps }));

  function findGuide(query) {
    const list = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const has = (key) => { const stem = key.length > 5 ? key.slice(0, key.length - 2) : key; return list.some((w) => w.startsWith(stem)); };
    let best = null;
    let bestScore = 0;
    for (const guide of GUIDES) {
      let score = 0;
      for (const key of guide.keys) if (has(key)) score += key.length > 6 ? 2 : 1;
      if (score > bestScore) { best = guide; bestScore = score; }
    }
    return bestScore >= 2 ? best : null;
  }

  // Pontuação do melhor guia (para exigir mais certeza quando a pergunta não é um pedido de ajuda).
  function guideScore(query, guide) {
    const list = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const has = (key) => { const stem = key.length > 5 ? key.slice(0, key.length - 2) : key; return list.some((w) => w.startsWith(stem)); };
    return guide.keys.reduce((n, key) => n + (has(key) ? (key.length > 6 ? 2 : 1) : 0), 0);
  }

  const guideAnswer = (guide) => `${guide.title}:\n${guide.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;

  // ---------- Contas feitas logo na resposta ----------

  const fmt = (n) => {
    if (!Number.isFinite(n)) return null;
    const r = Math.round(n * 1e6) / 1e6;
    return r.toLocaleString('pt-PT', { maximumFractionDigits: 6 });
  };
  const money = (n) => n.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const numIn = (t) => Number(String(t).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

  // Avalia + - * / ^ ( ) e percentagens sem usar eval.
  function evaluate(expr) {
    const src = expr.replace(/×|x(?=\s*[\d(])/g, '*').replace(/÷|:/g, '/').replace(/\s+/g, '');
    let i = 0;
    const peek = () => src[i];
    function number() {
      const m = src.slice(i).match(/^\d+(?:[.,]\d+)?/);
      if (!m) throw new Error('n');
      i += m[0].length;
      let v = Number(m[0].replace(',', '.'));
      if (peek() === '%') { i++; v /= 100; }
      return v;
    }
    function factor() {
      if (peek() === '-') { i++; return -factor(); }
      if (peek() === '+') { i++; return factor(); }
      if (peek() === '(') { i++; const v = sum(); if (peek() !== ')') throw new Error(')'); i++; return v; }
      return number();
    }
    function power() { const b = factor(); if (peek() === '^') { i++; return Math.pow(b, power()); } return b; }
    function product() { let v = power(); while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = power(); v = op === '*' ? v * r : v / r; } return v; }
    function sum() { let v = product(); while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = product(); v = op === '+' ? v + r : v - r; } return v; }
    const v = sum();
    if (i !== src.length) throw new Error('fim');
    return v;
  }

  function parseDate(t) {
    const m = String(t).match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return d.getUTCDate() === Number(m[1]) ? d : null;
  }

  function calculate(question) {
    const q = plain(question).replace(/\?+$/, '').trim();
    const N = '(\\d[\\d.\\s]*(?:,\\d+)?)';
    const re = (p) => new RegExp(p.replace(/N/g, N));
    let m;
    // Valor com IVA incluído: separa a base e o imposto.
    if (/\biva\b/.test(q) && /\b(com iva|iva incluido|inclui iva|tirar o iva|retirar o iva|sem iva)\b/.test(q) && (m = q.match(/(\d[\d.\s]*(?:,\d+)?)\s*(?:€|euros?)?/))) {
      const rateM = q.match(/(\d+)\s*%/);
      const rate = rateM ? Number(rateM[1]) : 23;
      const gross = numIn(m[1] === String(rate) && rateM ? q.replace(rateM[0], '').match(/(\d[\d.\s]*(?:,\d+)?)/)[1] : m[1]);
      const net = gross / (1 + rate / 100);
      return `Valor com IVA ${money(gross)} → sem IVA ${money(net)}; IVA (${rate}%) = ${money(gross - net)}.\n\nNas Folhas: =A2/(1+${rate}%) para o valor sem IVA.`;
    }
    // IVA (taxa normal em Portugal continental: 23%).
    if ((m = q.match(re('\\biva\\b(?:\\s+(?:de|a)\\s+(\\d+)\\s*%)?.*?\\b(?:de|sobre|em|a)\\s+N\\s*(?:€|euros?)?$')))) {
      const rate = m[1] ? Number(m[1]) : 23;
      const base = numIn(m[2]);
      if (/\b(com iva|incluido|inclui|retirar|tirar|sem iva)\b/.test(q) && /\b(com iva|incluido|inclui)\b/.test(q)) {
        const net = base / (1 + rate / 100);
        return `Valor com IVA ${money(base)} → sem IVA ${money(net)}; IVA (${rate}%) = ${money(base - net)}.`;
      }
      return `IVA de ${rate}% sobre ${money(base)} = ${money(base * rate / 100)}\nTotal com IVA: ${money(base * (1 + rate / 100))}\n\nNas Folhas: =A2*${rate}% para o IVA e =A2*(1+${rate}%) para o total.`;
    }
    if ((m = q.match(re('\\b(desconto|aumento|subida|reducao)\\s+de\\s+N\\s*%\\s+(?:em|sobre|a|de)\\s+N')))) {
      const pct = numIn(m[2]);
      const base = numIn(m[3]);
      const up = /aumento|subida/.test(m[1]);
      const result = base * (1 + (up ? pct : -pct) / 100);
      return `${up ? 'Aumento' : 'Desconto'} de ${fmt(pct)}% em ${fmt(base)}: ${up ? '+' : '−'}${fmt(base * pct / 100)} → ${fmt(result)}.\n\nNas Folhas: =A2*(1${up ? '+' : '-'}${fmt(pct).replace(',', '.')}%)`;
    }
    if ((m = q.match(re('^(?:quanto (?:e|sao|da)\\s+)?N\\s*%\\s+de\\s+N$')))) {
      const pct = numIn(m[1]);
      const base = numIn(m[2]);
      return `${fmt(pct)}% de ${fmt(base)} = ${fmt(base * pct / 100)}.\n\nNas Folhas: =${fmt(base).replace(/\s/g, '').replace(',', '.')}*${fmt(pct).replace(',', '.')}%`;
    }
    if ((m = q.match(re('^(?:que|qual a?)\\s+percentagem\\s+(?:e|representa)\\s+N\\s+de\\s+N$')))) {
      const part = numIn(m[1]);
      const total = numIn(m[2]);
      return total ? `${fmt(part)} é ${fmt(part / total * 100)}% de ${fmt(total)}.\n\nNas Folhas: =A2/B2 e formate como percentagem.` : null;
    }
    if ((m = q.match(/(?:dias|semanas)\s+(?:entre|de)\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(?:e|a|ate)\s+(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/))) {
      const a = parseDate(m[1]);
      const b = parseDate(m[2]);
      if (a && b) {
        const days = Math.round((b - a) / 86400000);
        return `Entre ${m[1]} e ${m[2]} há ${fmt(Math.abs(days))} dias (${fmt(Math.abs(days) / 7)} semanas).\n\nNas Folhas: =B2-A2, com as datas em A2 e B2.`;
      }
    }
    if ((m = q.match(/(?:quantos dias faltam|dias ate|faltam quantos dias)\s+(?:para|ate|a)?\s*(?:o dia\s+)?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/))) {
      const b = parseDate(m[1]);
      if (b) {
        const t = new Date();
        const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
        const days = Math.round((b - today) / 86400000);
        return days >= 0 ? `Faltam ${fmt(days)} dias para ${m[1]}.\n\nNas Folhas: =DATA(…)-HOJE()` : `${m[1]} foi há ${fmt(-days)} dias.`;
      }
    }
    // Conta simples: "quanto é 12*3+4", "(250-30)/4", "2^10".
    const expr = q.replace(/^(?:quanto (?:e|sao|da|dá)|calcula(?:r)?|calcule|resultado de|resolve)\s+/, '').replace(/\bvezes\b/g, '*').replace(/\bmais\b/g, '+').replace(/\bmenos\b/g, '-').replace(/\b(?:a dividir por|dividido por)\b/g, '/').replace(/\belevado a\b/g, '^');
    if (/^[\d\s.,+\-*/x×÷^()%]+$/.test(expr) && /\d\s*[+\-*/x×÷^]\s*[\d(]/.test(expr)) {
      try {
        const v = evaluate(expr.replace(/(\d)\.(?=\d{3}\b)/g, '$1'));
        if (Number.isFinite(v)) return `${expr.trim()} = ${fmt(v)}`;
      } catch { /* não é uma conta */ }
    }
    return null;
  }

  // ---------- Fórmulas a partir de uma frase ----------

  function rangeIn(question) {
    const q = question.toUpperCase();
    const direct = q.match(/\b([A-Z]{1,2}\d+):([A-Z]{1,2}\d+)\b/);
    if (direct) return `${direct[1]}:${direct[2]}`;
    const between = q.match(/\b([A-Z]{1,2}\d+)\s+(?:A|ATÉ|ATE|E)\s+([A-Z]{1,2}\d+)\b/);
    if (between) return `${between[1]}:${between[2]}`;
    const column = q.match(/\bCOLUNA\s+([A-Z]{1,2})\b/);
    if (column) return `${column[1]}2:${column[1]}100`;
    return null;
  }

  function buildFormula(question) {
    const q = plain(question);
    const range = rangeIn(question) || 'A2:A10';
    const condition = q.match(/(maior(?:es)? (?:que|do que)|acima de|superior(?:es)? a|menor(?:es)? (?:que|do que)|abaixo de|inferior(?:es)? a|iguais? a)\s+(-?\d+(?:[.,]\d+)?)/);
    const op = condition ? (/maior|acima|superior/.test(condition[1]) ? '>' : /menor|abaixo|inferior/.test(condition[1]) ? '<' : '=') : '';
    const crit = condition ? `"${op}${condition[2].replace(',', '.')}"` : '';
    const word = question.match(/["«“]([^"»”]+)["»”]/);
    const pick = (name, explain) => ({ formula: `=${name}`, explain });
    if (/\b(procv|procurar|buscar|encontrar o valor)\b/.test(q)) return pick(`PROCV(${word ? `"${word[1]}"` : 'A2'};${range};2;FALSO)`, 'procura o valor na primeira coluna do intervalo e devolve a coluna indicada (aqui a 2.ª).');
    if (/\b(percentagem|percent|%)\b/.test(q)) return pick('B2/SOMA(B$2:B$10)', 'dá o peso de cada linha no total; formate a célula como percentagem.');
    if (/\b(se|caso|quando)\b/.test(q) && /\b(aprovado|reprovado|sim|nao|mostrar|escrever|aparecer)\b/.test(q)) return pick(`SE(A2>=10;"Aprovado";"Reprovado")`, 'mostra um texto se a condição for verdadeira e outro se for falsa.');
    if (/\b(media|medio)\b/.test(q)) return condition ? pick(`MÉDIA.SE(${range};${crit})`, 'faz a média só dos valores que cumprem a condição.') : pick(`MÉDIA(${range})`, 'calcula a média dos valores.');
    if (/\b(contar|quantos|quantas|numero de)\b/.test(q)) {
      if (condition || word) return pick(`CONTAR.SE(${range};${word ? `"${word[1]}"` : crit})`, 'conta só as células que cumprem a condição.');
      if (/\b(vazias?|em branco)\b/.test(q)) return pick(`CONTAR.VAZIO(${range})`, 'conta as células vazias.');
      if (/\b(texto|preenchidas?|nao vazias?)\b/.test(q)) return pick(`CONTAR.VAL(${range})`, 'conta as células preenchidas, com números ou texto.');
      return pick(`CONTAR(${range})`, 'conta as células com números.');
    }
    if (/\b(maximo|maior valor|mais alto|maior)\b/.test(q)) return pick(`MÁXIMO(${range})`, 'devolve o maior valor.');
    if (/\b(minimo|menor valor|mais baixo|menor)\b/.test(q)) return pick(`MÍNIMO(${range})`, 'devolve o menor valor.');
    if (/\b(mediana)\b/.test(q)) return pick(`MEDIANA(${range})`, 'devolve o valor do meio.');
    if (/\b(arredondar|arredonda|casas decimais)\b/.test(q)) return pick('ARRED(A2;2)', 'arredonda para 2 casas decimais.');
    if (/\b(juntar|concatenar|unir texto|nome completo)\b/.test(q)) return pick('CONCATENAR(A2;" ";B2)', 'junta os textos das duas células com um espaço.');
    if (/\b(hoje|data atual)\b/.test(q) && !/\bdias\b/.test(q)) return pick('HOJE()', 'mostra a data de hoje.');
    if (/\b(dias entre|diferenca entre (?:duas )?datas|idade|anos entre)\b/.test(q)) return /\bidade|anos\b/.test(q) ? pick('DATADIF(A2;HOJE();"Y")', 'calcula os anos completos desde a data em A2 (por exemplo a idade).') : pick('B2-A2', 'dá o número de dias entre a data em A2 e a data em B2.');
    if (/\b(erro|#n\/d|#div)\b/.test(q)) return pick('SE.ERRO(A2/B2;0)', 'mostra 0 (ou o que indicar) em vez de um erro.');
    if (/\b(maiusculas)\b/.test(q)) return pick('MAIÚSCULAS(A2)', 'passa o texto para maiúsculas. MINÚSCULAS faz o contrário.');
    if (/\b(posicao|classificacao|ranking|ordem)\b/.test(q)) return pick(`ORDEM(A2;${range.replace(/(\D+)(\d+):(\D+)(\d+)/, '$$$1$$$2:$$$3$$$4')})`, 'dá a posição do valor (1 = o maior) no intervalo.');
    if (/\b(iva)\b/.test(q)) return pick('A2*23%', 'calcula o IVA à taxa normal de 23%; para o total com IVA use =A2*(1+23%).');
    if (/\b(soma|somar|total|adicionar)\b/.test(q)) return condition || word ? pick(`SOMA.SE(${range};${word ? `"${word[1]}"` : crit})`, 'soma só os valores que cumprem a condição.') : pick(`SOMA(${range})`, 'soma os valores do intervalo.');
    return null;
  }

  // ---------- Rascunhos de documentos ----------

  // [palavras-chave, título, parágrafos]. {tema} é substituído pelo assunto indicado no pedido.
  const DRAFTS = [
    [['reclamacao', 'queixa', 'reclamar'], 'Reclamação', ['[Nome]\n[Morada]\n[Código postal e localidade]', '[Entidade]\n[Morada da entidade]', '[Localidade], [data]', 'Assunto: Reclamação sobre {tema}', 'Exmos. Senhores,', 'Venho por este meio apresentar reclamação sobre {tema}. No dia [data], [descreva o que aconteceu, com factos concretos: o que foi contratado ou comprado, o que correu mal e os contactos já feitos].', 'Esta situação causou-me [prejuízo ou incómodo]. Assim, solicito [o que pretende: reparação, substituição, reembolso ou resposta] no prazo de [15] dias úteis.', 'Junto em anexo [fatura, fotografias ou outros documentos].', 'Com os melhores cumprimentos,', '[Nome]']],
    [['ferias', 'pedido', 'requerimento', 'solicitar', 'declaracao'], 'Pedido', ['[Nome]\n[Função ou número]', 'Exmo(a). Senhor(a) [Nome e cargo],', 'Assunto: Pedido de {tema}', 'Venho por este meio solicitar {tema}, [indique datas, quantidades ou outros pormenores].', '[Explique brevemente o motivo, se for útil.]', 'Fico disponível para qualquer esclarecimento.', 'Com os melhores cumprimentos,', '[Nome]', '[Localidade], [data]']],
    [['ata', 'reuniao'], 'Ata de reunião', ['Ata: {tema}', 'Data: [data] · Hora: [início]–[fim] · Local: [local ou videochamada]', 'Presentes: [nomes]\nAusentes: [nomes]', 'Ordem de trabalhos:\n1. [Ponto 1]\n2. [Ponto 2]\n3. Outros assuntos', 'Resumo da discussão:\n[Pontos principais de cada tema, em frases curtas.]', 'Decisões:\n• [Decisão] — responsável: [nome], prazo: [data]', 'Próxima reunião: [data e hora]']],
    [['convite', 'convidar', 'evento', 'festa'], 'Convite', ['Convite: {tema}', 'Temos o prazer de o(a) convidar para {tema}, que terá lugar no dia [data], às [hora], em [local].', '[Uma ou duas frases sobre o programa ou o motivo do evento.]', 'Agradecemos a confirmação da presença até [data], através de [contacto].', 'Contamos consigo!', '[Nome ou organização]']],
    [['agradecimento', 'agradecer', 'obrigado'], 'Agradecimento', ['Caro(a) [Nome],', 'Quero agradecer-lhe {tema}. [Diga concretamente o que fez a diferença e porquê.]', '[Uma frase sobre o impacto ou sobre o futuro.]', 'Muito obrigado(a),', '[Nome]']],
    [['email', 'mail', 'mensagem'], 'Email', ['Assunto: {tema}', 'Olá [Nome],', '[Primeira frase: o motivo do email, sobre {tema}.]', '[Pormenores necessários, em dois ou três pontos curtos.]', '[O que precisa da outra pessoa e até quando.]', 'Obrigado(a),\n[Nome]']],
    [['carta', 'oficio'], 'Carta formal', ['[Nome]\n[Morada]', '[Destinatário]\n[Morada]', '[Localidade], [data]', 'Assunto: {tema}', 'Exmo(a). Senhor(a),', '[Primeiro parágrafo: o motivo da carta, sobre {tema}.]', '[Segundo parágrafo: os pormenores e os factos relevantes.]', '[Último parágrafo: o que pede ou propõe e como pode ser contactado(a).]', 'Com os melhores cumprimentos,', '[Nome]']],
    [['curriculo', 'cv'], 'Currículo', ['[Nome completo]', '[Telefone] · [Email] · [Localidade]', 'Perfil\n[Duas frases sobre quem é, a experiência e o que procura, ligadas a {tema}.]', 'Experiência profissional\n[Cargo] — [Empresa], [ano]–[ano]\n• [Resultado concreto, com números]\n• [Responsabilidade principal]', 'Formação\n[Curso] — [Instituição], [ano]', 'Competências\n[Línguas, programas, certificações]']],
    [['candidatura', 'motivacao', 'emprego', 'vaga'], 'Carta de candidatura', ['[Nome]\n[Contactos]', '[Empresa]\n[Ao cuidado de: Nome]', '[Localidade], [data]', 'Assunto: Candidatura a {tema}', 'Exmo(a). Senhor(a),', 'Venho apresentar a minha candidatura a {tema}, [onde viu o anúncio].', '[Porque é a pessoa certa: duas ou três provas concretas da sua experiência.]', '[Porque quer trabalhar nesta empresa em particular.]', 'Fico disponível para uma entrevista. Junto o meu currículo.', 'Com os melhores cumprimentos,', '[Nome]']],
    [['justificacao', 'justificar', 'falta', 'ausencia'], 'Justificação de falta', ['[Nome]\n[Turma, número ou função]', 'Exmo(a). Senhor(a) [Nome e cargo],', 'Assunto: Justificação de falta — {tema}', 'Venho justificar a minha ausência no(s) dia(s) [datas], devido a [motivo].', 'Junto [atestado ou outro comprovativo], se aplicável.', 'Com os melhores cumprimentos,', '[Nome]', '[Localidade], [data]']],
    [['demissao', 'rescisao', 'denuncia'], 'Carta de demissão', ['[Nome]\n[Morada]', '[Empresa]\n[Morada]', '[Localidade], [data]', 'Assunto: Denúncia do contrato de trabalho', 'Exmos. Senhores,', 'Venho comunicar a denúncia do meu contrato de trabalho {tema}, com efeitos a partir de [data], cumprindo o aviso prévio de [30/60] dias.', 'Agradeço a oportunidade e a colaboração ao longo deste período.', 'Com os melhores cumprimentos,', '[Nome]']],
    [['proposta', 'orcamento', 'comercial'], 'Proposta comercial', ['Proposta: {tema}', 'Para: [Cliente] · Data: [data] · Validade: [30] dias', 'O que propomos\n[Descrição clara do serviço ou produto e do resultado para o cliente.]', 'Valores\n[Item] — [quantidade] × [preço] = [total]\nTotal: [valor] (acresce IVA à taxa legal)', 'Prazos\n[Início, entregas e conclusão.]', 'Condições\n[Pagamento, garantia e o que não está incluído.]', 'Para aceitar, basta responder a este documento. Ficamos ao dispor.', '[Nome] · [Empresa] · [Contactos]']],
    [['aviso', 'comunicado', 'informacao', 'circular'], 'Comunicado', ['Comunicado: {tema}', '[Localidade], [data]', 'Informamos que {tema}. [O quê, quando e onde, numa frase.]', '[O que muda para quem lê e o que precisa de fazer.]', 'Para mais informações: [contacto].', '[Nome ou organização]']],
    [['relatorio', 'informe'], 'Relatório', ['Relatório: {tema}', 'Resumo\n[A conclusão principal em duas ou três frases.]', 'Contexto\n[Porque foi feito este relatório e que período ou área cobre.]', 'Resultados\n[Dados principais, com números e comparação com o objetivo.]', 'Análise\n[O que explica os resultados.]', 'Recomendações\n[Ações propostas, com responsável e prazo.]']]
  ].map(([keys, title, paragraphs]) => ({ keys, title, paragraphs }));

  function draftFor(question) {
    const q = plain(question);
    if (!/\b(escreve|escrever|redige|redigir|rascunho|modelo|minuta|ajuda-me a escrever|preciso de uma?|faz(?:-me)? uma?|cria(?:-me)? uma?)\b/.test(q)) return null;
    // O tipo de documento é a palavra-chave que aparece primeiro ("email sobre a reunião" é um email).
    let draft = null;
    let at = Infinity;
    // Palavras genéricas (carta, email, pedido…) só contam se não houver um tipo mais concreto.
    const GENERIC = new Set(['carta', 'oficio', 'email', 'mail', 'mensagem', 'pedido', 'modelo', 'informacao']);
    for (const pass of [false, true]) {
      // O tipo vem antes de "sobre" ("email sobre a reunião" é um email).
      const head = q.split(/\b(?:sobre|acerca de)\b/)[0];
      for (const d of DRAFTS) for (const k of d.keys) { if (!pass && GENERIC.has(k)) continue; const i = head.indexOf(k); if (i >= 0 && i < at) { at = i; draft = d; } }
      if (draft) break;
    }
    // O assunto começa depois da primeira palavra do tipo escolhido ("pedido de férias" → férias).
    if (draft) for (const k of draft.keys) { const i = q.indexOf(k); if (i >= 0 && i < at) at = i; }
    if (!draft) return null;
    // Assunto: o que vem depois de "sobre"; senão, o que vem depois do tipo de documento.
    const about = question.match(/\b(?:sobre|acerca de|a pedir)\s+(.+)$/i);
    const after = plain(question).slice(at).replace(/^\S+/, '');
    const rest = about ? about[1] : question.slice(question.length - after.length).replace(/^\s*(?:de|da|do|para|ao|à|a|com)\s+/i, '').replace(/^(?:um|uma|o|a|os|as)\s+/i, '');
    const topic = stripEnd(rest.replace(/[?!…]+$/, '')).slice(0, 120) || '[assunto]';
    const filled = draft.paragraphs.map((p) => p.replace(/\{tema\}/g, topic));
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = filled.map((p, i) => (i === 0 && /^(Relatório|Ata|Convite|Proposta|Comunicado):/.test(p) ? `<h1>${esc(p)}</h1>` : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)).join('');
    return { answer: `${draft.title} — rascunho pronto a completar (substitua o que está entre [ ]):\n\n${filled.join('\n\n')}`, action: { kind: 'draft', label: 'Inserir no Texto', html } };
  }

  // Outros guias parecidos com a pergunta, para sugerir a seguir (no máximo 3).
  function relatedGuides(query, except) {
    const list = query.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
    const has = (key) => { const stem = key.length > 5 ? key.slice(0, key.length - 2) : key; return list.some((w) => w.startsWith(stem)); };
    return GUIDES.filter((g) => g !== except && g.keys[0] !== 'limitacoes')
      .map((g) => ({ g, score: g.keys.filter(has).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => 'Como fazer: ' + x.g.title.replace(/\s*\([^)]*\)$/, '').toLowerCase());
  }

  function chat(content, searchDocs) {
    const messages = [...String(content || '').matchAll(/(?:^|\n\n)Utilizador:\s*([\s\S]*?)(?=\n\n(?:Assistente|Utilizador):|$)/g)];
    let question = (messages.length ? messages[messages.length - 1][1] : content).trim();
    // Pergunta de seguimento ("e a média?"): reaproveita o intervalo da pergunta anterior.
    const previous = messages.length > 1 ? messages[messages.length - 2][1].trim() : '';
    if (previous && words(question).length <= 5 && /^(e|agora|e se|e o|e a)\b/i.test(question) && !rangeIn(question) && rangeIn(previous)) {
      question = `${question} de ${rangeIn(previous)}`;
    }
    const query = plain(question);
    const draft = draftFor(question);
    if (draft) return draft;
    const calc = calculate(question);
    if (calc) return { answer: calc };
    if (/^(ola|bom dia|boa tarde|boa noite|oi|obrigad[oa])\b/.test(query) && words(query).length <= 4) {
      return { answer: /obrigad/.test(query) ? 'De nada! Se precisar de mais alguma coisa, é só perguntar.' : 'Olá! Pergunte-me como fazer algo no MyOffice, peça uma fórmula (por exemplo "soma de B2 a B10") ou a estrutura de uma apresentação.' };
    }
    if (/\b(formula|calcular|somar|soma|media|procv|contar|quantos|maximo|minimo|percentagem|arredondar)\b/.test(query) && !/\b(apresentacao|diapositivos|slides)\b/.test(query)) {
      const built = buildFormula(question);
      if (built) {
        const where = rangeIn(question) ? '' : ' Substitua o intervalo pelo das suas células.';
        return { answer: `Fórmula: ${built.formula}\n\nO que faz: ${built.explain}${where}\n\nPode inseri-la na célula ativa das Folhas com o botão abaixo. Os nomes em inglês (SUM, AVERAGE…) também funcionam.`, action: { kind: 'formula', label: 'Inserir na célula ativa', value: built.formula } };
      }
    }
    if (/\b(apresentacao|diapositivos|slides)\b/.test(query)) {
      const match = question.match(/\b(?:sobre|acerca de|de|para)\s+(.+)/i);
      const topic = match && match[1].replace(/[?.!…]+$/, '').trim();
      if (topic && words(topic).length >= 1 && !/^(o|a|um|uma)$/i.test(topic) && /\b(cria|criar|faz|fazer|estrutura|ideias|preparar|prepara|monta)\b/.test(query)) {
        const deck = generateDeck({ topic, count: 6 });
        if (!deck.error) return { answer: `Proposta para «${deck.title}» (estrutura de ${deck.type.toLowerCase()}):\n${deck.slides.map((slide, i) => `${i + 1}. ${slide.title} — ${slide.bullets[0]}`).join('\n')}\n\nPara a criar com tópicos e notas do orador: Diapositivos › Assistente › Criar apresentação.` };
      }
    }
    const helpish = /\b(como|onde|posso|consigo|quero|queria|preciso|fazer|usar|uso|ponho|por|inserir|criar|mudar|ativar|tirar)\b/.test(query);
    let guide = /\b(nao faz|ainda nao|nao consegue|limitac)/.test(query) ? GUIDES.find((g) => g.keys[0] === 'limitacoes') : findGuide(query);
    if (guide && guide.keys[0] !== 'limitacoes' && !helpish && guideScore(query, guide) < 3) guide = null;
    if (guide) return { answer: guideAnswer(guide), suggestions: relatedGuides(query, guide) };
    if (/\b(texto|documento|paragrafo|escrever|rever|melhorar)\b/.test(query) && /\b(rever|melhorar|corrigir|analisar)\b/.test(query)) {
      return { answer: 'Em Texto, abra o documento e escolha Rever com IA. Recebe um resumo, as frases longas e propostas de reescrita mais curtas; o documento não é alterado.' };
    }
    if (/\b(analisar|analise|estatistica)\b/.test(query)) {
      return { answer: 'Em Folhas, selecione as células com os cabeçalhos e escolha Dados › Analisar com IA. Recebe totais, médias, a tendência e os valores máximo e mínimo de cada coluna.' };
    }
    const docs = typeof searchDocs === 'function' ? searchDocs(question) : null;
    if (docs) return { answer: docs };
    // Sugestões só para pedidos de ajuda ("como…", "onde…", "quero…"), não para perguntas gerais.
    const near = helpish ? relatedGuides(query, null) : [];
    // Só um tema parecido: responde logo com ele.
    if (near.length === 1) {
      const only = GUIDES.find((g) => near[0] === 'Como fazer: ' + g.title.replace(/\s*\([^)]*\)$/, '').toLowerCase());
      if (only) return { answer: guideAnswer(only) };
    }
    return {
      answer: near.length
        ? 'Não tenho a certeza do que procura. Será um destes temas?'
        : 'Não tenho uma resposta para isso. Sei ajudar com o MyOffice: como fazer algo ("como unir células"), fórmulas ("média de C2 a C20"), contas ("15% de 230", "IVA de 100"), rascunhos ("escreve uma carta de candidatura a…") e estruturas de apresentação.',
      suggestions: near
    };
  }

  function assist(input) {
    const module = input && input.module;
    const task = input && input.task;
    const content = typeof (input && input.content) === 'string' ? input.content.trim().slice(0, 6000) : '';
    if (!['writer', 'sheets', 'assistant'].includes(module) || !['review', 'analyse', 'chat'].includes(task) || !content) {
      return { error: 'Não há conteúdo suficiente para analisar.' };
    }
    if (module === 'writer' && task === 'review') return reviewText(content);
    if (module === 'sheets' && task === 'analyse') return analyseTable(content);
    if (module === 'assistant' && task === 'chat') return chat(content, input.searchDocs);
    return { error: 'Esta tarefa não está disponível para este módulo.' };
  }

  const api = { generateDeck, suggest, suggestVisuals, classify, assist, buildFormula, calculate, findGuide: (q) => findGuide(plain(q)) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.MO = root.MO || {}).Assistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
