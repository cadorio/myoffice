'use strict';

// IA local dos Diapositivos: um modelo de linguagem aberto que corre no computador do utilizador.
// O modelo é descarregado uma vez (a pedido do utilizador) e depois funciona sem Internet;
// nenhum texto dos documentos sai do computador.
const { app, utilityProcess } = require('electron');
const path = require('path');
const fsp = require('fs/promises');
const { download, isInstalled } = require('./ai-download');

// Modelos disponíveis. As licenças permitem uso comercial; o SHA-256 garante que o ficheiro é o esperado.
const MODELS = [
  {
    id: 'melhor',
    name: 'Phi-3.5 mini',
    label: 'Melhor qualidade',
    note: 'Textos mais coerentes. Recomendado para computadores com 8 GB de memória ou mais.',
    file: 'phi-3.5-mini-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    bytes: 2393232672,
    sha256: 'e4165e3a71af97f1b4820da61079826d8752a2088e313af0c7d346796c38eff5',
    license: 'MIT (Microsoft)',
    // Memória de trabalho do modelo, em tokens. Dentro do Electron, uma reserva única acima de cerca de
    // 1 GB termina o processo; com 2048 tokens este modelo fica nos 0,8 GB.
    contextSize: 2048
  },
  {
    id: 'rapido',
    name: 'Qwen2.5 1.5B',
    label: 'Mais rápido',
    note: 'Cerca de três vezes mais rápido e mais leve, mas repete-se e erra mais.',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320736,
    sha256: '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e',
    license: 'Apache 2.0 (Alibaba Cloud)',
    contextSize: 4096
  }
];

const ALLOWED_HOST = (host) => host === 'huggingface.co' || host.endsWith('.hf.co') || host.endsWith('.huggingface.co');
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

const modelDir = () => path.join(app.getPath('userData'), 'models');
const modelPath = (model) => path.join(modelDir(), model.file);
const byId = (id) => MODELS.find((m) => m.id === id) || null;

let notify = () => {}; // envia eventos de progresso para a janela
let downloading = null; // { id, abort }
let worker = null; // processo separado onde corre o modelo
let pending = null; // { resolve, reject } do pedido em curso
let idleTimer = null;

// Em desenvolvimento pode indicar-se outro ficheiro de modelo, para testes.
const devModel = () => (!app.isPackaged && process.env.MYOFFICE_AI_MODEL ? process.env.MYOFFICE_AI_MODEL : null);

async function status() {
  const models = [];
  for (const m of MODELS) {
    models.push({ id: m.id, name: m.name, label: m.label, note: m.note, license: m.license, bytes: m.bytes, installed: await isInstalled(modelPath(m), m.bytes), downloading: Boolean(downloading && downloading.id === m.id) });
  }
  const active = models.find((m) => m.installed) || null;
  return { models, active: devModel() ? MODELS[0].id : active ? active.id : null, busy: Boolean(pending) };
}

async function startDownload(id) {
  const model = byId(id);
  if (!model) return { error: 'Modelo desconhecido.' };
  if (downloading) return { error: 'Já há um descarregamento em curso.' };
  const abort = new AbortController();
  downloading = { id, abort };
  try {
    await download({
      url: model.url,
      dest: modelPath(model),
      bytes: model.bytes,
      sha256: model.sha256,
      allowedHost: ALLOWED_HOST,
      signal: abort.signal,
      onProgress: (received, total) => notify({ type: 'download', id, received, total })
    });
    return { ok: true };
  } catch (error) {
    return { error: error.message || 'Não foi possível descarregar o modelo.' };
  } finally {
    downloading = null;
  }
}

function cancel() {
  if (downloading) downloading.abort.abort();
  if (pending && worker) worker.postMessage({ type: 'cancel' });
  return true;
}

function stopWorker() {
  clearTimeout(idleTimer);
  if (worker) worker.kill();
  worker = null;
}

async function remove(id) {
  const model = byId(id);
  if (!model || (downloading && downloading.id === id)) return false;
  stopWorker();
  await fsp.rm(modelPath(model), { force: true });
  return true;
}

