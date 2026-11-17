'use strict';

// Assistente autónomo do MyOffice. Usa o motor próprio de regras, sem modelos externos.
(function () {
  const MO = window.MO;
  const { h } = MO;
  let root, messages, input, sendButton, busy = false;
  const history = [];

  // Ações que a resposta pode trazer: inserir uma fórmula nas Folhas ou um rascunho no Texto.
  function actionButton(action) {
    const run = () => {
      if (action.kind === 'formula' && MO.modules.sheets.assist) {
        MO.showView('sheets');
        MO.modules.sheets.assist.put(action.value);
        MO.toast(`Fórmula inserida em ${MO.modules.sheets.assist.activeAddr()}.`);
      } else if (action.kind === 'draft' && MO.modules.writer.assist) {
        MO.showView('writer');
        MO.modules.writer.assist.insert(action.html);
        MO.toast('Rascunho inserido no Texto.');
      }
    };
    return h('button', { type: 'button', class: 'btn mo-assistant-action', onclick: run }, action.label);
  }

  function addMessage(role, text, extra, action) {
    if (!messages) return;
    const empty = messages.querySelector('.mo-assistant-empty');
    if (empty) empty.remove();
    const item = h('article', { class: 'mo-assistant-message ' + role }, text);
    if (action && (action.kind === 'formula' || action.kind === 'draft')) item.append(h('div', { class: 'mo-assistant-actions' }, actionButton(action)));
    if (extra) item.classList.add(extra);
    messages.append(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(value) {
    busy = value;
    sendButton.disabled = value;
    sendButton.textContent = value ? 'A pensar…' : 'Enviar';
    input.disabled = value;
  }

  async function send(text) {
    const prompt = String(text || input.value).trim();
    if (!prompt || busy) return;
    input.value = '';
    addMessage('user', prompt);
    history.push({ role: 'user', content: prompt });
    setBusy(true);
    try {
      const api = window.api && window.api.ai;
      let request = { module: 'assistant', task: 'chat', content: history.slice(-6).map((m) => (m.role === 'user' ? 'Utilizador: ' : 'Assistente: ') + m.content).join('\n\n') };
      // Pedidos sobre o documento ou a folha abertos usam o conteúdo real.
      const q = prompt.toLocaleLowerCase('pt-PT').normalize('NFD').replace(/\p{M}/gu, '');
      if (/\b(resum|rev|analis|melhor|corrig)\w*\b.*\b(documento|texto)\b|\b(meu|este|o) (documento|texto)\b/.test(q)) {
        const text = MO.modules.writer.assist ? MO.modules.writer.assist.text().trim() : '';
        if (!text) throw new Error('O documento do Texto está vazio. Escreva ou abra um documento e volte a perguntar.');
        request = { module: 'writer', task: 'review', content: text.slice(0, 6000) };
      } else if (/\b(analis|resum|estatistic|tendencia)\w*\b.*\b(folha|tabela|dados|livro)\b|\b(minha|esta|a) (folha|tabela)\b/.test(q)) {
        const table = MO.modules.sheets.assist ? MO.modules.sheets.assist.table() : '';
        if (!table) throw new Error('A folha está vazia. Abra ou escreva dados em Folhas e volte a perguntar.');
        request = { module: 'sheets', task: 'analyse', content: table };
      }
      const response = api
        ? await api.assist(request)
        : MO.Assistant.assist(request);
      if (response.error) throw new Error(response.error);
      const answer = response.answer || 'Não consegui formular uma resposta. Tente novamente.';
      history.push({ role: 'assistant', content: answer });
      addMessage('ai', answer, null, response.action);
    } catch (error) {
      addMessage('ai', error.message || 'Ocorreu um erro ao contactar a IA.', 'error');
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function show() { if (input) input.focus(); }

  function init(container) {
    messages = h('div', { class: 'mo-assistant-messages', 'aria-live': 'polite' },
      h('p', { class: 'mo-assistant-empty' }, 'Olá! Pergunte como fazer algo ("como unir células?"), peça uma fórmula ("média de C2 a C20") ou a estrutura de uma apresentação ("cria uma apresentação sobre…").')
    );
    input = h('textarea', { rows: 2, placeholder: 'Escreva a sua pergunta…', 'aria-label': 'Mensagem para o Assistente' });
    sendButton = h('button', { type: 'button', onclick: () => send() }, 'Enviar');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
    });
    const shortcuts = [
      ['Fórmula', 'Quantos valores maiores que 100 há de B2 a B20?'],
      ['Escrever', 'Escreve uma reclamação sobre a entrega atrasada'],
      ['O meu documento', 'Resume o meu documento'],
      ['A minha folha', 'Analisa a minha folha'],
      ['Ajuda', 'Como fixar a primeira linha?'],
      ['Diapositivos', 'Cria uma apresentação sobre o lançamento do produto']
    ];
    root = h('main', { class: 'mo-assistant' },
      h('header', { class: 'mo-assistant-hero' },
        h('span', { class: 'mo-assistant-kicker' }, 'MYOFFICE · INTELIGÊNCIA ARTIFICIAL'),
        h('h1', null, 'Em que posso ajudar?'),
        h('p', null, 'Guias passo a passo, fórmulas escritas a partir de uma frase, estruturas de apresentação e análise de texto e tabelas. Tudo no seu computador, sem Internet; as respostas seguem regras próprias e têm limites.')
      ),
      h('section', { class: 'mo-assistant-shortcuts', 'aria-label': 'Sugestões rápidas' },
        shortcuts.map(([label, prompt]) => h('button', { type: 'button', onclick: () => send(prompt) },
          h('strong', null, label), h('small', null, prompt)
        ))
      ),
      h('section', { class: 'mo-assistant-chat', 'aria-label': 'Conversa com o Assistente' },
        messages,
        h('form', { class: 'mo-assistant-compose', onsubmit: (event) => { event.preventDefault(); send(); } }, input, sendButton),
        h('div', { class: 'mo-assistant-foot' }, 'A IA pode cometer erros. Confirme fórmulas, números e informação importante. · Enter para enviar, Shift+Enter para nova linha.')
      )
    );
    container.replaceChildren(root);
  }

  MO.AssistantApp = { init, show };
})();
