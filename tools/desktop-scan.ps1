<#
.SYNOPSIS
    デスクトップ全調査ツール / Desktop Inventory Tool

.DESCRIPTION
    デスクトップ（ユーザー + パブリック）配下を再帰的に走査し、
    ショートカット(.lnk / .url)のリンク先を解決した一覧を作成します。
    あわせて Windows のバージョン情報と、ショートカット先 / デスクトップ上の
    実行ファイルのバージョン（ソフトの版）も取得します。

    出力: CSV(Excel用 UTF-8 BOM) / HTMLレポート(検索・並べ替え可) / JSON(Hub取込用)

.PARAMETER OutDir
    出力先フォルダ。既定はスクリプトと同じ場所。

.PARAMETER ShortcutsOnly
    ショートカット(.lnk/.url)だけをリスト化します。

.PARAMETER MaxDepth
    走査する深さの上限。0 = デスクトップ直下のみ。既定は無制限(-1)。

.PARAMETER NoPublic
    パブリックデスクトップ(C:\Users\Public\Desktop)を除外します。

.PARAMETER NoHtml
    HTML レポートを出力しません。

.PARAMETER NoJson
    JSON を出力しません。

.PARAMETER NoVersion
    ソフトのバージョン取得をスキップします（速度優先）。

.EXAMPLE
    .\Scan-Desktop.ps1
    .\Scan-Desktop.ps1 -ShortcutsOnly
    .\Scan-Desktop.ps1 -MaxDepth 1 -OutDir C:\temp
#>
[CmdletBinding()]
param(
    [string] $OutDir,
    [switch] $ShortcutsOnly,
    [int]    $MaxDepth = -1,
    [switch] $NoPublic,
    [switch] $NoHtml,
    [switch] $NoJson,
    [switch] $NoVersion
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    if ($PSScriptRoot) { $OutDir = $PSScriptRoot } else { $OutDir = (Get-Location).Path }
}
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

# ════════════════ 1. Windows / PC 情報 ════════════════
function Get-SystemInfo {
    $info = [ordered]@{
        'OS名' = ''; 'エディション' = ''; 'バージョン' = ''; 'ビルド' = ''
        'アーキテクチャ' = ''; 'インストール日' = ''; '最終起動' = ''
        'コンピューター名' = $env:COMPUTERNAME; 'ユーザー名' = $env:USERNAME
        'ドメイン/ワークグループ' = ''; 'メーカー' = ''; '機種' = ''
        'CPU' = ''; 'メモリ' = ''; 'PowerShell' = $PSVersionTable.PSVersion.ToString()
        '調査日時' = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }

    try {
        $rv = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $build = [int]$rv.CurrentBuild
        $name  = [string]$rv.ProductName
        # Windows 11 でもレジストリ上は "Windows 10 ..." のままなので補正する
        if ($build -ge 22000 -and $name -like 'Windows 10*') {
            $name = $name -replace '^Windows 10', 'Windows 11'
        }
        $info['OS名'] = $name
        $ver = [string]$rv.DisplayVersion
        if ([string]::IsNullOrWhiteSpace($ver)) { $ver = [string]$rv.ReleaseId }
        $info['バージョン'] = $ver
        $ubr = $rv.UBR
        if ($null -ne $ubr) { $info['ビルド'] = "$build.$ubr" } else { $info['ビルド'] = "$build" }
    } catch { }

    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($info['OS名'])) { $info['OS名'] = $os.Caption }
        $info['エディション']   = $os.Caption
        $info['アーキテクチャ'] = $os.OSArchitecture
        if ($os.InstallDate)    { $info['インストール日'] = (Get-Date $os.InstallDate    -Format 'yyyy-MM-dd') }
        if ($os.LastBootUpTime) { $info['最終起動']       = (Get-Date $os.LastBootUpTime -Format 'yyyy-MM-dd HH:mm') }
    } catch { }

    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        $info['メーカー'] = $cs.Manufacturer
        $info['機種']     = $cs.Model
        if ($cs.PartOfDomain) { $info['ドメイン/ワークグループ'] = "$($cs.Domain) (ドメイン)" }
        else                  { $info['ドメイン/ワークグループ'] = "$($cs.Workgroup) (ワークグループ)" }
        if ($cs.TotalPhysicalMemory) { $info['メモリ'] = ('{0:N1} GB' -f ($cs.TotalPhysicalMemory / 1GB)) }
    } catch { }

    try {
        $cpu = @(Get-CimInstance Win32_Processor -ErrorAction Stop)[0]
        $info['CPU'] = ($cpu.Name -replace '\s+', ' ').Trim()
    } catch { }

    return $info
}