function startWorker() {
  const child = utilityProcess.fork(path.join(__dirname, 'ai-worker.mjs'), [], { serviceName: 'IA local', stdio: 'ignore' });
  child.on('message', (message) => {
    if (message.type === 'stage' || message.type === 'progress') return notify(message);
    const job = pending;
    pending = null;
    if (!job) return;
    if (message.type === 'result') job.resolve(message.data);
    else job.reject(new Error(message.message || 'A IA não conseguiu responder.'));
  });
  child.on('exit', () => {
    if (worker === child) worker = null;
    const job = pending;
    pending = null;
    // O processo terminou a meio de um pedido: normalmente falta de memória para o modelo.
    if (job) job.reject(new Error('O modelo de IA não conseguiu correr neste computador (memória insuficiente ou processador não suportado). Experimente o modelo mais rápido, que é mais leve.'));
  });
  return child;
}

// Faz uma pergunta ao modelo e devolve a resposta já validada contra o esquema JSON.
async function ask(system, prompt, schema, maxTokens) {
  if (pending) throw new Error('A IA já está a trabalhar noutro pedido.');
  const st = await status();
  if (!st.active) throw new Error('Descarregue primeiro um modelo de IA (Assistente › Modelo de IA).');
  const model = byId(st.active);
  clearTimeout(idleTimer);
  if (!worker) worker = startWorker();
  try {
    return await new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage({ type: 'run', job: { modelPath: devModel() || modelPath(model), system, prompt, schema, maxTokens: Math.min(maxTokens, model.contextSize - 500), contextSize: model.contextSize } });
    });
  } finally {
    // Liberta a memória do modelo ao fim de algum tempo sem uso.
    idleTimer = setTimeout(stopWorker, IDLE_UNLOAD_MS);
  }
}

const STYLE =
  'Escreves o conteúdo de apresentações, em português de Portugal. Títulos com poucas palavras. ' +
  'Cada tópico é uma frase curta, concreta e diferente das outras, sobre o tema pedido. Não repitas diapositivos. ' +
  'Não inventes números nem montantes: quando for preciso um valor, diz o que deve ser indicado. Responde apenas com JSON.';

// Os modelos abertos aprendem sobretudo com texto do Brasil. Converte as grafias e palavras mais
// frequentes para português europeu; não é um tradutor, só corrige os casos comuns.
const EUROPEAN = [
  ['planejamento', 'planeamento'], ['planejar', 'planear'], ['planejad', 'planead'], ['engajamento', 'envolvimento'], ['engajar', 'envolver'],
  ['gerenciamento', 'gestão'], ['gerenciar', 'gerir'], ['demanda', 'procura'], ['mídias sociais', 'redes sociais'], ['mídia social', 'redes sociais'], ['mídia', 'comunicação social'],
  ['equipe', 'equipa'], ['usuário', 'utilizador'], ['usuários', 'utilizadores'], ['celular', 'telemóvel'], ['celulares', 'telemóveis'], ['registro', 'registo'], ['registrar', 'registar'],
  ['contato', 'contacto'], ['contatos', 'contactos'], ['fato', 'facto'], ['fatos', 'factos'], ['ônibus', 'autocarro'], ['trem', 'comboio'], ['tela', 'ecrã'], ['telas', 'ecrãs'],
  ['aplicativo', 'aplicação'], ['aplicativos', 'aplicações'], ['acadêmic', 'académic'], ['econômic', 'económic'], ['eletrônic', 'eletrónic'], ['gênero', 'género'], ['gêneros', 'géneros'],
  ['prêmio', 'prémio'], ['prêmios', 'prémios'], ['tônic', 'tónic'], ['polêmic', 'polémic'], ['bônus', 'bónus'], ['anônim', 'anónim'], ['patrimônio', 'património'], ['colônia', 'colónia'],
  ['você pode', 'pode'], ['vocês', 'os participantes'], ['você', 'o leitor'], ['R\\$', '€']
]
  .sort((a, b) => b[0].length - a[0].length) // as formas mais longas (plurais, expressões) primeiro
  .map(([from, to]) => [new RegExp('(?<![\\p{L}])' + from, 'giu'), to]);

function european(text) {
  let out = text;
  for (const [pattern, to] of EUROPEAN) out = out.replace(pattern, (match) => (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to));
  return out;
}

