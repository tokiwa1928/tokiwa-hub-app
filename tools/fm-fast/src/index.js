// 速い中継（Cloudflare Workers）── FAST-5
//   Hub の受注入力（tools/fm-juchu-hub.html）から fm-bridge.js 経由で呼ばれる。
//   Apps Script の中継と同じ呼び方（POST JSON { action, idToken, ... }）・同じ返事（{ ok, user, data } / { ok:false, error }）。
//   受けるのは FileMaker を「読む」だけ: 画面_読み込み（軽く）・画面_recordIdで読む。それ以外は { ok:false, fallback:true } を返し、画面は Apps Script へ回す。

const mem = { idTok: null, idTokAt: 0, session: null, sessionAt: 0, fields: null, fieldsAt: 0, users: new Map() };

export default {
  async fetch(request, env, ctx) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    if (request.method === 'GET') return json({ ok: true, who: 'tokiwa-fm-fast', actions: ['画面_読み込み', '画面_recordIdで読む'], t: new Date().toISOString() });
    let req = {};
    try { req = JSON.parse(await request.text() || '{}'); } catch (e) { return json({ ok: false, error: '中身が JSON ではありません' }, 400); }
    const t0 = Date.now();
    try {
      const who = await authorize(req, env);
      const tAuth = Date.now() - t0;
      let data;
      if (req.action === '画面_読み込み') data = await 画面_読み込み(env, String(req['番号'] || ''), req['軽く'] === true || req['軽く'] === 'true');
      else if (req.action === '画面_recordIdで読む') data = await 画面_recordIdで読む(env, String(req.recordId || ''));
      else return json({ ok: false, fallback: true, error: 'この中継では受けない操作です: ' + req.action });
      if (data && data.fallback) return json({ ok: false, fallback: true, error: data.error || 'fallback' });
      data.計時 = Object.assign({}, data.計時 || {}, { 認証: tAuth, 中継合計: Date.now() - t0, 速い中継: true });
      return json({ ok: true, user: who.email, data });
    } catch (e) {
      const msg = String((e && e.message) || e);
      return json({ ok: false, error: msg, fallback: /^FB:/.test(msg) ? true : undefined });
    }
  }
};

// ------------------------------------------------------------ 誰が呼んだか（Apps Script の authorize_ と同じ判定）
async function authorize(req, env) {
  const domains = String(env.ALLOWED_DOMAIN || 'tokiwap-group.com,tokiwap.co.jp').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!req.idToken) throw new Error('サインインが必要です');
  const key = await sha256(String(req.idToken));
  const hit = mem.users.get(key);
  if (hit && hit.exp > Date.now()) return hit;
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(req.idToken));
  const info = await r.json().catch(() => ({}));
  if (!r.ok || info.error) throw new Error('サインインを確認できませんでした');
  const email = String(info.email || '').toLowerCase();
  if (info.email_verified !== true && info.email_verified !== 'true') throw new Error('メールアドレスが確認されていません');
  if (env.WEB_CLIENT_ID && String(info.aud || '') !== env.WEB_CLIENT_ID) throw new Error('この画面あてのサインインではありません');
  const at = email.lastIndexOf('@');
  if (at < 0 || domains.indexOf(email.slice(at + 1)) < 0) throw new Error('社内のアカウントでサインインしてください');
  const who = { email, exp: Math.min(Number(info.exp || 0) * 1000, Date.now() + 50 * 60 * 1000) };
  if (mem.users.size > 500) mem.users.clear();
  mem.users.set(key, who);
  return who;
}
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''); }

