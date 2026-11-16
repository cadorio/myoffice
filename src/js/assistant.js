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
    if (!suggestions.length) suggestions.push('Não encontrei frases excessivamente longas nem repetições frequentes pelas regras locais.');
    return { answer: `${observations.join('\n\n')}\n\nPontos a rever: ${suggestions.join(' ')}` };
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
    for (const column of numericColumns.slice(0, 6)) {
      const values = column.values;
      const total = values.reduce((sum, value) => sum + value, 0);
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      findings.push(`${column.header}: ${values.length} valores numéricos; mínimo ${minimum}, máximo ${maximum}, média ${(total / values.length).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}.`);
    }
    if (missing) findings.push(`Há ${missing} célula(s) vazia(s) nas linhas de dados.`);
    if (!numericColumns.length) findings.push('Não encontrei colunas com pelo menos dois valores numéricos reconhecíveis.');
    findings.push('A análise é calculada localmente e descreve apenas os valores selecionados; confirme cabeçalhos, unidades e período.');
    return { answer: findings.join('\n\n') };
  }

  function chat(content) {
    const messages = [...String(content || '').matchAll(/(?:^|\n\n)Utilizador:\s*([\s\S]*?)(?=\n\n(?:Assistente|Utilizador):|$)/g)];
    const question = (messages.length ? messages[messages.length - 1][1] : content).trim();
    const query = plain(question);
    if (/\b(formula|somar|soma|media|m[eé]dia|procv|contar|folhas)\b/.test(query)) {
      const formula = /\b(media|m[eé]dia)\b/.test(query) ? '=MÉDIA(B2:B8)' : /\b(procv|procurar|buscar)\b/.test(query) ? '=PROCV("pera";A1:C9;3;FALSO)' : /\b(contar|quantos)\b/.test(query) ? '=CONTAR(A1:A10)' : '=SOMA(A1:A10)';
      return { answer: `Posso ajudar com fórmulas suportadas pelo MyOffice. Exemplo: ${formula}. Substitua as referências pelo intervalo das suas células. Se indicar o resultado que pretende e onde estão os dados, posso sugerir uma fórmula mais adequada.` };
    }
    if (/\b(apresenta[cç][aã]o|diapositivos|slides)\b/.test(query)) {
      const match = question.match(/\b(?:sobre|acerca de)\s+(.+)/i);
      if (match && match[1] && !/[.…]$/.test(match[1])) {
        const deck = generateDeck({ topic: match[1], count: 6 });
        if (!deck.error) return { answer: `Para «${deck.title}», sugiro uma apresentação do tipo ${deck.type} com esta sequência: ${deck.slides.map((slide, index) => `${index + 1}. ${slide.title}`).join('; ')}. Use Diapositivos › Assistente › Criar apresentação para gerar esta estrutura no documento.` };
      }
      return { answer: 'Em Diapositivos, abra o separador Assistente e escolha “Criar apresentação”. Indique o tema e o público para obter uma estrutura com tópicos e notas, sem inventar dados.' };
    }
    if (/\b(texto|documento|paragrafo|escrever|rever)\b/.test(query)) {
      return { answer: 'Em Texto, escreva ou abra o documento e escolha “Rever com IA”. O Assistente local conta palavras, extrai frases relevantes e assinala frases longas ou termos repetidos; não altera o documento.' };
    }
    if (/\b(folha|tabela|dados|analise|analisar)\b/.test(query)) {
      return { answer: 'Em Folhas, selecione as células que pretende analisar e escolha “Analisar com IA”. O Assistente calcula estatísticas das colunas numéricas reconhecidas e indica células vazias.' };
    }
    return { answer: 'Sou o Assistente independente do MyOffice e trabalho sem modelos descarregados nem serviços externos. Posso estruturar apresentações, sugerir melhorias de escrita, rever texto e calcular estatísticas de tabelas. Faça uma pergunta sobre uma destas tarefas para eu ajudar.' };
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
    if (module === 'assistant' && task === 'chat') return chat(content);
    return { error: 'Esta tarefa não está disponível para este módulo.' };
  }

  const api = { generateDeck, suggest, classify, assist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.MO = root.MO || {}).Assistant = api;
})(typeof window !== 'undefined' ? window : globalThis);
