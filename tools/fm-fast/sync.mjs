// HUBDB-1: FileMaker → Cloudflare D1 の同期（GitHub Actions「Hub DB 同期」から動かす）
//   node sync.mjs diff    修正日が昨日以降の伝票を FileMaker から取り、modId が変わったものだけ D1 に書く（10 分おき）
//   node sync.mjs full    全件を FileMaker から取り、変わったものだけ書く（最初の 1 回・追いつき用）
//   node sync.mjs index   D1 から索引（配る列）を作り直して blob に置く（毎晩・full のあと）
//   要る環境変数: FM_REFRESH_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID（wrangler が読む）
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 行にする, 列名, 配る列 } from './src/rows.js';

const toml = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const v = k => (new RegExp('^' + k + '\\s*=\\s*"([^"]*)"', 'm').exec(toml) || [])[1];
const FM_HOST = v('FM_HOST'), FM_DB = v('FM_DB'), LAYOUT = v('LAYOUT'), COGNITO = v('COGNITO'), CLIENT_ID = v('CLIENT_ID');
const DB = 'tokiwa-hub';
const mode = process.argv[2] || 'diff';
const dir = mkdtempSync(join(tmpdir(), 'hubdb-'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------- FileMaker
const base = 'https://' + FM_HOST + '/fmi/data/vLatest/databases/' + encodeURIComponent(FM_DB);
let session = null;
async function fmSession() {
  if (session) return session;
  const r = await fetch(COGNITO, { method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: CLIENT_ID, AuthParameters: { REFRESH_TOKEN: process.env.FM_REFRESH_TOKEN } }) });
  if (!r.ok) throw new Error('Claris のトークンを更新できません: ' + (await r.text()).slice(0, 200));
  const idTok = (await r.json()).AuthenticationResult.IdToken;
  const s = await fetch(base + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'FMID ' + idTok }, body: '{}' });
  const b = await s.json(); const m = (b.messages || [{}])[0];
  if (m.code !== '0') throw new Error('FileMaker に接続できません (' + m.code + ') ' + m.message);
  return (session = b.response.token);
}
async function fm(path, method, payload) {
  for (let i = 0; i < 3; i++) {
    const opt = { method: method || 'GET', headers: { Authorization: 'Bearer ' + await fmSession() } };
    if (payload !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(payload); }
    const r = await fetch(base + path, opt); const b = await r.json().catch(() => ({})); const m = (b.messages || [{}])[0];
    if (m.code === '952') { session = null; continue; }
    if (m.code === '401') return { data: [], dataInfo: { foundCount: 0 } };
    if (m.code !== '0') { if (i < 2) { await new Promise(r => setTimeout(r, 3000)); continue; } throw new Error('FileMaker (' + m.code + ') ' + m.message); }
    return b.response;
  }
}
const recs = resp => (resp.data || []).map(d => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData }));
function 日付_(d) { return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear(); }

// ---------------------------------------------------------------- D1（wrangler）
function d1(args) {
  return execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', DB, '--remote', '--yes', ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'] });
}
function d1json(sql) { const out = d1(['--json', '--command', sql]); const j = JSON.parse(out.slice(out.indexOf('['))); return (j[0] && j[0].results) || []; }
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const lit = (c, x) => (['recordId', 'modId', 'kihyo_n', 'shusei_n', 'nen'].includes(c)) ? String(Number(x) || 0) : q(x);
let fileNo = 0;
function d1file(statements) {
  if (!statements.length) return;
  const p = join(dir, 'b' + (fileNo++) + '.sql'); writeFileSync(p, statements.join('\n'));
  d1(['--file', p]);
}
function upsertSql(rec) {
  const row = 行にする(rec);
  let sql = 'INSERT OR REPLACE INTO juchu (' + 列名.join(',') + ') VALUES (' + 列名.map(c => lit(c, row[c])).join(',') + ');';
  if (sql.length > 95000) { row.fields = '{"_大きすぎ":true}'; sql = 'INSERT OR REPLACE INTO juchu (' + 列名.join(',') + ') VALUES (' + 列名.map(c => lit(c, row[c])).join(',') + ');'; }
  return sql;
}

