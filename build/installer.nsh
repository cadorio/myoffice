; Instalador e desinstalador do MyOffice (incluído pelo electron-builder).
;
; Cada programa tem um atalho no menu Iniciar com o mesmo identificador (AppUserModelID) que a
; sua janela, para que fixar na barra de tarefas e as listas de atalhos funcionem por programa.

!macro moShortcut NAME ARG AUMI DESC
  CreateShortCut "$SMPROGRAMS\MyOffice\${NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 SW_SHOWNORMAL "" "${DESC}"
  WinShell::SetLnkAUMI "$SMPROGRAMS\MyOffice\${NAME}.lnk" "${AUMI}"
!macroend

!macro moRemoveShortcut NAME AUMI
  WinShell::UninstShortcut "$SMPROGRAMS\MyOffice\${NAME}.lnk"
  Delete "$SMPROGRAMS\MyOffice\${NAME}.lnk"
  WinShell::UninstAppUserModelId "${AUMI}"
!macroend

!macro customInstall
  CreateDirectory "$SMPROGRAMS\MyOffice"
  !insertmacro moShortcut "MyOffice Texto" "--writer" "pt.myoffice.writer" "Escrever documentos, cartas e relatórios"
  !insertmacro moShortcut "MyOffice Folhas" "--sheets" "pt.myoffice.sheets" "Folhas de cálculo, fórmulas e gráficos"
  !insertmacro moShortcut "MyOffice Diapositivos" "--slides" "pt.myoffice.slides" "Criar e apresentar diapositivos"
  !insertmacro moShortcut "MyOffice Desenho" "--draw" "pt.myoffice.draw" "Fluxogramas, mapas mentais e organogramas"
  !insertmacro moShortcut "MyOffice Assistente" "--assistant" "pt.myoffice.assistant" "Ajuda, fórmulas e rascunhos sem Internet"
!macroend

!macro customUnInstall
  ; Atalhos de cada programa (também os de versões antigas) e respetivos grupos na barra de tarefas.
  !insertmacro moRemoveShortcut "MyOffice Texto" "pt.myoffice.writer"
  !insertmacro moRemoveShortcut "MyOffice Folhas" "pt.myoffice.sheets"
  !insertmacro moRemoveShortcut "MyOffice Diapositivos" "pt.myoffice.slides"
  !insertmacro moRemoveShortcut "MyOffice Desenho" "pt.myoffice.draw"
  !insertmacro moRemoveShortcut "MyOffice Assistente" "pt.myoffice.assistant"
  WinShell::UninstAppUserModelId "pt.myoffice.home"
  RMDir "$SMPROGRAMS\MyOffice"

  ; Pré-visualizações de impressão que possam ter ficado na pasta temporária.
  Delete "$TEMP\myoffice-pre-visualizacao-*.pdf"

  ; Numa atualização mantém-se tudo. Numa desinstalação, o utilizador escolhe se as definições
  ; também saem. Os documentos nunca são apagados: estão onde o utilizador os guardou.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Quer apagar também as definições do MyOffice?$\r$\n$\r$\nIsto remove a licença ativada, a lista de ficheiros recentes e os rascunhos de recuperação. Se voltar a instalar, terá de introduzir a chave de licença outra vez.$\r$\n$\r$\nOs seus documentos não são apagados." /SD IDNO IDNO moKeepData
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endif}
      RMDir /r "$APPDATA\MyOffice"
      RMDir /r "$APPDATA\myoffice"
      RMDir /r "$LOCALAPPDATA\MyOffice"
      RMDir /r "$LOCALAPPDATA\myoffice"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    moKeepData:
  ${endIf}
!macroend
