; Default the assisted installer to the ASCII DeepagensWork directory under
; Program Files: the OEM display name stays user-facing (see the nsis config)
; while the on-disk install path stays stable across OEM display-name renames.
;
; Before installing, silently uninstall the legacy pre-rename brand builds
; (MeowWork, Deepagens-Worker). electron-builder's own upgrade path
; (uninstallOldVersion, in the install section) only removes versions sharing
; this app's uninstall-registry key, so separately-keyed legacy installs would
; otherwise survive an upgrade as a second copy. The running legacy app is
; force-closed first; its uninstaller runs with /S so user data survives, the
; same policy the same-key upgrade path applies. Canceling the wizard after
; this point leaves the legacy app uninstalled — accepted, because those
; brands are superseded by this build.
;
; This file must stay pure ASCII: makensis reads it with the build machine's
; ANSI codepage, so non-ASCII string literals here would garble.
!include "LogicLib.nsh"

!macro customInit
  StrCpy $INSTDIR "$PROGRAMFILES64\DeepagensWork"
  InitPluginsDir
  !insertmacro _dwStopLegacyApp "MeowWork.exe"
  !insertmacro _dwStopLegacyApp "Deepagens-Worker.exe"
  !insertmacro _dwUninstallLegacyBrands HKLM 64
  !insertmacro _dwUninstallLegacyBrands HKLM 32
  !insertmacro _dwUninstallLegacyBrands HKCU 64
!macroend

; Force-close one legacy-brand executable tree. Best effort: taskkill errors
; into $R9 when the app is not running, and is discarded.
!macro _dwStopLegacyApp _exe
  nsExec::Exec `cmd.exe /C taskkill /F /T /IM "${_exe}"`
  Pop $R9
!macroend

; Walk one registry view's uninstall entries and silently uninstall every
; entry whose display name names a legacy brand. $R6 remembers the last
; processed key so a key that survives its own uninstall cannot loop the
; enumeration.
!macro _dwUninstallLegacyBrands _root _view
  Push $R9
  SetRegView ${_view}
  StrCpy $R6 ""
  StrCpy $R5 0
  ${Do}
    EnumRegKey $R0 ${_root} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R5
    ${If} $R0 == ""
      ${Break}
    ${EndIf}
    IntOp $R5 $R5 + 1
    ${If} $R0 == $R6
      ${Continue}
    ${EndIf}
    ReadRegStr $R1 ${_root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "DisplayName"
    ${If} $R1 == "MeowWork"
    ${OrIf} $R1 == "Deepagens-Worker"
    ${OrIf} $R1 == "DeepWork"
      StrCpy $R6 $R0
      ReadRegStr $R2 ${_root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "UninstallString"
      ${If} $R2 != ""
        !insertmacro _dwStopLegacyApp "$R1.exe"
        Push $R3
        Push $R4
        ReadRegStr $R3 ${_root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0" "InstallLocation"
        Push $R2
        Call _dwExtractExePath
        Pop $R2
        ${If} $R3 == ""
          Push $R2
          Call _dwParentDir
          Pop $R3
        ${EndIf}
        ; Copy the uninstaller out of the dying install directory and run it
        ; in place: the _?= form makes an NSIS uninstaller wait instead of
        ; relaunching from %TEMP% and exiting before files are removed.
        CopyFiles /SILENT $R2 "$PLUGINSDIR\dw-legacy-uninstall.exe"
        ExecWait `"$PLUGINSDIR\dw-legacy-uninstall.exe" /S _?=$R3` $R4
        DeleteRegKey ${_root} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R0"
        Pop $R4
        Pop $R3
      ${EndIf}
    ${EndIf}
  ${Loop}
  SetRegView 64
  Pop $R9
!macroend

; Extract the executable path from an UninstallString value: strip one
; surrounding pair of double quotes when present ("C:\...\Uninstall X.exe").
; Both helpers are guarded to the installer pass: the uninstaller pass never
; calls them, and electron-builder zeroes unreferenced install functions out
; with a warning that the build treats as an error.
!ifndef BUILD_UNINSTALLER
Function _dwExtractExePath
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R1 $R0 1 0
  ${If} $R1 == '"'
    StrCpy $R2 1
    ${Do}
      IntOp $R2 $R2 + 1
      StrCpy $R1 $R0 1 $R2
      ${If} $R1 == ""
        ${ExitDo}
      ${EndIf}
      ${If} $R1 == '"'
        StrCpy $R0 $R0 $R2 1
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; Replace a file path with its parent directory ("" when there is none).
Function _dwParentDir
  Exch $R0
  Push $R1
  Push $R2
  StrLen $R1 $R0
  ${Do}
    ${If} $R1 == 0
      StrCpy $R0 ""
      ${ExitDo}
    ${EndIf}
    IntOp $R1 $R1 - 1
    StrCpy $R2 $R0 1 $R1
    ${If} $R2 == "\"
      StrCpy $R0 $R0 $R1
      ${ExitDo}
    ${EndIf}
  ${Loop}
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
!endif
