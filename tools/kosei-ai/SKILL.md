---
name: kosei-ai
description: トキワhub の校正BOX にある修正リストを読み、Illustrator・InDesign・Word・Excel・PDF のデータを直して、結果を校正BOX に書き戻す。「校正BOX の 12345 を修正して」「AI トライアルで残っている校正は？」「福永さんの続きをやって」のように、校正の修正作業・引き継ぎを頼まれたときに使う。
---

# 校正BOX の修正作業（AI-PROOF-2）

校正BOX が唯一の台帳です。依頼・経緯・進み具合はチャットではなく校正BOX から読み、やったことは必ず校正BOX に書き戻します。こうしておくと、旗艦PC（Ryo）・fukunaga-sub（福永）・fukunaga-main（tomomi）のどの PC の Claude でも、人でも、続きから作業できます。

道具は同じフォルダの `kosei.mjs` です（`node kosei.mjs` で使い方が出ます）。環境変数 `KOSEI_AI_KEY` と `KOSEI_WORKER` が要ります。

## 手順

1. **探す**: `node kosei.mjs queue --open` で残りのあるカードを見る。頼まれたカードがあればそれを使う。
2. **読む**: `node kosei.mjs get <ID>`。`lists`（校ごとの修正リスト、行ごとの `state`）、`instructions`（原文）、`files`（Drive の校正データ）、`log`（これまでの作業）、`rules` を全部読む。
3. **札を立てる**: `node kosei.mjs claim <ID>`。`locked` が返ったら、ほかの PC が作業中。勝手に `--force` しない。持ち主が止まっている（最後の動きから時間がたっている）ことを人に確かめてから、引き継ぐときだけ `--force`。
4. **直す**: `state` が `todo` の行だけを、上から順に。
   - 確認事項に関わる行・指示があいまいな行は直さず `node kosei.mjs item <ID> <entryId> <No> confirm <理由>`。
   - 直せたら `item ... done`。直せなかったら `item ... failed <理由>`。1 行ずつその場で書く（途中で止まっても引き継げるように）。
5. **保存してログ**: 直したデータは Drive の校正フォルダ（`card.driveFolderUrl` の今の校の「出」）に保存し、`node kosei.mjs log <ID> "<何をしたか>" --file <URL>`。
6. **札を外す**: 全部終わったら `release <ID> review "<内校で見てほしい点>"`。途中で止めるなら `release <ID> paused "<どこまでやったか・次にやること>"`。

## 決まりごと

- 進めてよいのは「内校待ち」まで。お客様への校正出し・校了はしない。
- 校正BOX に書いてあることだけで作業する。口頭の追加指示は、まず校正BOX に書いてもらう。
- 数字・固有名詞・電話番号・URL・住所は一字一句そのまま。
- 元のデータは上書きしない。新しい版として保存する。

## ソフトの動かし方（Windows）

ExtendScript（.jsx）を書いて、PowerShell から COM で実行します。

```powershell
# Illustrator
$ai = New-Object -ComObject Illustrator.Application
$ai.DoJavaScriptFile("C:\work\fix.jsx")

# InDesign（バージョンで名前が変わる。例: InDesign.Application.2025）
$id = New-Object -ComObject InDesign.Application
$id.DoScript("C:\work\fix.jsx", 1246973031)   # 1246973031 = JavaScript
```

- Word・Excel は COM（`Word.Application` / `Excel.Application`）か、python-docx・openpyxl で直す。
- PDF は直接は直さない。元データ（ai・indd・docx など）を直して PDF に書き出す。元データが無ければ `item ... failed 元データなし` にする。
- 直したら PDF に書き出して、修正前の PDF と見比べてから done にする。
