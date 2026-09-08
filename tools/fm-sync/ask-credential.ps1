# Claris ID の入力ダイアログ
#   入力内容を JSON で標準出力に返すだけのスクリプト。
#   キャンセルされたら終了コード 2 を返す。
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$f = New-Object Windows.Forms.Form
$f.Text = 'Claris ID でサインイン'
$f.Size = New-Object Drawing.Size(460, 260)
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false
$f.MinimizeBox = $false
$f.TopMost = $true
$f.Font = New-Object Drawing.Font('Yu Gothic UI', 9.5)

$lbl = New-Object Windows.Forms.Label
$lbl.Text = "FileMaker Cloud に接続します。`r`nFileMaker Pro を開くときのメールアドレスとパスワードを入力してください。`r`nパスワードは保存されません。"
$lbl.Location = New-Object Drawing.Point(16, 14)
$lbl.Size = New-Object Drawing.Size(420, 60)
$f.Controls.Add($lbl)

$l1 = New-Object Windows.Forms.Label
$l1.Text = 'メールアドレス'
$l1.Location = New-Object Drawing.Point(16, 84)
$l1.Size = New-Object Drawing.Size(110, 22)
$f.Controls.Add($l1)

$t1 = New-Object Windows.Forms.TextBox
$t1.Location = New-Object Drawing.Point(130, 81)
$t1.Size = New-Object Drawing.Size(292, 24)
$f.Controls.Add($t1)

$l2 = New-Object Windows.Forms.Label
$l2.Text = 'パスワード'
$l2.Location = New-Object Drawing.Point(16, 118)
$l2.Size = New-Object Drawing.Size(110, 22)
$f.Controls.Add($l2)

$t2 = New-Object Windows.Forms.TextBox
$t2.Location = New-Object Drawing.Point(130, 115)
$t2.Size = New-Object Drawing.Size(292, 24)
$t2.UseSystemPasswordChar = $true
$f.Controls.Add($t2)

$ok = New-Object Windows.Forms.Button
$ok.Text = 'サインイン'
$ok.Location = New-Object Drawing.Point(232, 168)
$ok.Size = New-Object Drawing.Size(92, 30)
$ok.DialogResult = [Windows.Forms.DialogResult]::OK
$f.Controls.Add($ok)
$f.AcceptButton = $ok

$ng = New-Object Windows.Forms.Button
$ng.Text = 'キャンセル'
$ng.Location = New-Object Drawing.Point(330, 168)
$ng.Size = New-Object Drawing.Size(92, 30)
$ng.DialogResult = [Windows.Forms.DialogResult]::Cancel
$f.Controls.Add($ng)
$f.CancelButton = $ng

$f.Add_Shown({ $f.Activate(); $t1.Focus() })
$r = $f.ShowDialog()

if ($r -ne [Windows.Forms.DialogResult]::OK -or -not $t1.Text) { exit 2 }
[Console]::Out.Write((@{ u = $t1.Text; p = $t2.Text } | ConvertTo-Json -Compress))
