'use strict';

// Assistente autónomo do MyOffice. Usa o motor próprio de regras, sem modelos externos.
(function () {
  const MO = window.MO;
  const { h } = MO;
  let root, messages, input, sendButton, busy = false;
  const history = [];

  function addMessage(role, text, extra) {
    if (!messages) return;
    const empty = messages.querySelector('.mo-assistant-empty');
    if (empty) empty.remove();
    const item = h('article', { class: 'mo-assistant-message ' + role }, text);
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
      const request = { module: 'assistant', task: 'chat', content: history.slice(-6).map((m) => (m.role === 'user' ? 'Utilizador: ' : 'Assistente: ') + m.content).join('\n\n') };
      const response = api
        ? await api.assist(request)
        : MO.Assistant.assist(request);
      if (response.error) throw new Error(response.error);
      const answer = response.answer || 'Não consegui formular uma resposta. Tente novamente.';
      history.push({ role: 'assistant', content: answer });
      addMessage('ai', answer);
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
      h('p', { class: 'mo-assistant-empty' }, 'Olá! Sou o Assistente do MyOffice. Posso explicar como utilizar os programas, ajudar a escrever textos, criar fórmulas para Folhas ou estruturar apresentações.')
    );
    input = h('textarea', { rows: 2, placeholder: 'Escreva a sua pergunta…', 'aria-label': 'Mensagem para o Assistente' });
    sendButton = h('button', { type: 'button', onclick: () => send() }, 'Enviar');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
    });
    const shortcuts = [
      ['Texto', 'Ajuda-me a escrever um documento profissional sobre…'],
      ['Folhas', 'Explica como criar uma fórmula em Folhas para…'],
      ['Diapositivos', 'Cria uma estrutura de apresentação sobre…'],
      ['MyOffice', 'Explica passo a passo como posso…']
    ];
    root = h('main', { class: 'mo-assistant' },
      h('header', { class: 'mo-assistant-hero' },
        h('span', { class: 'mo-assistant-kicker' }, 'MYOFFICE · INTELIGÊNCIA ARTIFICIAL'),
        h('h1', null, 'Em que posso ajudar?'),
        h('p', null, 'Um assistente independente para analisar texto e tabelas, criar estruturas de apresentação e ajudar com fórmulas. Funciona sem modelos descarregados ou serviços externos; as respostas seguem regras locais e têm limites.')
      ),
      h('section', { class: 'mo-assistant-shortcuts', 'aria-label': 'Sugestões rápidas' },
        shortcuts.map(([label, prompt]) => h('button', { type: 'button', onclick: () => { input.value = prompt; input.focus(); } },
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
