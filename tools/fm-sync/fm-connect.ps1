# FileMaker Cloud 接続テスト / 共通ライブラリ
#
#   トキワ印刷の FileMaker は Claris の FileMaker Cloud で動いています。
#   Data API (HTTPS) を使うと、CSV を手で書き出さなくても
#   プログラムから直接データを読めます。
#
#   使い方:
#     .\fm-connect.ps1              … 接続テスト（初回はID/パスワードを聞きます）
#     .\fm-connect.ps1 -Reset       … 保存した資格情報を消して入力し直す
#     .\fm-connect.ps1 -Db トキワ印刷AP
#
#   パスワードは Windows の DPAPI で暗号化され、
#   このPCのこのユーザーでしか復号できない形で保存されます。
#     保存先: %USERPROFILE%\.tokiwa\fm-cred.xml

param(
  [string]$Db = 'トキワ印刷DB',
  [switch]$Reset
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$FM_HOST  = 'tokiwa.account.filemaker-cloud.com'
$CRED_DIR = Join-Path $env:USERPROFILE '.tokiwa'
$CRED_FIL = Join-Path $CRED_DIR 'fm-cred.xml'


function Get-FMCredential {
  param([switch]$Force)
  if ($Force -and (Test-Path $CRED_FIL)) { Remove-Item $CRED_FIL -Force }
  if (Test-Path $CRED_FIL) { return Import-Clixml $CRED_FIL }

  Write-Host ''
  Write-Host '  FileMaker のアカウントを入力してください。' -ForegroundColor Cyan
  Write-Host '  （FileMaker Pro を開くときに使っているもの）'
  Write-Host '  入力内容はこのPCの中だけで暗号化して保存されます。'
  Write-Host ''
  $c = Get-Credential -Message 'FileMaker Cloud のアカウント'
  if (-not (Test-Path $CRED_DIR)) { New-Item -ItemType Directory -Path $CRED_DIR | Out-Null }
  $c | Export-Clixml $CRED_FIL
  Write-Host ("  保存しました: {0}" -f $CRED_FIL) -ForegroundColor DarkGray
  return $c
}


# PowerShell 5.1 は文字コードを取り違えることがあるので、
# 応答は必ず UTF-8 のバイト列として自前で読む。
function Invoke-FM {
  param(
    [string]$Method = 'GET',
    [string]$Url,
    [hashtable]$Headers = @{},
    $Body = $null
  )
  $req = [Net.HttpWebRequest]::Create($Url)
  $req.Method = $Method
  $req.Timeout = 120000
  $req.ReadWriteTimeout = 120000
  $req.Accept = 'application/json'
  foreach ($k in $Headers.Keys) {
    if ($k -eq 'Authorization') { $req.Headers.Add('Authorization', $Headers[$k]) }
    else { $req.Headers.Add($k, $Headers[$k]) }
  }
  if ($null -ne $Body) {
    $json  = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 12 -Compress }
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentType = 'application/json'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  }
  try {
    $res = $req.GetResponse()
  } catch [Net.WebException] {
    $res = $_.Exception.Response
    if (-not $res) { throw }
  }
  $sr   = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
  $text = $sr.ReadToEnd(); $sr.Close(); $res.Close()
  if (-not $text) { return $null }
  return $text | ConvertFrom-Json
}


function New-FMSession {
  param([string]$Database, $Credential)
  $u  = $Credential.UserName
  $p  = $Credential.GetNetworkCredential().Password
  $b  = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$u`:$p"))
  $db = [uri]::EscapeDataString($Database)
  $r  = Invoke-FM -Method POST `
          -Url "https://$FM_HOST/fmi/data/vLatest/databases/$db/sessions" `
          -Headers @{ Authorization = "Basic $b" } -Body @{}
  $code = $r.messages[0].code
  if ($code -ne '0') {
    throw ("FileMaker 認証に失敗しました (code {0}): {1}" -f $code, $r.messages[0].message)
  }
  return $r.response.token
}


function Remove-FMSession {
  param([string]$Database, [string]$Token)
  if (-not $Token) { return }
  $db = [uri]::EscapeDataString($Database)
  try {
    Invoke-FM -Method DELETE -Url "https://$FM_HOST/fmi/data/vLatest/databases/$db/sessions/$Token" | Out-Null
  } catch { }
}


function Get-FMLayouts {
  param([string]$Database, [string]$Token)
  $db = [uri]::EscapeDataString($Database)
  $r = Invoke-FM -Url "https://$FM_HOST/fmi/data/vLatest/databases/$db/layouts" `
        -Headers @{ Authorization = "Bearer $Token" }
  return $r.response.layouts
}


