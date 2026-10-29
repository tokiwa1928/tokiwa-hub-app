#!/usr/bin/env node
// AI-PROOF-2: 校正BOX の AI 作業窓口を各 PC の Claude から使うための道具（Node 18 以上・追加の部品なし）
// 環境変数: KOSEI_AI_KEY（AI 用キー）, KOSEI_WORKER（例: 旗艦PC/Ryo）
const GAS_URL = process.env.KOSEI_GAS_URL || 'https://script.google.com/a/macros/tokiwap-group.com/s/AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec';
const KEY = process.env.KOSEI_AI_KEY || '';
const WORKER = process.env.KOSEI_WORKER || '';

const USAGE = `使い方:
  node kosei.mjs queue [--open]                      AI トライアルのカード一覧（--open: 残りがあるものだけ）
  node kosei.mjs get <カードID|伝票番号>               依頼・経緯・修正リスト・行ごとの状態・作業ログ
  node kosei.mjs claim <ID> [--force] [メモ]           作業中の札を立てる（--force: 別の人から引き継ぐ）
  node kosei.mjs item <ID> <entryId> <No> <状態> [理由]  行の結果。状態: done / failed / confirm / todo
  node kosei.mjs log <ID> <内容> [--file <URL>]...     作業ログ（保存したファイルのリンクも）
  node kosei.mjs release <ID> <review|paused> [メモ]   札を外す。review=終わった（内校待ち）, paused=途中で止める`;

async function call(action, params) {
  if (!KEY) throw new Error('KOSEI_AI_KEY が設定されていません');
  const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify({ action, aiKey: KEY, ...params }), redirect: 'follow' });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error('GAS の返事が JSON ではありません: ' + text.slice(0, 200)); }
  return j;
}
function needWorker() { if (!WORKER) throw new Error('KOSEI_WORKER（例: 旗艦PC/Ryo）が設定されていません'); return WORKER; }

const [cmd, ...a] = process.argv.slice(2);
const flag = (n) => { const i = a.indexOf(n); if (i < 0) return false; a.splice(i, 1); return true; };
const multi = (n) => { const out = []; let i; while ((i = a.indexOf(n)) >= 0) { out.push(a[i + 1]); a.splice(i, 2); } return out; };

try {
  let r;
  switch (cmd) {
    case 'queue': r = await call('proofAiQueue', { open: flag('--open') ? '1' : '' }); break;
    case 'get': r = await call('proofAiGet', { id: a[0] }); break;
    case 'claim': { const force = flag('--force'); r = await call('proofAiClaim', { id: a[0], worker: needWorker(), force: force ? '1' : '', note: a.slice(1).join(' ') }); break; }
    case 'item': r = await call('proofAiItem', { id: a[0], worker: needWorker(), entryId: a[1], no: a[2], state: a[3], note: a.slice(4).join(' ') }); break;
    case 'log': { const files = multi('--file'); r = await call('proofAiLog', { id: a[0], worker: needWorker(), text: a.slice(1).join(' '), files }); break; }
    case 'release': r = await call('proofAiRelease', { id: a[0], worker: needWorker(), status: a[1], note: a.slice(2).join(' ') }); break;
    default: console.log(USAGE); process.exit(cmd ? 1 : 0);
  }
  console.log(JSON.stringify(r, null, 1));
  process.exit(r && r.success ? 0 : 2);
} catch (e) { console.error('エラー: ' + e.message); process.exit(1); }
