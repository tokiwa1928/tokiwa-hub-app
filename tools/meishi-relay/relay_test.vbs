Dim x, fso, t, U, here
U = "https://script.google.com/macros/s/AKfycbyHvkRLokren7MkQZN2n7HCFsd3jwX6YOjBVCFB0gNqG3SJVpwPozXTrUma94NnuczT/exec"
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set t = fso.OpenTextFile(here & "\relay_test_log.txt", 2, True, -1)
On Error Resume Next
Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
x.open "GET", U, False : x.send
t.WriteLine "GET " & x.status & " " & Left(x.responseText, 600)
x.open "POST", U, False : x.setRequestHeader "Content-Type", "text/plain;charset=utf-8" : x.send "{""action"":""status""}"
t.WriteLine "POST " & x.status & " " & Left(x.responseText, 600)
If Err.Number <> 0 Then t.WriteLine "ERR " & Err.Description
t.Close
