'use strict';

// Ligações a servidores de bases de dados (MySQL/MariaDB, PostgreSQL, SQL Server) para o programa
// Bases de dados. Corre só no processo principal: a página nunca abre ligações de rede.
// Só liga ao servidor que o utilizador indica, as palavras-passe guardadas são encriptadas pelo
// sistema operativo (safeStorage) e cada pedido tem limite de tempo e de linhas.
const path = require('path');
const fs = require('fs/promises');

const KINDS = { mysql: 'MySQL / MariaDB', postgres: 'PostgreSQL', mssql: 'SQL Server' };
const DEFAULT_PORT = { mysql: 3306, postgres: 5432, mssql: 1433 };
const MAX_ROWS = 5000;
const TIMEOUT = 30000;

function createManager(app, safeStorage) {
  const live = new Map(); // id -> { kind, client, label }
  let seq = 1;
  const savedFile = () => path.join(app.getPath('userData'), 'connections.json');

  // ---------- Validação ----------

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  function cleanConfig(c) {
    if (!c || typeof c !== 'object' || !Object.hasOwn(KINDS, c.kind)) throw new Error('Tipo de servidor desconhecido.');
    const host = str(c.host, 253).trim();
    if (!/^[A-Za-z0-9._\-:[\]]+(\\[A-Za-z0-9_$]+)?$/.test(host)) throw new Error('Endereço do servidor inválido.');
    const port = Number(c.port) || DEFAULT_PORT[c.kind];
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida.');
    return {
      kind: c.kind,
      host,
      port,
      user: str(c.user, 128),
      password: str(c.password, 512),
      database: str(c.database, 128),
      ssl: Boolean(c.ssl),
      trustCert: Boolean(c.trustCert),
      name: str(c.name, 80) || `${str(c.database, 128) || host}`
    };
  }

  // ---------- Dialetos ----------

  const quoteId = (kind, name) => (kind === 'mysql' ? '`' + String(name).replace(/`/g, '``') + '`' : kind === 'mssql' ? '[' + String(name).replace(/]/g, ']]') + ']' : '"' + String(name).replace(/"/g, '""') + '"');
  const tableRef = (kind, t) => (t.schema ? quoteId(kind, t.schema) + '.' : '') + quoteId(kind, t.name);
  const param = (kind, i) => (kind === 'postgres' ? '$' + i : kind === 'mssql' ? '@p' + i : '?');
  function cleanTable(t) {
    if (!t || typeof t.name !== 'string' || !t.name || t.name.length > 128) throw new Error('Tabela inválida.');
    return { schema: typeof t.schema === 'string' && t.schema.length <= 128 ? t.schema : '', name: t.name };
  }

  // Converte valores do servidor em JSON simples.
  function plain(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString().replace('T00:00:00.000Z', '').replace(/\.000Z$/, 'Z');
    if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
    if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `(binário, ${v.length} bytes)`;
    if (typeof v === 'object') { try { return JSON.stringify(v).slice(0, 2000); } catch { return String(v); } }
    if (typeof v === 'string') return v.length > 20000 ? v.slice(0, 20000) + '…' : v;
    return v;
  }

  // ---------- Ligação e execução ----------

  async function open(cfg) {
    if (cfg.kind === 'mysql') {
      const mysql = require('mysql2/promise');
      const client = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database || undefined, ssl: cfg.ssl ? { rejectUnauthorized: !cfg.trustCert } : undefined, connectTimeout: 15000, multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false });
      return { client, close: () => client.end() };
    }
    if (cfg.kind === 'postgres') {
      const { Client, types } = require('pg');
      // Datas e horas como texto, tal como estão no servidor (sem conversões de fuso horário).
      for (const oid of [1082, 1114, 1184, 1083, 1266]) types.setTypeParser(oid, (v) => v);
      const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database || undefined, ssl: cfg.ssl ? { rejectUnauthorized: !cfg.trustCert } : false, connectionTimeoutMillis: 15000, statement_timeout: TIMEOUT, query_timeout: TIMEOUT + 2000, application_name: 'MyOffice' });
      await client.connect();
      client.on('error', () => {});
      return { client, close: () => client.end() };
    }
    const { Connection } = require('tedious');
    const [server, instance] = cfg.host.split('\\');
    const client = new Connection({
      server,
      authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
      options: { port: instance ? undefined : cfg.port, instanceName: instance || undefined, database: cfg.database || undefined, encrypt: cfg.ssl, trustServerCertificate: cfg.trustCert, connectTimeout: 15000, requestTimeout: TIMEOUT, rowCollectionOnRequestCompletion: false, useColumnNames: false, appName: 'MyOffice' }
    });
    await new Promise((resolve, reject) => {
      client.on('connect', (err) => (err ? reject(err) : resolve()));
      client.on('error', () => {});
      client.connect();
    });
    return { client, close: () => client.close() };
  }

  // Executa uma instrução e devolve { columns, rows, affected, truncated }.
  async function exec(conn, sql, params = []) {
    if (conn.kind === 'mysql') {
      const [result, fields] = await conn.client.query({ sql, values: params, rowsAsArray: true, timeout: TIMEOUT });
      if (Array.isArray(result)) return { columns: (fields || []).map((f) => f.name), rows: result.slice(0, MAX_ROWS).map((r) => r.map(plain)), affected: 0, truncated: result.length > MAX_ROWS };
      return { columns: [], rows: [], affected: result.affectedRows || 0 };
    }
    if (conn.kind === 'postgres') {
      let res = await conn.client.query({ text: sql, values: params, rowMode: 'array' });
      if (Array.isArray(res)) res = res[res.length - 1];
      const hasRows = Array.isArray(res.fields) && res.fields.length > 0;
      return { columns: hasRows ? res.fields.map((f) => f.name) : [], rows: hasRows ? res.rows.slice(0, MAX_ROWS).map((r) => r.map(plain)) : [], affected: hasRows ? 0 : res.rowCount || 0, truncated: hasRows && res.rows.length > MAX_ROWS };
    }
    const { Request, TYPES } = require('tedious');
    return new Promise((resolve, reject) => {
      let columns = [];
      const rows = [];
      let truncated = false;
      const req = new Request(sql, (err, rowCount) => (err ? reject(err) : resolve({ columns, rows, affected: columns.length ? 0 : rowCount || 0, truncated })));
      params.forEach((v, i) => req.addParameter('p' + (i + 1), v == null ? TYPES.NVarChar : typeof v === 'number' ? (Number.isInteger(v) ? TYPES.BigInt : TYPES.Float) : TYPES.NVarChar, v == null ? null : typeof v === 'number' ? v : String(v)));
      req.on('columnMetadata', (cols) => { columns = cols.map((c) => c.colName); rows.length = 0; });
      req.on('row', (cols) => { if (rows.length < MAX_ROWS) rows.push(cols.map((c) => plain(c.value))); else truncated = true; });
      conn.client.execSql(req);
    });
  }

  function get(id) {
    const conn = live.get(id);
    if (!conn) throw new Error('A ligação foi fechada. Volte a ligar ao servidor.');
    return conn;
  }

  function friendly(e) {
    const msg = String((e && e.message) || e || 'Erro desconhecido');
    if (/ECONNREFUSED/i.test(msg)) return 'O servidor recusou a ligação. Confirme o endereço, a porta e se o servidor está a correr.';
    if (/ENOTFOUND|getaddrinfo/i.test(msg)) return 'Não foi possível encontrar o servidor. Confirme o endereço.';
    if (/ETIMEDOUT|timeout/i.test(msg)) return 'O servidor não respondeu a tempo.';
    if (/Access denied|password authentication failed|Login failed/i.test(msg)) return 'Utilizador ou palavra-passe incorretos.';
    if (/self.signed|certificate/i.test(msg)) return 'O certificado do servidor não é de confiança. Se for um servidor interno, ative "Confiar no certificado do servidor".';
    return msg.slice(0, 400);
  }

  // ---------- Operações ----------

  async function connect(raw) {
    const cfg = cleanConfig(raw);
    if (!cfg.password && raw && typeof raw.savedId === 'string') cfg.password = await savedPassword(raw.savedId);
    const opened = await open(cfg);
    const id = 'c' + seq++;
    const conn = { kind: cfg.kind, client: opened.client, close: opened.close, label: `${cfg.name} (${KINDS[cfg.kind]})` };
    live.set(id, conn);
    let version = '';
    try {
      const v = await exec(conn, cfg.kind === 'mssql' ? 'SELECT @@VERSION' : cfg.kind === 'postgres' ? 'SHOW server_version' : 'SELECT VERSION()');
      version = String(v.rows[0] && v.rows[0][0] || '').split('\n')[0].slice(0, 120);
    } catch { /* a versão é só informativa */ }
    return { id, kind: cfg.kind, label: conn.label, database: cfg.database, version };
  }

  async function tables(id) {
    const conn = get(id);
    const sql = conn.kind === 'mysql'
      ? "SELECT '' AS s, table_name AS n, table_type AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY 2"
      : conn.kind === 'postgres'
        ? "SELECT table_schema AS s, table_name AS n, table_type AS t FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2"
        : 'SELECT TABLE_SCHEMA AS s, TABLE_NAME AS n, TABLE_TYPE AS t FROM INFORMATION_SCHEMA.TABLES ORDER BY 1, 2';
    const res = await exec(conn, sql);
    const dflt = conn.kind === 'postgres' ? 'public' : conn.kind === 'mssql' ? 'dbo' : '';
    return res.rows.slice(0, 2000).map(([s, n, t]) => ({ schema: s && s !== dflt ? s : '', name: n, view: /VIEW/i.test(t || '') }));
  }

  async function columns(id, rawTable) {
    const conn = get(id);
    const t = cleanTable(rawTable);
    const schema = t.schema || (conn.kind === 'postgres' ? 'public' : conn.kind === 'mssql' ? 'dbo' : null);
    let cols, pk;
    if (conn.kind === 'mysql') {
      cols = (await exec(conn, 'SELECT column_name, data_type, column_key, extra FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position', [t.name])).rows;
      return cols.map(([n, type, key, extra]) => ({ name: n, type, pk: key === 'PRI', auto: /auto_increment/i.test(extra || '') }));
    }
    const p1 = param(conn.kind, 1), p2 = param(conn.kind, 2);
    cols = (await exec(conn, `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = ${p1} AND table_name = ${p2} ORDER BY ordinal_position`, [schema, t.name])).rows;
    pk = new Set((await exec(conn, `SELECT k.column_name FROM information_schema.table_constraints c JOIN information_schema.key_column_usage k ON k.constraint_name = c.constraint_name AND k.table_schema = c.table_schema AND k.table_name = c.table_name WHERE c.constraint_type = 'PRIMARY KEY' AND c.table_schema = ${p1} AND c.table_name = ${p2}`, [schema, t.name])).rows.map((r) => r[0]));
    return cols.map(([n, type, def]) => ({ name: n, type, pk: pk.has(n), auto: /nextval|identity/i.test(String(def || '')) }));
  }

  async function rows(id, rawTable, opts = {}) {
    const conn = get(id);
    const t = cleanTable(rawTable);
    const limit = Math.max(1, Math.min(MAX_ROWS, Number(opts.limit) || 200));
    const offset = Math.max(0, Math.min(1e9, Number(opts.offset) || 0));
    const order = typeof opts.orderBy === 'string' && opts.orderBy ? `${quoteId(conn.kind, opts.orderBy)} ${opts.dir === 'desc' ? 'DESC' : 'ASC'}` : null;
    const ref = tableRef(conn.kind, t);
    const sql = conn.kind === 'mssql'
      ? `SELECT * FROM ${ref} ORDER BY ${order || '(SELECT NULL)'} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
      : `SELECT * FROM ${ref}${order ? ' ORDER BY ' + order : ''} LIMIT ${limit} OFFSET ${offset}`;
    const data = await exec(conn, sql);
    const count = await exec(conn, `SELECT COUNT(*) FROM ${ref}`);
    return { ...data, total: Number(count.rows[0][0]) || 0 };
  }

  // Altera uma célula, identificada pela chave primária.
  async function update(id, rawTable, key, column, value) {
    const conn = get(id);
    const t = cleanTable(rawTable);
    const keys = Object.entries(key && typeof key === 'object' ? key : {});
    if (!keys.length || typeof column !== 'string') throw new Error('Esta tabela não tem chave primária: não é possível editar.');
    let i = 1;
    const sql = `UPDATE ${tableRef(conn.kind, t)} SET ${quoteId(conn.kind, column)} = ${param(conn.kind, i++)} WHERE ${keys.map(([k]) => `${quoteId(conn.kind, k)} = ${param(conn.kind, i++)}`).join(' AND ')}`;
    const res = await exec(conn, sql, [value === '' ? null : value, ...keys.map(([, v]) => v)]);
    if (res.affected !== 1) throw new Error(res.affected ? 'Mais de um registo foi alterado.' : 'O registo já não existe.');
    return res;
  }

  async function insert(id, rawTable) {
    const conn = get(id);
    const t = cleanTable(rawTable);
    const sql = conn.kind === 'mysql' ? `INSERT INTO ${tableRef(conn.kind, t)} () VALUES ()` : `INSERT INTO ${tableRef(conn.kind, t)} DEFAULT VALUES`;
    return exec(conn, sql);
  }

  async function remove(id, rawTable, key) {
    const conn = get(id);
    const t = cleanTable(rawTable);
    const keys = Object.entries(key && typeof key === 'object' ? key : {});
    if (!keys.length) throw new Error('Esta tabela não tem chave primária: não é possível eliminar registos daqui.');
    const sql = `DELETE FROM ${tableRef(conn.kind, t)} WHERE ${keys.map(([k], i) => `${quoteId(conn.kind, k)} = ${param(conn.kind, i + 1)}`).join(' AND ')}`;
    const res = await exec(conn, sql, keys.map(([, v]) => v));
    if (res.affected > 1) throw new Error('Mais de um registo seria eliminado.');
    return res;
  }

  async function query(id, sql) {
    const conn = get(id);
    if (typeof sql !== 'string' || !sql.trim() || sql.length > 200000) throw new Error('Consulta vazia ou demasiado longa.');
    return exec(conn, sql);
  }

  // Cria uma tabela no servidor e envia os registos (enviar uma tabela local para o servidor).
  async function push(id, name, cols, data) {
    const conn = get(id);
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_][\p{L}\p{N}_ \-]{0,59}$/u.test(name)) throw new Error('Nome de tabela inválido.');
    if (!Array.isArray(cols) || !cols.length || cols.length > 500 || !Array.isArray(data) || data.length > 200000) throw new Error('Dados inválidos.');
    const T = {
      mysql: { text: 'TEXT', number: 'DOUBLE', money: 'DECIMAL(15,2)', date: 'DATE', bool: 'BOOLEAN', choice: 'VARCHAR(255)', link: 'INT', key: 'INT AUTO_INCREMENT PRIMARY KEY' },
      postgres: { text: 'text', number: 'double precision', money: 'numeric(15,2)', date: 'date', bool: 'boolean', choice: 'varchar(255)', link: 'integer', key: 'serial PRIMARY KEY' },
      mssql: { text: 'NVARCHAR(MAX)', number: 'FLOAT', money: 'DECIMAL(15,2)', date: 'DATE', bool: 'BIT', choice: 'NVARCHAR(255)', link: 'INT', key: 'INT IDENTITY(1,1) PRIMARY KEY' }
    }[conn.kind];
    const names = cols.map((c) => String(c.name).slice(0, 60));
    const keyName = names.some((n) => n.toLowerCase() === 'id') ? '_id' : 'id';
    const ref = quoteId(conn.kind, name);
    await exec(conn, `CREATE TABLE ${ref} (${quoteId(conn.kind, keyName)} ${T.key}, ${cols.map((c, i) => `${quoteId(conn.kind, names[i])} ${T[c.type] || T.text}`).join(', ')})`);
    // Inserções em blocos, dentro de uma transação.
    const batch = Math.max(1, Math.floor(1000 / cols.length));
    await exec(conn, conn.kind === 'mssql' ? 'BEGIN TRANSACTION' : 'BEGIN');
    try {
      for (let start = 0; start < data.length; start += batch) {
        const chunk = data.slice(start, start + batch);
        let i = 1;
        const values = chunk.map(() => '(' + cols.map(() => param(conn.kind, i++)).join(', ') + ')').join(', ');
        const params = chunk.flatMap((r) => cols.map((c, k) => { const v = r[k]; return v == null || v === '' ? null : c.type === 'bool' ? (v ? (conn.kind === 'postgres' ? true : 1) : (conn.kind === 'postgres' ? false : 0)) : v; }));
        await exec(conn, `INSERT INTO ${ref} (${names.map((n) => quoteId(conn.kind, n)).join(', ')}) VALUES ${values}`, params);
      }
      await exec(conn, conn.kind === 'mssql' ? 'COMMIT TRANSACTION' : 'COMMIT');
    } catch (e) {
      await exec(conn, conn.kind === 'mssql' ? 'ROLLBACK TRANSACTION' : 'ROLLBACK').catch(() => {});
      await exec(conn, `DROP TABLE ${ref}`).catch(() => {});
      throw e;
    }
    return { rows: data.length };
  }

  async function disconnect(id) {
    const conn = live.get(id);
    live.delete(id);
    if (conn) await Promise.resolve(conn.close()).catch(() => {});
    return true;
  }

  // ---------- Ligações guardadas (sem a palavra-passe em claro) ----------

  async function readSaved() {
    try {
      const list = JSON.parse(await fs.readFile(savedFile(), 'utf8'));
      return Array.isArray(list) ? list.filter((c) => c && typeof c.id === 'string' && Object.hasOwn(KINDS, c.kind)).slice(0, 100) : [];
    } catch {
      return [];
    }
  }
  async function writeSaved(list) {
    const tmp = savedFile() + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(list), { mode: 0o600 });
    await fs.rename(tmp, savedFile());
  }
  async function savedPassword(savedId) {
    const item = (await readSaved()).find((c) => c.id === savedId);
    if (!item || !item.secret || !safeStorage.isEncryptionAvailable()) return '';
    try { return safeStorage.decryptString(Buffer.from(item.secret, 'base64')); } catch { return ''; }
  }

  async function saved() {
    return (await readSaved()).map(({ secret, ...c }) => ({ ...c, hasPassword: Boolean(secret) }));
  }

  async function save(raw, rememberPassword) {
    const cfg = cleanConfig(raw);
    const list = await readSaved();
    const id = typeof raw.savedId === 'string' && list.some((c) => c.id === raw.savedId) ? raw.savedId : 's' + Date.now().toString(36);
    const old = list.find((c) => c.id === id);
    let secret = old && old.secret;
    if (rememberPassword && cfg.password) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Este sistema não permite guardar palavras-passe de forma segura.');
      secret = safeStorage.encryptString(cfg.password).toString('base64');
    } else if (!rememberPassword) secret = undefined;
    const entry = { id, name: cfg.name, kind: cfg.kind, host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database, ssl: cfg.ssl, trustCert: cfg.trustCert, ...(secret ? { secret } : {}) };
    await writeSaved([...list.filter((c) => c.id !== id), entry]);
    return { id };
  }

  async function forget(savedId) {
    await writeSaved((await readSaved()).filter((c) => c.id !== savedId));
    return true;
  }

  const wrap = (fn) => async (...args) => {
    try {
      return { ok: true, result: await fn(...args) };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  };

  function register(ipcMain, isTrusted) {
    const ops = { connect, tables, columns, rows, update, insert, remove, query, push, disconnect, saved, save, forget };
    for (const [name, fn] of Object.entries(ops)) {
      const run = wrap(fn);
      ipcMain.handle('dbs:' + name, (event, ...args) => (isTrusted(event) ? run(...args) : { ok: false, error: 'Pedido não autorizado.' }));
    }
  }

  async function closeAll() {
    await Promise.all([...live.keys()].map(disconnect));
  }

  return { register, closeAll, KINDS };
}

module.exports = { createManager, KINDS, DEFAULT_PORT };
