<#
  Excel・Word・PowerPoint を PDF にしてデスクトップへ（Tokiwa Hub ツール「PDFにしてデスクトップへ」）
  - 入れたファイルと同じ名前の PDF をデスクトップに作る（同名があれば (2) を付ける。上書きしない）
  - PC に入っている Office で変換するので、印刷したのと同じ見た目（印刷範囲・改ページもそのまま）
  - マクロは動かさない・元のファイルは読み取り専用で開く（変えない・保存しない）
  - 使い方: PDFにしてデスクトップへ.bat に ファイル／フォルダ をドラッグ&ドロップ。bat をダブルクリックするとファイルを選ぶ窓が出る
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)   # 落としたファイル全部（bat から 1 つずつ渡る）
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$exts = @('.xls', '.xlsx', '.xlsm', '.doc', '.docx', '.docm', '.rtf', '.ppt', '.pptx', '.pptm')

# ファイルが渡されなければ選ぶ窓
if (-not $Paths -or $Paths.Count -eq 0) {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'PDF にするファイルを選ぶ（複数OK）'
  $dlg.Multiselect = $true
  $dlg.Filter = 'Excel・Word・PowerPoint|*.xls;*.xlsx;*.xlsm;*.doc;*.docx;*.docm;*.rtf;*.ppt;*.pptx;*.pptm|すべて|*.*'
  if ($dlg.ShowDialog() -ne 'OK') { Write-Host 'やめました。'; exit 0 }
  $Paths = $dlg.FileNames
}

# フォルダは中のファイルを全部（下の階層も）
$files = @()
foreach ($p in $Paths) {
  if (Test-Path -LiteralPath $p -PathType Container) {
    $files += Get-ChildItem -LiteralPath $p -File -Recurse | Where-Object { $exts -contains $_.Extension.ToLower() -and $_.Name -notlike '~$*' }
  } elseif (Test-Path -LiteralPath $p -PathType Leaf) {
    $files += Get-Item -LiteralPath $p
  } else { Write-Host "見つかりません: $p" }
}
$files = $files | Where-Object { $exts -contains $_.Extension.ToLower() }
if (-not $files -or $files.Count -eq 0) { Write-Host 'Excel・Word・PowerPoint のファイルがありません。'; exit 1 }

function Out-Name([string]$base) {   # デスクトップに同じ名前。あれば (2) (3) …
  $out = Join-Path $desktop ($base + '.pdf'); $n = 2
  while (Test-Path -LiteralPath $out) { $out = Join-Path $desktop ("$base ($n).pdf"); $n++ }
  return $out
}
# 出力名は [string] に直して渡す（PowerShell が包んだ文字列のままだと Word の ExportAsFixedFormat が返ってこない。10/9 に確認）
function Release($o) { if ($o) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch {} } }

$xl = $null; $wd = $null; $pp = $null
$done = @(); $failed = @()
Write-Host ("{0} 件を PDF にします → {1}" -f $files.Count, $desktop)
foreach ($f in $files) {
  $base = [IO.Path]::GetFileNameWithoutExtension($f.Name)
  $out = Out-Name $base
  $ext = $f.Extension.ToLower()
  try {
    if ($ext -in '.xls', '.xlsx', '.xlsm') {
      if (-not $xl) { $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AutomationSecurity = 3 }   # 3 = マクロを動かさない
      $wb = $xl.Workbooks.Open($f.FullName, 0, $true)   # UpdateLinks=0, ReadOnly
      try { $wb.ExportAsFixedFormat(0, [string]$out) } finally { $wb.Close($false); Release $wb }   # 0 = PDF（全シート・印刷範囲どおり）
    } elseif ($ext -in '.doc', '.docx', '.docm', '.rtf') {
      if (-not $wd) { $wd = New-Object -ComObject Word.Application; $wd.Visible = $false; $wd.DisplayAlerts = 0; $wd.AutomationSecurity = 3 }
      $doc = $wd.Documents.Open($f.FullName, $false, $true)   # ConfirmConversions=false, ReadOnly
      try { $doc.ExportAsFixedFormat([string]$out, 17) } finally { $doc.Close(0); Release $doc }   # 17 = PDF, Close(0) = 保存しない
    } else {
      if (-not $pp) { $pp = New-Object -ComObject PowerPoint.Application; $pp.AutomationSecurity = 3 }
      $pres = $pp.Presentations.Open($f.FullName, $true, $false, $false)   # ReadOnly, Untitled=false, WithWindow=false
      try { $pres.SaveAs([string]$out, 32) } finally { $pres.Close(); Release $pres }   # 32 = PDF
    }
    $done += $out
    Write-Host ("  ✔ {0}  →  {1}" -f $f.Name, [IO.Path]::GetFileName($out))
  } catch {
    $failed += $f.Name
    Write-Host ("  ✖ {0}: {1}" -f $f.Name, $_.Exception.Message)
  }
}
foreach ($app in @($xl, $wd, $pp)) { if ($app) { try { $app.Quit() } catch {}; Release $app } }
[GC]::Collect(); [GC]::WaitForPendingFinalizers()

Write-Host ''
Write-Host ("できた: {0} 件　できなかった: {1} 件" -f $done.Count, $failed.Count)
if ($failed.Count) { Write-Host ('  できなかったもの: ' + ($failed -join '、')); Write-Host '  （パスワード付き・壊れている・Office が入っていない、のどれか）' }
if ($done.Count) { Start-Process explorer.exe ('/select,"' + $done[-1] + '"') }   # デスクトップを開いて最後の PDF を選んだ状態に
exit ($(if ($failed.Count) { 1 } else { 0 }))