function Get-FMRecords {
  param(
    [string]$Database, [string]$Token, [string]$Layout,
    [int]$Offset = 1, [int]$Limit = 100, $Query = $null
  )
  $db = [uri]::EscapeDataString($Database)
  $ly = [uri]::EscapeDataString($Layout)
  if ($Query) {
    $r = Invoke-FM -Method POST `
          -Url "https://$FM_HOST/fmi/data/vLatest/databases/$db/layouts/$ly/_find" `
          -Headers @{ Authorization = "Bearer $Token" } `
          -Body @{ query = $Query; offset = "$Offset"; limit = "$Limit" }
    # 該当0件はエラー扱い(401)で返るので、空配列に読み替える
    if ($r.messages[0].code -eq '401') { return @() }
  } else {
    $r = Invoke-FM -Url "https://$FM_HOST/fmi/data/vLatest/databases/$db/layouts/$ly/records?_offset=$Offset&_limit=$Limit" `
          -Headers @{ Authorization = "Bearer $Token" }
  }
  if ($r.messages[0].code -ne '0') {
    throw ("取得に失敗しました (code {0}): {1}" -f $r.messages[0].code, $r.messages[0].message)
  }
  return $r.response.data
}


# ------------------------------------------------------------------
# 直接実行されたときだけ接続テストを走らせる（読み込み時は関数定義のみ）
# ------------------------------------------------------------------
if ($MyInvocation.InvocationName -ne '.') {

  Write-Host ''
  Write-Host '  FileMaker Cloud 接続テスト' -ForegroundColor White
  Write-Host ('  ホスト: {0}' -f $FM_HOST) -ForegroundColor DarkGray
  Write-Host ('  ファイル: {0}' -f $Db) -ForegroundColor DarkGray

  $cred  = Get-FMCredential -Force:$Reset
  $token = $null
  try {
    $token = New-FMSession -Database $Db -Credential $cred
    Write-Host ''
    Write-Host '  ✓ 接続できました' -ForegroundColor Green

    $lay = Get-FMLayouts -Database $Db -Token $token
    $names = @()
    foreach ($l in $lay) {
      if ($l.isFolder) { foreach ($c in $l.folderLayoutNames) { $names += $c.name } }
      else { $names += $l.name }
    }
    Write-Host ('  レイアウト {0} 件' -f $names.Count) -ForegroundColor Green
    $hit = $names | Where-Object { $_ -match '受注' }
    if ($hit) {
      Write-Host '  受注関係のレイアウト:' -ForegroundColor Cyan
      $hit | ForEach-Object { Write-Host ('    - {0}' -f $_) }
    } else {
      Write-Host '  （先頭20件）' -ForegroundColor DarkGray
      $names | Select-Object -First 20 | ForEach-Object { Write-Host ('    - {0}' -f $_) }
    }

    $target = @($hit)[0]
    if (-not $target) { $target = $names[0] }
    if ($target) {
      Write-Host ''
      Write-Host ('  「{0}」から1件読んで項目名を確認します' -f $target) -ForegroundColor Cyan
      $rec = Get-FMRecords -Database $Db -Token $token -Layout $target -Limit 1
      if ($rec -and $rec.Count -gt 0) {
        $f = $rec[0].fieldData.PSObject.Properties.Name
        Write-Host ('  項目 {0} 件' -f $f.Count) -ForegroundColor Green
        $out = Join-Path $PSScriptRoot 'fields.txt'
        $f | Sort-Object | Out-File -FilePath $out -Encoding utf8
        Write-Host ('  項目名の一覧を書き出しました: {0}' -f $out) -ForegroundColor DarkGray
        $f | Select-Object -First 25 | ForEach-Object { Write-Host ('    - {0}' -f $_) }
        if ($f.Count -gt 25) { Write-Host ('    …ほか {0} 件' -f ($f.Count - 25)) -ForegroundColor DarkGray }
      } else {
        Write-Host '  レコードが取得できませんでした' -ForegroundColor Yellow
      }
    }

    Write-Host ''
    Write-Host '  すべて成功しました。毎朝の自動照合を組めます。' -ForegroundColor Green
  }
  catch {
    Write-Host ''
    Write-Host ('  × {0}' -f $_.Exception.Message) -ForegroundColor Red
    Write-Host ''
    if ($_.Exception.Message -match '212') {
      Write-Host '  アカウントかパスワードが違います。' -ForegroundColor Yellow
      Write-Host '  入力し直す場合:  .\fm-connect.ps1 -Reset'
    } elseif ($_.Exception.Message -match '9|802') {
      Write-Host '  アカウントに Data API の権限(fmrest)がない可能性があります。' -ForegroundColor Yellow
      Write-Host '  FileMaker Pro で [ファイル > 管理 > セキュリティ] を開き、'
      Write-Host '  アクセス権セットの「拡張アクセス権」で'
      Write-Host '  fmrest（FileMaker Data API でのアクセス）にチェックを入れてください。'
    }
  }
  finally {
    Remove-FMSession -Database $Db -Token $token
  }
  Write-Host ''
}