const str = (value, max) => (typeof value === 'string' ? european(value.replace(/\s+/g, ' ').trim()).slice(0, max) : '');
// Limpa uma lista de tópicos: tira marcas e rótulos no início ("Nota:", "1.") e os tópicos repetidos.
function list(value, maxItems) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    for (const piece of String(item).split(/\s*(?:Nota|Balanço|Tópico|Ponto)\s*\d*:\s*/i)) {
      const text = str(piece, 220).replace(/^[-•*\d.)\s]+/, '').replace(/[.;]$/, '');
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out.slice(0, maxItems);
}
const cleanSlide = (s) => ({ title: str(s && s.title, 120).replace(/[.:]$/, ''), bullets: list(s && s.bullets, 5), notes: str(s && s.notes, 600) });
const slideSchema = { type: 'object', properties: { title: { type: 'string' }, bullets: { type: 'array', minItems: 3, maxItems: 4, items: { type: 'string' } }, notes: { type: 'string' } } };

async function generate(input) {
  // O tema e o público são do utilizador: não se lhes mexe na grafia.
  const raw = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const topic = raw(input && input.topic, 400);
  const audience = raw(input && input.audience, 200);
  const count = Math.max(3, Math.min(6, parseInt(input && input.count, 10) || 5));
  if (!topic) return { error: 'Indique o tema da apresentação.' };
  try {
    const data = await ask(
      STYLE,
      `Cria uma apresentação com ${count} diapositivos sobre: ${topic}.` +
        (audience ? ` Público: ${audience}.` : '') +
        ' Os diapositivos contam uma história, do contexto até aos próximos passos. Cada um tem um título, 3 a 4 tópicos e notas do orador com uma ou duas frases.',
      { type: 'object', properties: { title: { type: 'string' }, subtitle: { type: 'string' }, slides: { type: 'array', minItems: count, maxItems: count, items: slideSchema } } },
      230 * count + 100
    );
    // Um modelo pequeno por vezes repete diapositivos: ficam só os de título diferente.
    const seen = new Set();
    const slides = (Array.isArray(data.slides) ? data.slides : []).map(cleanSlide).filter((s) => {
      const key = s.title.toLowerCase();
      if (!s.title || !s.bullets.length || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!slides.length) return { error: 'A IA não devolveu diapositivos utilizáveis. Tente de novo.' };
    return { title: str(data.title, 120) || topic, subtitle: str(data.subtitle, 160), slides };
  } catch (error) {
    return { error: error.message || 'A IA não conseguiu responder.' };
  }
}

async function suggest(input) {
  const title = str(input && input.title, 200);
  const bullets = list(input && input.bullets, 12);
  if (!title && !bullets.length) return { error: 'Este diapositivo ainda não tem texto para melhorar.' };
  try {
    const data = await ask(
      STYLE,
      'Reescreve este diapositivo em duas versões melhores: a primeira mais concisa, a segunda mais clara para quem não conhece o assunto. ' +
        'Mantém os factos do original e não acrescentes informação nova.\n\n' +
        `Título: ${title || '(sem título)'}\nTópicos:\n${bullets.map((b) => '- ' + b).join('\n') || '(sem tópicos)'}`,
      { type: 'object', properties: { versions: { type: 'array', minItems: 2, maxItems: 2, items: slideSchema } } },
      700
    );
    const labels = ['IA: mais conciso', 'IA: mais claro'];
    const suggestions = (Array.isArray(data.versions) ? data.versions : [])
      .map(cleanSlide)
      .filter((s) => s.title || s.bullets.length)
      .map((s, i) => ({ ...s, label: labels[i] || 'IA', reason: 'Versão escrita pelo modelo de IA local. Confirme que os factos se mantêm.' }));
    return suggestions.length ? { suggestions } : { error: 'A IA não devolveu sugestões utilizáveis.' };
  } catch (error) {
    return { error: error.message || 'A IA não conseguiu responder.' };
  }
}

function register(ipcMain, isTrusted, send) {
  notify = send;
  const guard = (fn) => async (event, arg) => (isTrusted(event) ? fn(arg) : { error: 'Pedido não autorizado.' });
  ipcMain.handle('ai:status', guard(status));
  ipcMain.handle('ai:download', guard(startDownload));
  ipcMain.handle('ai:cancel', guard(cancel));
  ipcMain.handle('ai:remove', guard(remove));
  ipcMain.handle('ai:generate', guard(generate));
  ipcMain.handle('ai:suggest', guard(suggest));
  app.on('before-quit', () => {
    cancel();
    stopWorker();
  });
}

module.exports = { register };
