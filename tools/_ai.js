// ════════════════════════════════════════════════════════════
//  Tokiwa Quote Tools — 共通AIヘルパー (GAS経由・全社共通キー)
//  各ツールは個人キーを持たず、ここから GAS の claudeVision を呼ぶ。
//  APIキーはGASのスクリプトプロパティに1個だけ設定 (各PCに配らない)。
// ════════════════════════════════════════════════════════════
var TQ_GAS_URL = 'https://script.google.com/a/macros/tokiwap-group.com/s/AKfycbw9-8Nnq3jV9lCDUEf7JOvQM_yAy1ZYnOIab-TYP3TZ-BtH7RosxKSeXmr-FvkxMVhv/exec';
var TQ_GAS_KEY = 'mitsumori-2024';

// canvas → 長辺1100pxに縮小した base64(jpeg, prefixなし)
// ※コスト対策: 1400→1100px・品質0.8 (画像トークン約4割減。文字読み取りは実用上ほぼ同等)
function tqCanvasToB64(cv, maxDim, quality){
  maxDim = maxDim || 1100;
  var sc = Math.min(1, maxDim / Math.max(cv.width, cv.height));
  var c2 = cv;
  if(sc < 1){
    c2 = document.createElement('canvas');
    c2.width = Math.round(cv.width * sc); c2.height = Math.round(cv.height * sc);
    c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height);
  }
  return c2.toDataURL('image/jpeg', quality || 0.8).split(',')[1];
}

// 画像(1枚以上のbase64) + プロンプト → AIのテキスト応答
// images: base64文字列 または canvas の配列
// opts: { model, maxDim, quality } — 高精度OCR時に高解像度＋上位モデルを指定可
async function tqAiVision(prompt, images, maxTokens, opts){
  opts = opts || {};
  var b64s = (images || []).map(function(im){
    return (im && im.getContext) ? tqCanvasToB64(im, opts.maxDim, opts.quality) : String(im).replace(/^data:[^,]*,/, '');
  });
  if(!b64s.length) throw new Error('画像がありません');
  var url = new URL(TQ_GAS_URL);
  url.searchParams.set('action', 'claudeVision');
  url.searchParams.set('apiKey', TQ_GAS_KEY);
  var payload = { prompt: prompt, images: b64s, maxTokens: maxTokens || 3000 };
  if(opts.model) payload.model = opts.model;   // GASが未対応でも無視されHaikuになる（後方互換）
  var res = await fetch(url.toString(), {
    method: 'POST', redirect: 'follow',
    body: JSON.stringify(payload)
  });
  var j;
  try { j = await res.json(); }
  catch(e){ throw new Error('AI応答の解析に失敗 (HTTP ' + res.status + ')'); }
  if(!j.success){
    var msg = j.error || ('HTTP ' + res.status);
    if(/daily_limit/i.test(msg)) throw new Error('本日のAI利用上限に達しました（翌日0時に自動再開。上限はGAS設定で変更可）');
    if(/usage limits|spending/i.test(msg)) throw new Error('AI利用上限に達しています（管理会社で上限引き上げが必要）');
    if(/ai_disabled/i.test(msg)) throw new Error('AI機能が管理者により停止されています');
    if(/CLAUDE_API_KEY/.test(msg)) throw new Error('GASにAPIキーが未設定です（管理会社で設定）');
    throw new Error('AI失敗: ' + msg);
  }
  return (j.reply || '').trim();
}
