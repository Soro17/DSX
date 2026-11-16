' DSX desktop launcher for Windows.
' Double-click to open DSX in its own app window (no browser tabs, no console window).
' The first run installs dependencies and adds DSX shortcuts to the Desktop and Start menu.
Option Explicit

Const PORT = "3000"
Dim sh, fso, dir, url, appArgs
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:" & PORT & "/"
sh.CurrentDirectory = dir

' --- must be run from the extracted folder
If Not fso.FileExists(dir & "\package.json") Then
  MsgBox "Please extract the DSX ZIP first (right-click > Extract All), then open DSX from the extracted folder.", vbExclamation, "DSX"
  WScript.Quit 1
End If

' --- Node.js present?
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "DSX needs Node.js (free). Your browser will open the download page." & vbCrLf & _
         "Install the LTS version, then open DSX again.", vbExclamation, "DSX"
  sh.Run "https://nodejs.org/en/download"
  WScript.Quit 1
End If

' --- first run: install dependencies (shows progress once)
If Not fso.FolderExists(dir & "\node_modules") Then
  If sh.Run("cmd /c title DSX setup & echo Setting up DSX - first time only, please wait... & npm.cmd install", 1, True) <> 0 Then
    MsgBox "Setup failed. Check your internet connection and try again.", vbCritical, "DSX"
    WScript.Quit 1
  End If
End If

CreateShortcuts

' --- start the server hidden (unless it is already running)
If Not IsUp() Then
  If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder dir & "\data"
  sh.Run "cmd /c set DSX_APP=1&& set PORT=" & PORT & "&& node server\index.js > ""data\dsx.log"" 2>&1", 0, False
  Dim i
  For i = 1 To 60
    WScript.Sleep 500
    If IsUp() Then Exit For
  Next
  If Not IsUp() Then
    MsgBox "DSX could not start. Details are in data\dsx.log inside the DSX folder.", vbCritical, "DSX"
    WScript.Quit 1
  End If
End If

' --- open the app window
appArgs = " --app=" & url & " --window-size=1440,900 --no-first-run"
Dim edge, chrome
edge = AppPath("msedge.exe")
chrome = AppPath("chrome.exe")
If edge <> "" Then
  sh.Run """" & edge & """" & appArgs, 1, False
ElseIf chrome <> "" Then
  sh.Run """" & chrome & """" & appArgs, 1, False
Else
  sh.Run url, 1, False
End If

' ----------------------------------------------------------------------------
Function IsUp()
  Dim http
  IsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", url & "api/me", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then IsUp = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function AppPath(exe)
  AppPath = ""
  On Error Resume Next
  AppPath = sh.RegRead("HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\")
  If AppPath = "" Then AppPath = sh.RegRead("HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" & exe & "\")
  Err.Clear
  On Error GoTo 0
  If AppPath <> "" Then
    If Not fso.FileExists(AppPath) Then AppPath = ""
  End If
End Function

Sub CreateShortcuts()
  Dim places, p, lnk
  places = Array(sh.SpecialFolders("Desktop"), sh.SpecialFolders("Programs"))
  For Each p In places
    If p <> "" Then
      Set lnk = sh.CreateShortcut(p & "\DSX.lnk")
      lnk.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe")
      lnk.Arguments = """" & WScript.ScriptFullName & """"
      lnk.WorkingDirectory = dir
      lnk.IconLocation = dir & "\public\img\dsx.ico,0"
      lnk.Description = "DSX - trade with live prices"
      lnk.Save
    End If
  Next
End Sub