$SysInfo = Get-SystemInfo

# ════════════════ 2. 対象ルート ════════════════
$roots = @()
$userDesktop = [Environment]::GetFolderPath('Desktop')
if ($userDesktop -and (Test-Path -LiteralPath $userDesktop)) {
    $roots += [pscustomobject]@{ Path = $userDesktop; Label = 'ユーザー' }
}
if (-not $NoPublic) {
    $pubDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
    if ($pubDesktop -and (Test-Path -LiteralPath $pubDesktop)) {
        $roots += [pscustomobject]@{ Path = $pubDesktop; Label = 'パブリック' }
    }
}
if ($roots.Count -eq 0) { throw 'デスクトップフォルダが見つかりませんでした。' }

Write-Host '=== デスクトップ調査を開始します ===' -ForegroundColor Cyan
Write-Host ''
Write-Host '--- このPC ---' -ForegroundColor Cyan
foreach ($k in $SysInfo.Keys) {
    if ($SysInfo[$k]) { Write-Host ("  {0,-16} {1}" -f $k, $SysInfo[$k]) }
}
Write-Host ''
foreach ($r in $roots) { Write-Host ("  対象: [{0}] {1}" -f $r.Label, $r.Path) }

# ════════════════ 3. ショートカット解決 ════════════════
$shell = New-Object -ComObject WScript.Shell

function Resolve-Lnk {
    param([string] $Path)
    $res = [ordered]@{ Target = ''; Arguments = ''; WorkingDir = ''; IconLocation = ''; Description = '' }
    try {
        $sc = $shell.CreateShortcut($Path)
        $res.Target       = [string]$sc.TargetPath
        $res.Arguments    = [string]$sc.Arguments
        $res.WorkingDir   = [string]$sc.WorkingDirectory
        $res.IconLocation = [string]$sc.IconLocation
        $res.Description  = [string]$sc.Description
    } catch {
        $res.Description = '(解決失敗) ' + $_.Exception.Message
    }
    # TargetPath が空 = ms-settings 等の特殊/仮想アイテム。IconLocation から推測
    if ([string]::IsNullOrWhiteSpace($res.Target) -and -not [string]::IsNullOrWhiteSpace($res.IconLocation)) {
        $res.Target = '(特殊項目) ' + $res.IconLocation
    }
    return $res
}

function Resolve-Url {
    param([string] $Path)
    $res = [ordered]@{ Target = ''; Arguments = ''; WorkingDir = ''; IconLocation = ''; Description = '' }
    try {
        foreach ($line in (Get-Content -LiteralPath $Path -ErrorAction Stop)) {
            if ($line -match '^\s*URL\s*=\s*(.+)$')          { $res.Target       = $Matches[1].Trim() }
            elseif ($line -match '^\s*IconFile\s*=\s*(.+)$') { $res.IconLocation = $Matches[1].Trim() }
        }
    } catch {
        $res.Description = '(解決失敗) ' + $_.Exception.Message
    }
    return $res
}

# ════════════════ 4. ソフトのバージョン取得 ════════════════
# 実行ファイル(PE)に埋め込まれたバージョン資源を読む。同じパスは1回だけ調べる。
$VerCache = @{}
$VerExts  = @('.exe', '.dll', '.ocx', '.sys', '.cpl', '.scr', '.msi', '.com')

