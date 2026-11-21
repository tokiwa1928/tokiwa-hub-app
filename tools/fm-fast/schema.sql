-- HUBDB-1（2026-11-21 本多さん「Hub にデータがあるといい。もっと早く」）
--   FileMaker の受注（Hub受注 レイアウト・全項目）を Cloudflare D1 に持つ。読むのはここから、書くのは今までどおり FileMaker。
--   取り込み: GitHub Actions「Hub DB 同期」（tools/fm-fast/sync.mjs）。10 分おきに差分、毎晩に索引を作り直す。
CREATE TABLE IF NOT EXISTS juchu (
  recordId   INTEGER PRIMARY KEY,
  modId      INTEGER,
  denpyo     TEXT,     -- 伝票番号
  mitsumori  TEXT,     -- 見積番号
  kubun      TEXT,     -- 案件区分
  anken_id   TEXT,     -- 案件ID
  tokui      TEXT,     -- 得意先コード
  user_name  TEXT,     -- ユーザー名
  tanto      TEXT,     -- 担当者コード
  seihin     TEXT,     -- 製品名
  kihyo      TEXT,     -- 起票日（FileMaker のまま MM/DD/YYYY）
  kihyo_n    INTEGER,  -- 起票日 20261121
  shusei_n   INTEGER,  -- 修正日 20261121
  nen        INTEGER,  -- 年
  idx        TEXT,     -- 索引の 1 行（配る列の順の JSON 配列）
  ichiran    TEXT,     -- 一覧の 1 行（一覧の列の JSON オブジェクト）
  fields     TEXT,     -- 全項目（fieldData の JSON）
  synced_at  TEXT
);
CREATE INDEX IF NOT EXISTS juchu_denpyo ON juchu(denpyo);
CREATE INDEX IF NOT EXISTS juchu_mitsumori ON juchu(mitsumori);
CREATE INDEX IF NOT EXISTS juchu_anken ON juchu(anken_id);
CREATE INDEX IF NOT EXISTS juchu_kihyo ON juchu(kihyo_n);
CREATE INDEX IF NOT EXISTS juchu_shusei ON juchu(shusei_n);
CREATE INDEX IF NOT EXISTS juchu_tokui ON juchu(tokui);

-- 大きなまとまり（索引の JSON など）を 1MB ごとに分けて置く
CREATE TABLE IF NOT EXISTS blob (name TEXT, part INTEGER, data TEXT, made TEXT, PRIMARY KEY (name, part));

-- 同期の記録
CREATE TABLE IF NOT EXISTS sync_log (at TEXT, mode TEXT, seen INTEGER, written INTEGER, note TEXT);
