; Dooo NSIS include for electron-builder.
; On a real uninstall (not the silent uninstall that runs during an update), remove the
; login item that the app registers through app.setLoginItemSettings.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Dooo"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Dooo"
  ${endIf}
!macroend