function Get-FileVersionInfo2 {
    param([string] $Path)
    $empty = [ordered]@{ Ver = ''; ProdVer = ''; Prod = ''; Company = '' }
    if ($NoVersion) { return $empty }
    if ([string]::IsNullOrWhiteSpace($Path)) { return $empty }
    if ($VerCache.ContainsKey($Path)) { return $VerCache[$Path] }

    $ext = ''
    try { $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant() } catch { }
    if ($VerExts -notcontains $ext) { $VerCache[$Path] = $empty; return $empty }

    $res = [ordered]@{ Ver = ''; ProdVer = ''; Prod = ''; Company = '' }
    try {
        $vi = (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo
        if ($vi) {
            if ($vi.FileVersion)    { $res.Ver     = ($vi.FileVersion    -replace '\s+', ' ').Trim() }
            if ($vi.ProductVersion) { $res.ProdVer = ($vi.ProductVersion -replace '\s+', ' ').Trim() }
            if ($vi.ProductName)    { $res.Prod    = $vi.ProductName.Trim() }
            if ($vi.CompanyName)    { $res.Company = $vi.CompanyName.Trim() }
        }
    } catch { }
    $VerCache[$Path] = $res
    return $res
}

# ════════════════ 5. 走査 ════════════════
$rows = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[string]
$scanned = 0

foreach ($root in $roots) {
    $rootPath = $root.Path.TrimEnd('\')

    $gciParams = @{
        LiteralPath   = $rootPath
        Recurse       = $true
        Force         = $true
        ErrorAction   = 'SilentlyContinue'
        ErrorVariable = 'gciErr'
    }
    if ($MaxDepth -ge 0) { $gciParams['Depth'] = $MaxDepth }

    $items = Get-ChildItem @gciParams
    foreach ($e in $gciErr) { $errors.Add([string]$e) }

    foreach ($item in $items) {
        $scanned++
        if ($scanned % 500 -eq 0) { Write-Host ("  走査中... {0} 件" -f $scanned) -ForegroundColor DarkGray }

        $isDir = $item.PSIsContainer
        $ext   = ''
        if (-not $isDir) { $ext = $item.Extension.ToLowerInvariant() }

        $kind = 'ファイル'
        if ($isDir)              { $kind = 'フォルダ' }
        elseif ($ext -eq '.lnk') { $kind = 'ショートカット' }
        elseif ($ext -eq '.url') { $kind = 'URLショートカット' }

        if ($ShortcutsOnly -and $kind -notlike '*ショートカット*') { continue }

        $rel = $item.FullName
        if ($rel.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
            $rel = $rel.Substring($rootPath.Length).TrimStart('\')
        }
        $depth = ($rel -split '\\').Count - 1

        $parentRel = Split-Path $rel -Parent
        $location = '(デスクトップ直下)'
        if ($parentRel) { $location = $parentRel }

        $target = ''; $argsText = ''; $workdir = ''; $icon = ''; $desc = ''; $targetState = ''
        if ($kind -eq 'ショートカット') {
            $r = Resolve-Lnk $item.FullName
            $target = $r.Target; $argsText = $r.Arguments; $workdir = $r.WorkingDir
            $icon = $r.IconLocation; $desc = $r.Description
        } elseif ($kind -eq 'URLショートカット') {
            $r = Resolve-Url $item.FullName
            $target = $r.Target; $icon = $r.IconLocation; $desc = $r.Description
        }

        if ($kind -eq 'ショートカット') {
            if ([string]::IsNullOrWhiteSpace($target)) {
                $targetState = '不明'
            } elseif ($target.StartsWith('(特殊項目)')) {
                $targetState = '特殊'
            } elseif (Test-Path -LiteralPath $target -ErrorAction SilentlyContinue) {
                $targetState = 'OK'
            } else {
                $targetState = 'リンク切れ'
            }
        } elseif ($kind -eq 'URLショートカット') {
            if ([string]::IsNullOrWhiteSpace($target)) { $targetState = '不明' } else { $targetState = 'Web' }
        }

        # バージョン: ショートカットはリンク先、デスクトップ上の実行ファイルは自分自身を見る
        $verSrc = ''
        if ($kind -eq 'ショートカット' -and $targetState -eq 'OK') { $verSrc = $target }
        elseif ($kind -eq 'ファイル' -and $VerExts -contains $ext) { $verSrc = $item.FullName }
        $vi = Get-FileVersionInfo2 $verSrc

        $sizeBytes = $null
        if (-not $isDir) { $sizeBytes = [int64]$item.Length }

        $rows.Add([pscustomobject]@{
            '場所'           = $root.Label
            '種類'           = $kind
            '名前'           = $item.Name
            '格納先'         = $location
            '階層'           = $depth
            'リンク先'       = $target
            '状態'           = $targetState
            'バージョン'     = $vi.Ver
            '製品名'         = $vi.Prod
            '発行元'         = $vi.Company
            '製品バージョン' = $vi.ProdVer
            '引数'           = $argsText
            '作業フォルダ'   = $workdir
            'サイズ'         = $sizeBytes
            '拡張子'         = $ext
            '更新日時'       = $item.LastWriteTime
            '作成日時'       = $item.CreationTime
            '属性'           = [string]$item.Attributes
            'フルパス'       = $item.FullName
            'アイコン'       = $icon
            '説明'           = $desc
        })
    }
}

Write-Host ("  走査完了: {0} 件を検出" -f $rows.Count) -ForegroundColor Green

# ════════════════ 6. 並べ替え ════════════════
$rows = $rows | Sort-Object '場所', '格納先', @{Expression = '種類'; Descending = $true}, '名前'

# ════════════════ 7. 出力 ════════════════
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$prefix = 'デスクトップ一覧'
if ($ShortcutsOnly) { $prefix = 'デスクトップ_ショートカット一覧' }
$csvPath  = Join-Path $OutDir ("{0}_{1}.csv"  -f $prefix, $stamp)
$htmlPath = Join-Path $OutDir ("{0}_{1}.html" -f $prefix, $stamp)
$jsonPath = Join-Path $OutDir ("{0}_{1}.json" -f $prefix, $stamp)

$rows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
Write-Host ("  CSV 出力: {0}" -f $csvPath) -ForegroundColor Green

# ════════════════ 8. 集計 ════════════════
$byKind = $rows | Group-Object '種類' | Sort-Object Count -Descending
$broken = @($rows | Where-Object { $_.'状態' -eq 'リンク切れ' })
$shortcutCount = @($rows | Where-Object { $_.'種類' -like '*ショートカット*' }).Count
$withVer = @($rows | Where-Object { $_.'バージョン' })
$totalSize = ($rows | Measure-Object 'サイズ' -Sum).Sum
if (-not $totalSize) { $totalSize = 0 }

Write-Host ''
Write-Host '--- 集計 ---' -ForegroundColor Cyan
foreach ($g in $byKind) { Write-Host ("  {0,-20} {1,6} 件" -f $g.Name, $g.Count) }
Write-Host ("  {0,-20} {1,6} 件" -f 'リンク切れ', $broken.Count)
Write-Host ("  {0,-20} {1,6} 件" -f 'バージョン取得', $withVer.Count)
Write-Host ("  {0,-20} {1,9:N1} MB" -f '合計サイズ', ($totalSize / 1MB))

if ($withVer.Count -gt 0) {
    Write-Host ''
    Write-Host '--- デスクトップにあるソフトのバージョン ---' -ForegroundColor Cyan
    $verTable = $withVer | Sort-Object '製品名', '名前' | Select-Object `
        @{n='ソフト';     e={ if ($_.'製品名') { $_.'製品名' } else { $_.'名前' } }},
        @{n='バージョン'; e={ $_.'バージョン' }},
        @{n='発行元';     e={ $_.'発行元' }}
    ($verTable | Format-Table -AutoSize | Out-String -Width 200).TrimEnd() | Write-Host
}

# ════════════════ 9. JSON (Hub 取込用) ════════════════
if (-not $NoJson) {
    $payload = [ordered]@{
        system    = $SysInfo
        roots     = @($roots | ForEach-Object { $_.Path })
        generated = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
        count     = $rows.Count
        items     = @($rows)
    }
    try {
        $json = $payload | ConvertTo-Json -Depth 5 -Compress
        [System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ("  JSON 出力: {0}" -f $jsonPath) -ForegroundColor Green
    } catch {
        Write-Host ("  ※ JSON 出力に失敗しました: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

# ════════════════ 10. HTML レポート ════════════════
if (-not $NoHtml) {
    function HE {
        param([object] $s)
        if ($null -eq $s) { return '' }
        return ([string]$s).Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
    }
    function FmtSize {
        param($b)
        if ($null -eq $b -or $b -eq '') { return '' }
        $b = [double]$b
        if ($b -lt 1KB) { return ("{0:N0} B"  -f $b) }
        if ($b -lt 1MB) { return ("{0:N1} KB" -f ($b / 1KB)) }
        if ($b -lt 1GB) { return ("{0:N1} MB" -f ($b / 1MB)) }
        return ("{0:N2} GB" -f ($b / 1GB))
    }

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">')
    [void]$sb.AppendLine('<meta name="viewport" content="width=device-width,initial-scale=1">')
    [void]$sb.AppendLine("<title>$prefix</title>")
    [void]$sb.AppendLine(@'
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1a1a19;--mut:#6b6b66;--line:#e3e3df;--acc:#b45309;--ok:#15803d;--ng:#b91c1c;--sp:#6d28d9;--web:#1d4ed8}
@media(prefers-color-scheme:dark){:root{--bg:#17171a;--card:#1f1f23;--ink:#ededea;--mut:#a0a09a;--line:#33333a;--acc:#f59e0b;--ok:#4ade80;--ng:#f87171;--sp:#c4b5fd;--web:#93c5fd}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 "Segoe UI","Yu Gothic UI",system-ui,sans-serif}
.wrap{max-width:1500px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:14px;margin:22px 0 8px;color:var(--mut);font-weight:600}
.sub{color:var(--mut);font-size:13px;margin-bottom:20px;word-break:break-all}
.sys{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin-bottom:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:7px 24px}
.sys div{font-size:13px;display:flex;gap:8px}
.sys b{color:var(--mut);font-weight:600;min-width:104px;flex:0 0 auto}
.sys span{word-break:break-all}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:120px}
.card .n{font-size:22px;font-weight:600}
.card .l{font-size:12px;color:var(--mut)}
.tools{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center}
input,select{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
#q{flex:1;min-width:220px}
.tblwrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--card);cursor:pointer;white-space:nowrap;font-weight:600;z-index:1}
th:hover{color:var(--acc)}
tr:hover td{background:rgba(128,128,128,.08)}
td.path{font-family:Consolas,monospace;font-size:12px;color:var(--mut);word-break:break-all;max-width:400px}
td.name{font-weight:500;max-width:250px;word-break:break-all}
td.ver{font-family:Consolas,monospace;font-size:12px;white-space:nowrap}
.b{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11px;border:1px solid currentColor;white-space:nowrap}
.s-ok{color:var(--ok)}.s-ng{color:var(--ng)}.s-sp{color:var(--sp)}.s-web{color:var(--web)}.s-un{color:var(--mut)}
.k{font-size:12px;color:var(--mut);white-space:nowrap}
.empty{padding:30px;text-align:center;color:var(--mut)}
</style>
'@)
    [void]$sb.AppendLine('</head><body><div class="wrap">')
    [void]$sb.AppendLine("<h1>$prefix</h1>")
    $rootsTxt = ($roots | ForEach-Object { $_.Path }) -join '  /  '
    [void]$sb.AppendLine('<div class="sub">' + (HE $rootsTxt) + ' &nbsp;·&nbsp; 作成: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '</div>')

    # --- PC情報 ---
    [void]$sb.AppendLine('<h2>🖥 このPC</h2><div class="sys">')
    foreach ($k in $SysInfo.Keys) {
        if ($SysInfo[$k]) {
            [void]$sb.AppendLine('<div><b>' + (HE $k) + '</b><span>' + (HE $SysInfo[$k]) + '</span></div>')
        }
    }
    [void]$sb.AppendLine('</div>')

    [void]$sb.AppendLine('<h2>📊 集計</h2><div class="cards">')
    [void]$sb.AppendLine('<div class="card"><div class="n">' + $rows.Count + '</div><div class="l">全項目</div></div>')
    [void]$sb.AppendLine('<div class="card"><div class="n">' + $shortcutCount + '</div><div class="l">ショートカット</div></div>')
    foreach ($g in $byKind) {
        [void]$sb.AppendLine('<div class="card"><div class="n">' + $g.Count + '</div><div class="l">' + (HE $g.Name) + '</div></div>')
    }
    [void]$sb.AppendLine('<div class="card"><div class="n" style="color:var(--ng)">' + $broken.Count + '</div><div class="l">リンク切れ</div></div>')
    [void]$sb.AppendLine('<div class="card"><div class="n">' + $withVer.Count + '</div><div class="l">バージョン取得</div></div>')
    [void]$sb.AppendLine('<div class="card"><div class="n">' + (FmtSize $totalSize) + '</div><div class="l">合計サイズ</div></div>')
    [void]$sb.AppendLine('</div>')

    [void]$sb.AppendLine('<h2>📋 一覧</h2>')
    [void]$sb.AppendLine('<div class="tools">')
    [void]$sb.AppendLine('<input id="q" placeholder="検索（名前・リンク先・バージョン・パス）…">')
    [void]$sb.AppendLine('<select id="fk"><option value="">種類：すべて</option>' + (($byKind | ForEach-Object { '<option>' + (HE $_.Name) + '</option>' }) -join '') + '</select>')
    [void]$sb.AppendLine('<select id="fs"><option value="">状態：すべて</option><option>OK</option><option>リンク切れ</option><option>特殊</option><option>Web</option><option>不明</option></select>')
    [void]$sb.AppendLine('<label class="k"><input type="checkbox" id="fv"> バージョンがあるものだけ</label>')
    [void]$sb.AppendLine('<span class="k" id="cnt"></span></div>')

    $cols = @('種類', '名前', '格納先', 'リンク先', '状態', 'バージョン', '発行元', 'サイズ', '更新日時')
    [void]$sb.AppendLine('<div class="tblwrap"><table id="t"><thead><tr>')
    foreach ($c in $cols) { [void]$sb.AppendLine('<th>' + $c + '</th>') }
    [void]$sb.AppendLine('</tr></thead><tbody>')

    $stateClass = @{ 'OK' = 's-ok'; 'リンク切れ' = 's-ng'; '特殊' = 's-sp'; 'Web' = 's-web'; '不明' = 's-un' }
    foreach ($r in $rows) {
        $st = [string]$r.'状態'
        $stHtml = ''
        if ($st) {
            $cls = $stateClass[$st]
            if (-not $cls) { $cls = 's-un' }
            $stHtml = '<span class="b ' + $cls + '">' + (HE $st) + '</span>'
        }
        $tgt = [string]$r.'リンク先'
        if ($r.'引数') { $tgt = $tgt + '  ' + $r.'引数' }
        $verCell = (HE $r.'バージョン')
        if ($r.'製品名') { $verCell = $verCell + '<div class="k">' + (HE $r.'製品名') + '</div>' }
        [void]$sb.AppendLine('<tr>' +
            '<td class="k">' + (HE $r.'種類') + '</td>' +
            '<td class="name">' + (HE $r.'名前') + '</td>' +
            '<td class="path">' + (HE $r.'格納先') + '</td>' +
            '<td class="path">' + (HE $tgt) + '</td>' +
            '<td>' + $stHtml + '</td>' +
            '<td class="ver">' + $verCell + '</td>' +
            '<td class="k">' + (HE $r.'発行元') + '</td>' +
            '<td class="k" data-v="' + [string]$r.'サイズ' + '">' + (FmtSize $r.'サイズ') + '</td>' +
            '<td class="k">' + (Get-Date $r.'更新日時' -Format 'yyyy-MM-dd HH:mm') + '</td></tr>')
    }
    [void]$sb.AppendLine('</tbody></table><div class="empty" id="none" style="display:none">該当なし</div></div>')

    [void]$sb.AppendLine(@'
<script>
var tb=document.querySelector("#t tbody"),rows=[].slice.call(tb.rows);
var q=document.getElementById("q"),fk=document.getElementById("fk"),fs=document.getElementById("fs"),fv=document.getElementById("fv"),cnt=document.getElementById("cnt"),none=document.getElementById("none");
function apply(){var s=q.value.toLowerCase(),k=fk.value,st=fs.value,vonly=fv.checked,n=0;
 rows.forEach(function(r){var t=r.innerText.toLowerCase();
  var ok=(!s||t.indexOf(s)>=0)&&(!k||r.cells[0].innerText===k)&&(!st||r.cells[4].innerText.trim()===st)&&(!vonly||r.cells[5].innerText.trim()!=="");
  r.style.display=ok?"":"none"; if(ok)n++;});
 cnt.textContent=n+" / "+rows.length+" 件"; none.style.display=n?"none":"block";}
q.addEventListener("input",apply);fk.addEventListener("change",apply);fs.addEventListener("change",apply);fv.addEventListener("change",apply);
var dir={};
document.querySelectorAll("#t th").forEach(function(th,i){th.addEventListener("click",function(){
 dir[i]=!dir[i];var d=dir[i]?1:-1;
 rows.sort(function(a,b){var x=a.cells[i],y=b.cells[i];
  var xv=x.dataset.v,yv=y.dataset.v;
  if(xv!==undefined&&yv!==undefined)return((+xv||0)-(+yv||0))*d;
  return x.innerText.localeCompare(y.innerText,"ja")*d;});
 rows.forEach(function(r){tb.appendChild(r);});});});
apply();
</script>
'@)
    [void]$sb.AppendLine('</div></body></html>')

    [System.IO.File]::WriteAllText($htmlPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($true)))
    Write-Host ("  HTML 出力: {0}" -f $htmlPath) -ForegroundColor Green
}

if ($errors.Count -gt 0) {
    Write-Host ''
    Write-Host ("  ※ アクセスできなかった項目: {0} 件（権限のないフォルダ等）" -f $errors.Count) -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 完了 ===' -ForegroundColor Cyan

$htmlOut = $null
if (-not $NoHtml) { $htmlOut = $htmlPath }
$jsonOut = $null
if (-not $NoJson) { $jsonOut = $jsonPath }
[pscustomobject]@{ Csv = $csvPath; Html = $htmlOut; Json = $jsonOut; Count = $rows.Count }
