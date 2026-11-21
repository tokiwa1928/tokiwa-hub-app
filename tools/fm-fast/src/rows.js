// HUBDB-1: FileMaker の 1 件 → D1 の 1 行。同期（sync.mjs）と速い中継（index.js）の両方が使う。
//   列の並びは Apps Script の中継（tools/fm-relay）の 配る列（索引）・一覧の列（画面_一覧）と同じにする。画面はどちらから来ても同じに扱える。

export const 配る列 = ['recordId', '年', '伝票番号', '見積番号', '案件区分', '案件ID', '起票日', '納品日', '得意先コード', 'ユーザー名', '製品名', '品種', '合計数1', '売価金額', '合計金額', '納期', '単位', '売価単価', '修正日', '担当者コード', '前回伝票番号', 'ロット契約単位'];
export const 一覧の列 = ['伝票番号', '見積番号', '案件区分', '案件ID', '起票日', '納品日', '納品書番号', '得意先コード', 'ユーザー名', '担当者コード', '製品名', '品種', '合計数1', '単位', '売価単価', '売価金額', '合計金額', '注残数', '注文書No', 'ロット契約単位', '納期'];

// MM/DD/YYYY → 20261121（比較用）
export function 日付数(v) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || '')); return m ? Number(m[3] + m[1].padStart(2, '0') + m[2].padStart(2, '0')) : 0; }
export function 年(v) { const m = /(\d{4})/.exec(String(v || '')); return m ? Number(m[1]) : 0; }
const 値 = v => (v === undefined || v === null) ? '' : v;

/** { recordId, modId, fields } → D1 の列 */
export function 行にする(rec) {
  const f = rec.fields || {};
  const id = Number(rec.recordId);
  const idx = 配る列.map(c => c === 'recordId' ? String(id) : c === '年' ? 年(f['起票日']) : 値(f[c]));
  const ichiran = { recordId: String(id) }; 一覧の列.forEach(c => { if (f[c] !== undefined) ichiran[c] = f[c]; });
  return {
    recordId: id, modId: Number(rec.modId || 0),
    denpyo: String(値(f['伝票番号'])), mitsumori: String(値(f['見積番号'])), kubun: String(値(f['案件区分'])), anken_id: String(値(f['案件ID'])),
    tokui: String(値(f['得意先コード'])), user_name: String(値(f['ユーザー名'])), tanto: String(値(f['担当者コード'])), seihin: String(値(f['製品名'])),
    kihyo: String(値(f['起票日'])), kihyo_n: 日付数(f['起票日']), shusei_n: 日付数(f['修正日']), nen: 年(f['起票日']),
    idx: JSON.stringify(idx), ichiran: JSON.stringify(ichiran), fields: JSON.stringify(f), synced_at: new Date().toISOString()
  };
}
export const 列名 = ['recordId', 'modId', 'denpyo', 'mitsumori', 'kubun', 'anken_id', 'tokui', 'user_name', 'tanto', 'seihin', 'kihyo', 'kihyo_n', 'shusei_n', 'nen', 'idx', 'ichiran', 'fields', 'synced_at'];
export const UPSERT = 'INSERT OR REPLACE INTO juchu (' + 列名.join(',') + ') VALUES (' + 列名.map(() => '?').join(',') + ')';
