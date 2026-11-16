'use strict';

// Ponte IPC para o motor inteligente próprio do MyOffice. O motor usa regras e
// análise local de texto e tabelas; não descarrega nem executa modelos externos.
const Assistant = require('./src/js/assistant');

const operations = {
  generate: (input) => Assistant.generateDeck(input),
  suggest: (input) => Assistant.suggest(input),
  assist: (input) => Assistant.assist(input)
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
