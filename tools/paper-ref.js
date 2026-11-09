/**
 * 用紙の ID ↔ 名前（PAPERID-1）
 *
 *   <script src="paper-ref.js"></script>          ← tools/ の中のページから
 *   <script src="tools/paper-ref.js"></script>    ← 本体（index.html）から
 *
 * 考え方（本多さん 11/8「ID で結び、名前は表示用」）
 *   ・Hub の用紙マスタ（DB.paperMaster、tools/paper-master.html）が正。1 紙に動かない ID（P0001…）を振る
 *   ・name   ＝ Hub で見せる表示名（直してよい）
 *   ・fmName ＝ 旧名（FileMaker の品名）。変えない。FileMaker に書くときはこちらに戻す
 *   ・mergedInto ＝ 統合先の ID（同じ紙の重複をまとめたとき）。正の紙は null
 *
 * 使い方
 *   PaperRef.表示名('P0012')              → 'コート 90k'（name。無ければ fmName）
 *   PaperRef.旧名('P0012')                → 'コート紙 90'（FileMaker の品名）
 *   PaperRef.idから('コート紙 90', 'A判', '90k') → 'P0012'（fmName・name・別名のどれかが一致。サイズ・厚さは任せてもよい）
 *   PaperRef.正の紙('P0013')              → 統合先を辿った先の行（mergedInto が無ければ自分）
 *   PaperRef.FileMakerの品名('コート 90k') → 'コート紙 90'（Hub の表示名・別名・ID のどれで来ても旧名に戻す）
 *   PaperRef.引く('P0012') / PaperRef.一覧()
 *
 * データは本体 DB（localStorage: murayama_v15 の paperMaster）を読むだけ。書くのは paper-master.html だけ。
 * 既存の画面はまだこれを使っていない（受注入力・見積ビルダーがあとで使う）。
 */
(function (global) {
  'use strict';
  var DBKEY = 'murayama_v15';
  var 控え = null, 控えた = 0;

  function 正規(s) { return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s#＃・\-_\/／()（）\r\n]/g, ''); }
  function サイズ正規(s) { return 正規(String(s == null ? '' : s).split(/\r|\n/)[0]); }

  function 一覧(強制) {
    if (!強制 && 控え && Date.now() - 控えた < 1500) return 控え;
    var rows = [];
    try { var db = JSON.parse(localStorage.getItem(DBKEY) || 'null'); if (db && Array.isArray(db.paperMaster)) rows = db.paperMaster; } catch (e) {}
    控え = rows; 控えた = Date.now(); return rows;
  }
  try { global.addEventListener('storage', function (e) { if (e && e.key === DBKEY) 控え = null; }); } catch (e) {}

  function 引く(id) { if (!id) return null; id = String(id).trim(); var a = 一覧(); for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i]; return null; }
  function 正の紙(id) { var r = 引く(id); var n = 0; while (r && r.mergedInto && n++ < 10) { var p = 引く(r.mergedInto); if (!p || p === r) break; r = p; } return r; }
  function 表示名(id) { var r = 引く(id); return r ? (r.name || r.fmName || '') : ''; }
  function 旧名(id) { var r = 引く(id); return r ? (r.fmName || '') : ''; }

  // 名前（旧名・表示名・別名のどれか）とサイズ・厚さから行を探す。サイズ・厚さが合う行を優先し、無ければ名前だけで
  //   1 紙 ＝ 品名＋サイズ＋厚さ なので、受注入力の 品名・サイズ・規格（厚さ）を渡すと 1 つに決まる
  function 探す(name, size, weight) {
    var k = 正規(name); if (!k) return null; var sz = サイズ正規(size), wt = 正規(weight); var a = 一覧(); var 名だけ = null, サイズまで = null;
    for (var i = 0; i < a.length; i++) { var r = a[i]; if (!r) continue;
      var 合う = 正規(r.fmName) === k || 正規(r.name) === k || (r.aliases || []).some(function (x) { return 正規(x) === k; });
      if (!合う) continue;
      var s合う = !sz || サイズ正規(r.size) === sz, w合う = !wt || 正規(r.weight) === wt;
      if (s合う && w合う) { if (!r.mergedInto) return r; if (!サイズまで) サイズまで = r; }
      else if (s合う && !サイズまで) サイズまで = r;
      else if (!名だけ) 名だけ = r;
    }
    return サイズまで || 名だけ;
  }
  function idから(fmName, size, weight) { var r = 探す(fmName, size, weight); return r ? r.id : ''; }
  // Hub の表示名・別名・ID のどれで来ても、FileMaker に書く品名（旧名）に戻す。見つからなければそのまま返す
  function FileMakerの品名(nameOrId, size, weight) { var r = 引く(nameOrId) || 探す(nameOrId, size, weight); return r ? (r.fmName || String(nameOrId)) : String(nameOrId == null ? '' : nameOrId); }
  // FileMaker の品名（旧名）→ Hub で見せる名前。見つからなければそのまま
  function Hubの表示名(fmName, size, weight) { var r = 探す(fmName, size, weight); return r ? (r.name || r.fmName) : String(fmName == null ? '' : fmName); }

  global.PaperRef = { 一覧: 一覧, 引く: 引く, 正の紙: 正の紙, 表示名: 表示名, 旧名: 旧名, idから: idから, 探す: 探す, FileMakerの品名: FileMakerの品名, Hubの表示名: Hubの表示名, 正規: 正規, サイズ正規: サイズ正規 };
})(window);
