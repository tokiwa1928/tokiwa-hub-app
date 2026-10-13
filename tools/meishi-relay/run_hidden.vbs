Dim sh, fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & here & "\deploy.cmd""", 0, True
