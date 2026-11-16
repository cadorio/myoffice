!macro customInstall
  CreateDirectory "$SMPROGRAMS\MyOffice"
  CreateShortCut "$SMPROGRAMS\MyOffice\MyOffice Texto.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--writer" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Abrir diretamente o editor de texto MyOffice"
  CreateShortCut "$SMPROGRAMS\MyOffice\MyOffice Folhas.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--sheets" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Abrir diretamente as folhas de cálculo MyOffice"
  CreateShortCut "$SMPROGRAMS\MyOffice\MyOffice Diapositivos.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--slides" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "Abrir diretamente as apresentações MyOffice"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\MyOffice\MyOffice Texto.lnk"
  Delete "$SMPROGRAMS\MyOffice\MyOffice Folhas.lnk"
  Delete "$SMPROGRAMS\MyOffice\MyOffice Diapositivos.lnk"
  RMDir "$SMPROGRAMS\MyOffice"
!macroend
