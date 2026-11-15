// Processo separado onde corre o modelo de IA. Se o modelo falhar (por exemplo por falta de
// memória), termina só este processo e a aplicação continua a funcionar.
import { getLlama, LlamaChatSession } from 'node-llama-cpp';

let loaded = null; // { path, llama, model }
let abort = null;

const send = (message) => process.parentPort.postMessage(message);

async function ensureModel(modelPath) {
  if (loaded && loaded.path === modelPath) return loaded;
  if (loaded) {
    await loaded.model.dispose().catch(() => {});
    await loaded.llama.dispose().catch(() => {});
    loaded = null;
  }
  const llama = await getLlama({ build: 'never', logLevel: 'error' });
  const model = await llama.loadModel({ modelPath, useMmap: true });
  loaded = { path: modelPath, llama, model };
  return loaded;
}

async function run(job) {
  abort = new AbortController();
  let context = null;
  try {
    send({ type: 'stage', text: 'A carregar o modelo…' });
    const rt = await ensureModel(job.modelPath);
    context = await rt.model.createContext({ contextSize: job.contextSize });
    const grammar = await rt.llama.createGrammarForJsonSchema(job.schema);
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: job.system });
    let chars = 0;
    send({ type: 'stage', text: 'A escrever…' });
    const answer = await session.prompt(job.prompt, {
      grammar,
      maxTokens: job.maxTokens,
      temperature: 0.4,
      // Penalização ligeira das repetições. Valores mais altos evitam repetições mas levam o modelo
      // a inventar palavras; os tópicos repetidos que sobrarem são removidos depois.
      repeatPenalty: { penalty: 1.08, lastTokens: 96 },
      signal: abort.signal,
      stopOnAbortSignal: true,
      onTextChunk: (chunk) => {
        chars += chunk.length;
        send({ type: 'progress', chars });
      }
    });
    if (abort.signal.aborted) send({ type: 'error', message: 'Pedido cancelado.' });
    else send({ type: 'result', data: grammar.parse(answer) });
  } catch (error) {
    send({ type: 'error', message: abort.signal.aborted ? 'Pedido cancelado.' : String((error && error.message) || error).slice(0, 300) });
  } finally {
    if (context) await context.dispose().catch(() => {});
    abort = null;
  }
}

process.parentPort.on('message', ({ data }) => {
  if (data.type === 'run' && !abort) run(data.job);
  else if (data.type === 'cancel' && abort) abort.abort();
});
