# デプロイ前チェックリスト (tokiwa-hub-app)

⚠️ **main への push = 即・本番反映**（GitHub Pages）。push 前に以下を確認する。

## 毎回必須（1分）

- [ ] `git diff` を見て、**意図した変更だけ**が入っているか（無関係ファイル混入なし）
- [ ] **autocharge 関連を再有効化していないか**（AI自動要約・自動見積抽出は既定OFF。`AI_EXTRACTION_ENABLED` / `LW_AI_DRAFT_ENABLED` を `true` にするコードや、抽出ゲートを外す変更が入っていないこと）
- [ ] ローカルプレビューでログイン → エラーなく表示されるか

## UI を触った場合（+2分）

- [ ] 主要5画面を開く: **ホーム / 問い合わせ / 案件管理 / 受注・見積フォーム / 配送**
- [ ] 触った画面で「保存」など主要ボタンを1回実行
- [ ] コンソールに赤エラーが出ていないか（F12）

## 本番反映後

- [ ] 1〜2分待ってリロード（PWAは初回2回リロードが必要なことあり）
- [ ] 変更箇所を本番で1回確認

## 巻き戻し方法

```bash
cd C:/Users/web/tokiwa-hub-app
git log --oneline -5            # 戻したいコミットを確認
git revert <壊したコミットID>     # 打ち消しコミットを作成
git push origin main            # → 1〜2分で本番が元に戻る
```

## バックエンド (tokiwa_hub_backend) の注意

- main へ push すると GitHub Actions が **同じデプロイIDの GAS を上書き**する
- **コスト対策（AIキルスイッチ）がリポジトリに含まれていること**を必ず確認:
  - `08_ai.js` に `_isAiExtractionEnabled_`（既定OFF）がある
  - `04_communications.js` に `_isJunkCommunication_` と抽出ゲートがある
- CI が `invalid_grant / invalid_rapt` で失敗する場合は clasp の再認証が必要:
  1. `cd C:/Users/web/tokiwa_hub_backend && clasp login`（ブラウザで Google 認証）
  2. `~/.clasprc.json` を base64 化して GitHub Secret `CLASPRC_JSON_B64` を更新
     （PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.clasprc.json")) | Set-Clipboard`）
  3. `gh secret set CLASPRC_JSON_B64 --repo tokiwa1928/tokiwa-hub` で貼り付け、失敗した Run を再実行
