'use strict';

// Motor de fórmulas da folha de cálculo. Sem dependências do DOM, para poder ser testado em Node.
(function (root) {
  class FError {
    constructor(code) {
      this.code = code;
    }
  }

  const ALIASES = {
    SOMA: 'SUM',
    'MÉDIA': 'AVERAGE',
    MEDIA: 'AVERAGE',
    'MÍNIMO': 'MIN',
    MINIMO: 'MIN',
    'MÁXIMO': 'MAX',
    MAXIMO: 'MAX',
    CONTAR: 'COUNT',
    'CONTAR.VAL': 'COUNTA',
    PRODUTO: 'PRODUCT',
    SE: 'IF',
    'SE.ERRO': 'IFERROR',
    E: 'AND',
    OU: 'OR',
    'NÃO': 'NOT',
    NAO: 'NOT',
    ARRED: 'ROUND',
    RAIZQ: 'SQRT',
    RAIZ: 'SQRT',
    'POTÊNCIA': 'POWER',
    POTENCIA: 'POWER',
    RESTO: 'MOD',
    CONCATENAR: 'CONCAT',
    CONCATENATE: 'CONCAT',
    'NÚM.CARACT': 'LEN',
    'MAIÚSCULAS': 'UPPER',
    'MINÚSCULAS': 'LOWER',
    COMPACTAR: 'TRIM',
    HOJE: 'TODAY',
    'SOMA.SE': 'SUMIF',
    'CONTAR.SE': 'COUNTIF',
    PROCV: 'VLOOKUP'
  };

  function colName(c) {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  function colIndex(name) {
    let n = 0;
    for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function parseAddr(a) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(a);
    return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
  }

  const addr = (r, c) => colName(c) + (r + 1);

  const NUM_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

  function parseNumber(text) {
    const t = text.trim();
    if (NUM_RE.test(t)) return Number(t.replace(',', '.'));
    if (t.endsWith('%') && NUM_RE.test(t.slice(0, -1))) return Number(t.slice(0, -1).replace(',', '.')) / 100;
    return null;
  }

  function parseLiteral(raw) {
    const n = parseNumber(raw);
    if (n !== null) return n;
    const t = raw.trim().toUpperCase();
    if (t === 'VERDADEIRO' || t === 'TRUE') return true;
    if (t === 'FALSO' || t === 'FALSE') return false;
    return raw[0] === "'" ? raw.slice(1) : raw;
  }

  // ---------- Análise léxica e sintática ----------

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        let s = '';
        for (;;) {
          if (j >= src.length) throw new FError('#ERRO!');
          if (src[j] === '"') {
            if (src[j + 1] === '"') {
              s += '"';
              j += 2;
              continue;
            }
            break;
          }
          s += src[j++];
        }
        out.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      const rest = src.slice(i);
      let m;
      if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest))) {
        out.push({ t: 'num', v: Number(m[0]) });
      } else if ((m = /^\$?([A-Za-z]{1,2})\$?(\d+)(?![A-Za-zÀ-ÿ0-9_.(])/.exec(rest))) {
        out.push({ t: 'ref', c: colIndex(m[1]), r: Number(m[2]) - 1 });
      } else if ((m = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*/.exec(rest))) {
        out.push({ t: 'id', v: m[0].toUpperCase() });
      } else if ((m = /^(<=|>=|<>)/.exec(rest)) || (m = /^[-+*/^&=<>(),;:%]/.exec(rest))) {
        out.push({ t: 'op', v: m[0] });
      } else {
        throw new FError('#ERRO!');
      }
      i += m[0].length;
    }
    return out;
  }

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => p < toks.length && toks[p].t === 'op' && toks[p].v === v;
    const expect = (v) => {
      if (!isOp(v)) throw new FError('#ERRO!');
      p++;
    };

    function binary(next, ops) {
      return function level() {
        let left = next();
        while (p < toks.length && toks[p].t === 'op' && ops.includes(toks[p].v)) {
          const op = toks[p++].v;
          left = { k: 'bin', op, a: left, b: next() };
        }
        return left;
      };
    }

    function primary() {
      const tok = peek();
      if (!tok) throw new FError('#ERRO!');
      p++;
      if (tok.t === 'num') return { k: 'lit', v: tok.v };
      if (tok.t === 'str') return { k: 'lit', v: tok.v };
      if (tok.t === 'ref') {
        if (isOp(':')) {
          p++;
          const to = toks[p++];
          if (!to || to.t !== 'ref') throw new FError('#ERRO!');
          return { k: 'range', a: tok, b: to };
        }
        return { k: 'ref', c: tok.c, r: tok.r };
      }
      if (tok.t === 'id') {
        if (isOp('(')) {
          p++;
          const args = [];
          if (!isOp(')')) {
            do {
              args.push(expr());
            } while ((isOp(',') || isOp(';')) && ++p);
          }
          expect(')');
          return { k: 'call', name: Object.prototype.hasOwnProperty.call(ALIASES, tok.v) ? ALIASES[tok.v] : tok.v, args };
        }
        if (tok.v === 'VERDADEIRO' || tok.v === 'TRUE') return { k: 'lit', v: true };
        if (tok.v === 'FALSO' || tok.v === 'FALSE') return { k: 'lit', v: false };
        throw new FError('#NOME?');
      }
      if (tok.t === 'op' && tok.v === '(') {
        const inner = expr();
        expect(')');
        return inner;
      }
      throw new FError('#ERRO!');
    }

    function postfix() {
      let node = primary();
      while (isOp('%')) {
        p++;
        node = { k: 'pct', a: node };
      }
      return node;
    }

    function power() {
      const base = postfix();
      if (isOp('^')) {
        p++;
        return { k: 'bin', op: '^', a: base, b: unary() };
      }
      return base;
    }

    function unary() {
      if (isOp('-')) {
        p++;
        return { k: 'neg', a: unary() };
      }
      if (isOp('+')) {
        p++;
        return unary();
      }
      return power();
    }

    const term = binary(unary, ['*', '/']);
    const additive = binary(term, ['+', '-']);
    const concat = binary(additive, ['&']);
    const expr = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);

    const ast = expr();
    if (p < toks.length) throw new FError('#ERRO!');
    return ast;
  }

  // ---------- Avaliação ----------

  function scalar(v) {
    if (Array.isArray(v)) throw new FError('#VALOR!');
    return v;
  }

  function num(v) {
    v = scalar(v);
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = parseNumber(v);
    if (n === null) throw new FError('#VALOR!');
    return n;
  }

  function text(v) {
    v = scalar(v);
    if (v === null) return '';
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    return String(v);
  }

  function truthy(v) {
    v = scalar(v);
    if (typeof v === 'string') {
      const t = v.trim().toUpperCase();
      if (t === 'VERDADEIRO' || t === 'TRUE') return true;
      if (t === 'FALSO' || t === 'FALSE') return false;
      throw new FError('#VALOR!');
    }
    return Boolean(v);
  }

  // Números de uma lista de argumentos: nos intervalos, o texto e as células vazias são ignorados.
  function nums(args) {
    const out = [];
    for (const a of args) {
      if (Array.isArray(a)) {
        for (const v of a) if (typeof v === 'number') out.push(v);
      } else if (a !== null) {
        out.push(num(a));
      }
    }
    return out;
  }

  const flat = (args) => args.flatMap((a) => (Array.isArray(a) ? a : [a]));

  function compare(a, b) {
    a = scalar(a);
    b = scalar(b);
    if (a === null) a = typeof b === 'string' ? '' : 0;
    if (b === null) b = typeof a === 'string' ? '' : 0;
    if (typeof a === 'boolean') a = a ? 1 : 0;
    if (typeof b === 'boolean') b = b ? 1 : 0;
    if (typeof a === 'string' && typeof b === 'string') {
      const x = a.toUpperCase();
      const y = b.toUpperCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    if (typeof a === 'string') return 1;
    if (typeof b === 'string') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function round(x, digits) {
    const p = Math.pow(10, Math.trunc(digits));
    return (Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * p)) / p;
  }

  // Critério de SOMA.SE / CONTAR.SE: um valor, ou um operador seguido de valor (">10", "<>x").
  function criterion(c) {
    c = scalar(c);
    const m = typeof c === 'string' ? /^(<=|>=|<>|<|>|=)(.*)$/.exec(c) : null;
    const op = m ? m[1] : '=';
    const target = typeof c === 'string' ? parseLiteral(m ? m[2] : c) : c;
    return (v) => {
      if (v === null) return false;
      const sameKind = (typeof v === 'string') === (typeof target === 'string');
      if (!sameKind) return op === '<>';
      const k = compare(v, target);
      if (op === '=') return k === 0;
      if (op === '<>') return k !== 0;
      if (op === '<') return k < 0;
      if (op === '>') return k > 0;
      return op === '<=' ? k <= 0 : k >= 0;
    };
  }

  function needRange(v) {
    if (!Array.isArray(v)) throw new FError('#VALOR!');
    return v;
  }

  const FUNCS = {
    SUMIF: (a) => {
      const range = needRange(a[0]);
      const values = a.length > 2 ? needRange(a[2]) : range;
      const test = criterion(a[1]);
      let sum = 0;
      range.forEach((v, i) => {
        if (test(v) && typeof values[i] === 'number') sum += values[i];
      });
      return sum;
    },
    COUNTIF: (a) => needRange(a[0]).filter(criterion(a[1])).length,
    VLOOKUP: (a) => {
      const table = needRange(a[1]);
      const cols = table.cols;
      const col = Math.trunc(num(a[2]));
      if (col < 1 || col > cols) throw new FError('#REF!');
      const exact = a.length > 3 && !truthy(a[3]);
      const key = scalar(a[0]);
      let hit = -1;
      for (let r = 0; r * cols < table.length; r++) {
        const v = table[r * cols];
        if (v === null) continue;
        const k = compare(v, key);
        if (k === 0) {
          hit = r;
          break;
        }
        // Sem correspondência exata, fica a última linha abaixo do valor (tabela ordenada).
        if (!exact && k < 0) hit = r;
        else if (!exact) break;
      }
      if (hit < 0) throw new FError('#N/D');
      const out = table[hit * cols + col - 1];
      return out === null ? 0 : out;
    },
    SUM: (a) => nums(a).reduce((s, v) => s + v, 0),
    PRODUCT: (a) => nums(a).reduce((s, v) => s * v, 1),
    AVERAGE: (a) => {
      const n = nums(a);
      if (!n.length) throw new FError('#DIV/0!');
      return n.reduce((s, v) => s + v, 0) / n.length;
    },
    MIN: (a) => {
      const n = nums(a);
      return n.reduce((best, value) => Math.min(best, value), n.length ? Infinity : 0);
    },
    MAX: (a) => {
      const n = nums(a);
      return n.reduce((best, value) => Math.max(best, value), n.length ? -Infinity : 0);
    },
    COUNT: (a) => flat(a).filter((v) => typeof v === 'number').length,
    COUNTA: (a) => flat(a).filter((v) => v !== null && v !== '').length,
    ROUND: (a) => round(num(a[0]), a.length > 1 ? num(a[1]) : 0),
    INT: (a) => Math.floor(num(a[0])),
    ABS: (a) => Math.abs(num(a[0])),
    SQRT: (a) => {
      const x = num(a[0]);
      if (x < 0) throw new FError('#NUM!');
      return Math.sqrt(x);
    },
    POWER: (a) => Math.pow(num(a[0]), num(a[1])),
    MOD: (a) => {
      const d = num(a[1]);
      if (d === 0) throw new FError('#DIV/0!');
      const x = num(a[0]);
      return x - d * Math.floor(x / d);
    },
    PI: () => Math.PI,
    AND: (a) => flat(a).filter((v) => v !== null).every(truthy),
    OR: (a) => flat(a).filter((v) => v !== null).some(truthy),
    NOT: (a) => !truthy(a[0]),
    CONCAT: (a) => flat(a).map(text).join(''),
    LEN: (a) => text(a[0]).length,
    UPPER: (a) => text(a[0]).toUpperCase(),
    LOWER: (a) => text(a[0]).toLowerCase(),
    TRIM: (a) => text(a[0]).trim().replace(/\s+/g, ' '),
    TODAY: () => new Date().toLocaleDateString('pt-PT')
  };

  const MIN_ARGS = { SUMIF: 2, COUNTIF: 2, VLOOKUP: 3, ROUND: 1, INT: 1, ABS: 1, SQRT: 1, POWER: 2, MOD: 2, NOT: 1, LEN: 1, UPPER: 1, LOWER: 1, TRIM: 1 };

  function evaluate(n, ctx) {
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'ref':
        return ctx.get(n.c, n.r);
      case 'range': {
        const out = [];
        const r0 = Math.min(n.a.r, n.b.r);
        const r1 = Math.max(n.a.r, n.b.r);
        const c0 = Math.min(n.a.c, n.b.c);
        const c1 = Math.max(n.a.c, n.b.c);
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(ctx.get(c, r));
        out.cols = c1 - c0 + 1;
        return out;
      }
      case 'neg':
        return -num(evaluate(n.a, ctx));
      case 'pct':
        return num(evaluate(n.a, ctx)) / 100;
      case 'bin': {
        const a = evaluate(n.a, ctx);
        const b = evaluate(n.b, ctx);
        switch (n.op) {
          case '+':
            return num(a) + num(b);
          case '-':
            return num(a) - num(b);
          case '*':
            return num(a) * num(b);
          case '/': {
            const d = num(b);
            if (d === 0) throw new FError('#DIV/0!');
            return num(a) / d;
          }
          case '^':
            return Math.pow(num(a), num(b));
          case '&':
            return text(a) + text(b);
          case '=':
            return compare(a, b) === 0;
          case '<>':
            return compare(a, b) !== 0;
          case '<':
            return compare(a, b) < 0;
          case '>':
            return compare(a, b) > 0;
          case '<=':
            return compare(a, b) <= 0;
          default:
            return compare(a, b) >= 0;
        }
      }
      case 'call': {
        // SE e SE.ERRO só avaliam o ramo necessário.
        if (n.name === 'IF') {
          if (n.args.length < 2) throw new FError('#ERRO!');
          const branch = truthy(evaluate(n.args[0], ctx)) ? n.args[1] : n.args[2];
          return branch ? evaluate(branch, ctx) : false;
        }
        if (n.name === 'IFERROR') {
          if (n.args.length < 2) throw new FError('#ERRO!');
          try {
            return evaluate(n.args[0], ctx);
          } catch (e) {
            if (e instanceof FError) return evaluate(n.args[1], ctx);
            throw e;
          }
        }
        const fn = Object.prototype.hasOwnProperty.call(FUNCS, n.name) ? FUNCS[n.name] : null;
        if (!fn) throw new FError('#NOME?');
        if (n.args.length < (MIN_ARGS[n.name] || 0)) throw new FError('#ERRO!');
        return fn(n.args.map((a) => evaluate(a, ctx)));
      }
      default:
        throw new FError('#ERRO!');
    }
  }

  // As fórmulas são reanalisadas a cada recálculo; guardar a árvore de cada texto evita repetir esse trabalho.
  const parsed = new Map();
  function parseCached(src) {
    let ast = parsed.get(src);
    if (ast === undefined) {
      if (parsed.size > 20000) parsed.clear();
      try {
        ast = parse(src);
      } catch (e) {
        ast = e; // os erros de sintaxe também ficam guardados
      }
      parsed.set(src, ast);
    }
    if (ast instanceof FError) throw ast;
    if (ast instanceof Error) throw new FError('#ERRO!');
    return ast;
  }

  // Calcula o valor de todas as células. Devolve um Map endereço -> valor
  // (número, texto, booleano ou FError).
  function compute(cells, rows = 100, cols = 26) {
    const cache = new Map();
    const visiting = new Set();

    function valueAt(a) {
      if (cache.has(a)) return cache.get(a);
      const cell = cells[a];
      if (!cell || cell.v == null || cell.v === '') return null;
      const raw = String(cell.v);
      let val;
      if (raw[0] === '=' && raw.length > 1) {
        if (visiting.has(a)) return new FError('#CICLO!');
        visiting.add(a);
        try {
          val = scalar(evaluate(parseCached(raw.slice(1)), ctx));
          if (val === null) val = 0;
          if (typeof val === 'number' && !Number.isFinite(val)) val = new FError('#NUM!');
        } catch (e) {
          val = e instanceof FError ? e : new FError('#ERRO!');
        }
        visiting.delete(a);
      } else {
        val = parseLiteral(raw);
      }
      cache.set(a, val);
      return val;
    }

    const ctx = {
      get(c, r) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) throw new FError('#REF!');
        const v = valueAt(addr(r, c));
        if (v instanceof FError) throw v;
        return v;
      }
    };

    const out = new Map();
    for (const a of Object.keys(cells)) out.set(a, valueAt(a));
    return out;
  }

  // Criar um formatador é caro; reutiliza-se o mesmo para todas as células.
  const GENERAL = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 10, useGrouping: false });

  function format(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof FError) return v.code;
    if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO';
    if (typeof v === 'number') return GENERAL.format(v);
    return String(v);
  }

  // Desloca as referências relativas de uma fórmula (usado ao colar). Respeita $ e texto entre aspas.
  function shiftFormula(raw, dr, dc, rows = 100, cols = 26) {
    if (raw[0] !== '=') return raw;
    const REF = /(?<![A-Za-zÀ-ÿ0-9_.$])(\$?)([A-Za-z]{1,2})(\$?)(\d+)(?![A-Za-zÀ-ÿ0-9_.(])/g;
    return raw
      .split(/("(?:[^"]|"")*")/)
      .map((part, i) => {
        if (i % 2) return part;
        return part.replace(REF, (_m, absC, col, absR, row) => {
          const c = colIndex(col) + (absC ? 0 : dc);
          const r = Number(row) - 1 + (absR ? 0 : dr);
          if (c < 0 || r < 0 || c >= cols || r >= rows) return '#REF!';
          return absC + colName(c) + absR + (r + 1);
        });
      })
      .join('');
  }

  // Converte uma fórmula para a forma que o Excel guarda nos ficheiros: nomes em inglês e
  // argumentos separados por vírgulas. Devolve o texto sem o "=" inicial.
  function toExcel(raw) {
    return raw
      .slice(1)
      .split(/("(?:[^"]|"")*")/)
      .map((part, i) => {
        if (i % 2) return part;
        return part
          .replace(/[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_.]*(?=\s*\()/g, (name) => {
            const upper = name.toUpperCase();
            return Object.prototype.hasOwnProperty.call(ALIASES, upper) ? ALIASES[upper] : upper;
          })
          .replace(/;/g, ',')
          .replace(/(?<![A-Za-zÀ-ÿ0-9_.])VERDADEIRO(?![A-Za-zÀ-ÿ0-9_.(])/gi, 'TRUE')
          .replace(/(?<![A-Za-zÀ-ÿ0-9_.])FALSO(?![A-Za-zÀ-ÿ0-9_.(])/gi, 'FALSE');
      })
      .join('');
  }

  const api = { FError, colName, colIndex, parseAddr, addr, parseNumber, compute, format, shiftFormula, toExcel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.MO = root.MO || {}).Formula = api;
})(typeof window !== 'undefined' ? window : globalThis);
