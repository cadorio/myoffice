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
      // Na aplicação instalada, as Folhas e o Texto estão noutras janelas.
      if (MO.solo && window.api) {
        window.api.deliver(action.kind === 'formula' ? 'sheets' : 'writer', action);
        return;
      }
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

  function copyButton(text) {
    return h('button', { type: 'button', class: 'btn mo-assistant-copy', title: 'Copiar a resposta', onclick: async (e) => {
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copiado ✓'; setTimeout(() => { e.target.textContent = 'Copiar'; }, 1500); } catch { MO.toast('Não foi possível copiar.'); }
    } }, 'Copiar');
  }

  function addMessage(role, text, extra, action, suggestions) {
    if (!messages) return;
    const empty = messages.querySelector('.mo-assistant-empty');
    if (empty) empty.remove();
    const item = h('article', { class: 'mo-assistant-message ' + role }, text);
    if (role === 'ai' && !extra) {
      const row = h('div', { class: 'mo-assistant-actions' });
      if (action && (action.kind === 'formula' || action.kind === 'draft')) row.append(actionButton(action));
      row.append(copyButton(text));
      item.append(row);
    }
    // Perguntas sugeridas: clicar envia-as.
    if (Array.isArray(suggestions) && suggestions.length) {
      item.append(h('div', { class: 'mo-assistant-suggest' }, suggestions.slice(0, 3).map((q) => h('button', { type: 'button', onclick: () => send(q) }, q))));
    }
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
        const text = (MO.solo && window.api ? await window.api.contentOf('writer') : MO.modules.writer.assist ? MO.modules.writer.assist.text() : '').trim();
        if (!text) throw new Error('Não encontrei texto. Abra o documento no Texto e volte a perguntar.');
        request = { module: 'writer', task: 'review', content: text.slice(0, 6000) };
      } else if (/\b(analis|resum|estatistic|tendencia)\w*\b.*\b(folha|tabela|dados|livro)\b|\b(minha|esta|a) (folha|tabela)\b/.test(q)) {
        const table = MO.solo && window.api ? await window.api.contentOf('sheets') : MO.modules.sheets.assist ? MO.modules.sheets.assist.table() : '';
        if (!table) throw new Error('Não encontrei dados. Abra a folha nas Folhas e volte a perguntar.');
        request = { module: 'sheets', task: 'analyse', content: table };
      }
      const response = api
        ? await api.assist(request)
        : MO.Assistant.assist(request);
      if (response.error) throw new Error(response.error);
      const answer = response.answer || 'Não consegui formular uma resposta. Tente novamente.';
      history.push({ role: 'assistant', content: answer });
      addMessage('ai', answer, null, response.action, response.suggestions);
    } catch (error) {
      addMessage('ai', error.message || 'Ocorreu um erro ao contactar a IA.', 'error');
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function show() { if (input) input.focus(); }

  function newChat() {
    history.length = 0;
    messages.replaceChildren(h('p', { class: 'mo-assistant-empty' }, 'Conversa nova. Em que posso ajudar?'));
    input.focus();
  }

  function init(container) {
    messages = h('div', { class: 'mo-assistant-messages', 'aria-live': 'polite' },
      h('p', { class: 'mo-assistant-empty' }, 'Olá! Pergunte como fazer algo ("como unir células?"), peça uma fórmula ("média de C2 a C20"), uma conta ("15% de 230", "IVA de 100", "dias entre 01/02/2026 e 15/03/2026"), um rascunho ("escreve uma proposta comercial para…") ou a estrutura de uma apresentação.')
    );
    input = h('textarea', { rows: 2, placeholder: 'Escreva a sua pergunta…', 'aria-label': 'Mensagem para o Assistente' });
    sendButton = h('button', { type: 'button', onclick: () => send() }, 'Enviar');
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
    });
    const shortcuts = [
      ['Fórmula', 'Quantos valores maiores que 100 há de B2 a B20?'],
      ['Contas', 'IVA de 250 euros'],
      ['Escrever', 'Escreve uma carta de candidatura a assistente administrativo'],
      ['O meu documento', 'Resume o meu documento'],
      ['A minha folha', 'Analisa a minha folha'],
      ['Ajuda', 'Como fixar a primeira linha?'],
      ['Diapositivos', 'Cria uma apresentação sobre o lançamento do produto'],
      ['Notas', 'Como faço uma lista de tarefas nas Notas?']
    ];
    root = h('main', { class: 'mo-assistant' },
      h('header', { class: 'mo-assistant-hero' },
        h('span', { class: 'mo-assistant-kicker' }, 'MYOFFICE · INTELIGÊNCIA ARTIFICIAL'),
        h('h1', null, 'Em que posso ajudar?'),
        h('p', null, 'Guias passo a passo para os oito programas, contas feitas na hora, fórmulas a partir de uma frase, rascunhos de cartas e propostas, estruturas de apresentação e análise de texto e tabelas. Tudo no seu computador, sem Internet; as respostas seguem regras próprias e têm limites.')
      ),
      h('section', { class: 'mo-assistant-shortcuts', 'aria-label': 'Sugestões rápidas' },
        shortcuts.map(([label, prompt]) => h('button', { type: 'button', onclick: () => send(prompt) },
          h('strong', null, label), h('small', null, prompt)
        ))
      ),
      h('section', { class: 'mo-assistant-chat', 'aria-label': 'Conversa com o Assistente' },
        messages,
        h('form', { class: 'mo-assistant-compose', onsubmit: (event) => { event.preventDefault(); send(); } }, input, sendButton),
        h('div', { class: 'mo-assistant-tools' }, h('button', { type: 'button', class: 'btn', onclick: newChat, title: 'Apagar a conversa e começar outra' }, 'Nova conversa')),
        h('div', { class: 'mo-assistant-foot' }, 'A IA pode cometer erros. Confirme fórmulas, números e informação importante. · Enter para enviar, Shift+Enter para nova linha.')
      )
    );
    container.replaceChildren(root);
  }

  MO.AssistantApp = { init, show };
})();