/** FileMaker の行のうち、D1 と modId が違うものだけ書く */
async function 書く(list, 確かめない) {
  let written = 0;
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    const have = 確かめない ? new Map() : new Map(d1json('SELECT recordId, modId FROM juchu WHERE recordId IN (' + part.map(r => Number(r.recordId)).join(',') + ')').map(r => [String(r.recordId), String(r.modId)]));
    const todo = part.filter(r => have.get(String(r.recordId)) !== String(r.modId));
    const stmts = todo.map(upsertSql);
    for (let k = 0; k < stmts.length; k += 250) d1file(stmts.slice(k, k + 250));
    written += todo.length;
  }
  return written;
}

async function diff() {
  const d = 日付_(new Date(Date.now() - 24 * 3600 * 1000 + 9 * 3600 * 1000));   // 日本時間の昨日
  const all = []; let off = 1;
  for (;;) {
    const r = await fm('/layouts/' + encodeURIComponent(LAYOUT) + '/_find', 'POST', { query: [{ '修正日': '>=' + d }], limit: '500', offset: String(off) });
    const got = recs(r); all.push(...got); if (got.length < 500) break; off += 500;
  }
  const w = await 書く(all);
  log('差分: 修正日 >=', d, '見た', all.length, '書いた', w);
  d1(['--command', 'INSERT INTO sync_log VALUES (' + q(new Date().toISOString()) + ",'diff'," + all.length + ',' + w + ',' + q('修正日>=' + d) + ')']);
}

async function full() {
  const first = await fm('/layouts/' + encodeURIComponent(LAYOUT) + '/records?_limit=1&_offset=1');
  const total = (first.dataInfo || {}).totalRecordCount || 0;
  log('全件:', total);
  let off = Number(process.env.FULL_FROM || 1), seen = 0, w = 0;
  const 空 = Number((d1json('SELECT COUNT(*) AS n FROM juchu')[0] || {}).n || 0) === 0;   // 空なら modId を比べずに全部書く（速い）
  while (off <= total) {
    const r = await fm('/layouts/' + encodeURIComponent(LAYOUT) + '/records?_limit=500&_offset=' + off);
    const got = recs(r); if (!got.length) break;
    w += await 書く(got, 空); seen += got.length; off += got.length;
    if (seen % 5000 < 500) log('  ', off - 1, '/', total, '書いた', w);
  }
  log('全件: 見た', seen, '書いた', w);
  d1(['--command', 'INSERT INTO sync_log VALUES (' + q(new Date().toISOString()) + ",'full'," + seen + ',' + w + ",'')"]);
}

/** 索引の JSON を blob に置く（Apps Script の 写し_索引を配る と同じ形: { 列, 行, 作った }） */
function index() {
  const rows = [];
  for (let last = 0; ;) {
    const part = d1json('SELECT recordId, idx FROM juchu WHERE recordId > ' + last + ' ORDER BY recordId LIMIT 20000');
    if (!part.length) break;
    part.forEach(r => rows.push(JSON.parse(r.idx))); last = part[part.length - 1].recordId;
  }
  const made = new Date().toISOString();
  const text = JSON.stringify({ ok: true, 列: 配る列, 行: rows, 作った: made, 件数: rows.length, 源: 'D1' });
  const parts = []; for (let i = 0; i < text.length; i += 80000) parts.push(text.slice(i, i + 80000));
  const stmts = ["DELETE FROM blob WHERE name='index_new';"].concat(parts.map((p, i) => 'INSERT INTO blob VALUES (' + q('index_new') + ',' + i + ',' + q(p) + ',' + q(made) + ');'));
  for (let k = 0; k < stmts.length; k += 40) d1file(stmts.slice(k, k + 40));
  d1(['--command', "DELETE FROM blob WHERE name='index'; UPDATE blob SET name='index' WHERE name='index_new';"]);
  log('索引:', rows.length, '行', (text.length / 1e6).toFixed(1), 'MB', parts.length, '分割');
}

(async () => {
  d1(['--file', new URL('./schema.sql', import.meta.url).pathname]);
  if (mode === 'diff') await diff();
  else if (mode === 'full') { await full(); index(); }
  else if (mode === 'index') index();
  else throw new Error('知らないモード: ' + mode);
})().catch(e => { console.error('::error::' + (e && e.message || e)); process.exit(1); });