// ------------------------------------------------------------ FileMaker Data API（Apps Script の fmIdToken_ / fmSession_ / fmCall_ と同じ）
function base(env) { return 'https://' + env.FM_HOST + '/fmi/data/vLatest/databases/' + encodeURIComponent(env.FM_DB); }
async function fmIdToken(env) {
  if (mem.idTok && Date.now() - mem.idTokAt < 55 * 60 * 1000) return mem.idTok;
  if (!env.FM_REFRESH_TOKEN) throw new Error('FM_REFRESH_TOKEN が設定されていません（GitHub の secret）');
  const r = await fetch(env.COGNITO, { method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: env.CLIENT_ID, AuthParameters: { REFRESH_TOKEN: env.FM_REFRESH_TOKEN } }) });
  if (!r.ok) throw new Error('Claris のトークンを更新できません（更新トークンの入れ直しが要ります）: ' + (await r.text()).slice(0, 200));
  const j = await r.json(); mem.idTok = j.AuthenticationResult.IdToken; mem.idTokAt = Date.now(); return mem.idTok;
}
async function fmSession(env) {
  if (mem.session && Date.now() - mem.sessionAt < 13 * 60 * 1000) return mem.session;
  const r = await fetch(base(env) + '/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'FMID ' + await fmIdToken(env) }, body: '{}' });
  const body = await r.json().catch(() => ({})); const msg = (body.messages || [{}])[0];
  if (msg.code !== '0') { if (msg.code === '212' || msg.code === '213') { mem.idTok = null; } throw new Error('FileMaker に接続できません (' + msg.code + ') ' + msg.message); }
  mem.session = body.response.token; mem.sessionAt = Date.now(); return mem.session;
}
async function fmCall(env, path, method, payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const opt = { method: method || 'GET', headers: { Authorization: 'Bearer ' + await fmSession(env) } };
    if (payload !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(payload); }
    const r = await fetch(base(env) + path, opt); const body = await r.json().catch(() => ({})); const msg = (body.messages || [{}])[0];
    if (msg.code === '952' && attempt === 0) { mem.session = null; continue; }
    return { code: msg.code, message: msg.message, response: body.response || {} };
  }
}
async function find(env, layout, query, limit) {
  const r = await fmCall(env, '/layouts/' + encodeURIComponent(layout) + '/_find', 'POST', { query, limit: String(limit || 20), offset: '1' });
  if (r.code === '401') return { total: 0, records: [] };
  if (r.code !== '0') throw new Error('検索に失敗 (' + r.code + ') ' + r.message);
  return { total: (r.response.dataInfo || {}).foundCount || 0, records: (r.response.data || []).map(d => ({ recordId: d.recordId, modId: d.modId, fields: d.fieldData })) };
}
async function fieldInfo(env, layout) {
  if (mem.fields && Date.now() - mem.fieldsAt < 30 * 60 * 1000) return mem.fields;
  const r = await fmCall(env, '/layouts/' + encodeURIComponent(layout));
  if (r.code !== '0') throw new Error('項目一覧を取れません (' + r.code + ') ' + r.message);
  const writable = [], readonly = [];
  (r.response.fieldMetaData || []).forEach(f => { if (f.result === 'container') return; (f.type === 'calculation' || f.type === 'summary' ? readonly : writable).push(f.name); });
  mem.fields = { layout, writable, readonly }; mem.fieldsAt = Date.now(); return mem.fields;
}

// ------------------------------------------------------------ 画面
const Hub番号か = no => /^P\d{3,}-(YM|M)\d{2,}$/i.test(String(no || '').trim());
const HubP番号か = id => /^P\d{3,}$/i.test(String(id || '').trim());

async function 画面_読み込み(env, 番号, 軽く) {
  番号 = String(番号 || '').trim();
  if (!番号) throw new Error('番号を入れてください');
  if (Hub番号か(番号) || HubP番号か(番号)) return { fallback: true, error: 'Hub の見積は Apps Script で' };
  if (!軽く) return { fallback: true, error: '軽く=true 以外は Apps Script で' };
  const lay = env.LAYOUT, t = Date.now();
  let rows = await find(env, lay, [{ '伝票番号': '==' + 番号 }], 1);
  if (!rows.records.length) rows = await find(env, lay, [{ '見積番号': '==' + 番号 }], 1);
  const t伝票 = Date.now() - t; const rec = rows.records[0] || null;
  const tf = Date.now(); const wr = (await fieldInfo(env, lay)).writable; const t項目 = Date.now() - tf;
  return { ok: true, writable: wr, record: rec, 付属で: true, 参考: null, 差分: [], 前段階: null, 前段階差分: [], 前回原価: null, 履歴: [], 計時: { 伝票検索: t伝票, 項目一覧: t項目 } };
}
async function 画面_recordIdで読む(env, recordId) {
  if (/^hub:/i.test(recordId) || /^no:/.test(recordId) || !/^\d+$/.test(recordId)) return { fallback: true, error: 'Apps Script で' };
  const lay = env.LAYOUT, t = Date.now();
  const r = await fmCall(env, '/layouts/' + encodeURIComponent(lay) + '/records/' + recordId);
  if (r.code !== '0') throw new Error('読み込みに失敗 (' + r.code + ') ' + r.message);
  const d = (r.response.data || [])[0]; if (!d) throw new Error('レコードが見つかりません');
  const t伝票 = Date.now() - t;
  return { ok: true, writable: (await fieldInfo(env, lay)).writable, record: { recordId: d.recordId, modId: d.modId, fields: d.fieldData }, 付属で: true, 履歴: [], 計時: { 伝票検索: t伝票 } };
}
