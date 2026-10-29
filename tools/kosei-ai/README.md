# 校正BOX の AI 作業（各 PC の準備）

対象: 旗艦PC（Ryo）・fukunaga-sub（福永）・fukunaga-main（tomomi）

1. Node.js 18 以上と Claude Code を入れる。
2. このフォルダ（`kosei.mjs` と `SKILL.md`）を `%USERPROFILE%\.claude\skills\kosei-ai\` に置く。
3. 環境変数を設定する（PowerShell。PC ごとに名前を変える）:

   ```powershell
   setx KOSEI_AI_KEY "<AI 用キー>"
   setx KOSEI_WORKER "旗艦PC/Ryo"
   ```

   AI 用キーは GAS の `proofAiSetKey` で作る（作り直すと前のキーは使えなくなる）。キーはこのリポジトリに書かない。
4. 確認: `node %USERPROFILE%\.claude\skills\kosei-ai\kosei.mjs queue`
5. Claude Code に「校正BOX の AI トライアルで残っているものを修正して」と頼む。

作業の記録は GAS のスプレッドシートのタブ「校正AI作業」に 1 行ずつ残り、Hub の校正BOX の「🤖 AI 修正リスト」に札・行ごとの結果・作業ログとして出ます。
