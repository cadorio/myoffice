; Instalador e desinstalador do MyOffice (incluído pelo electron-builder).
;
; Cada programa tem um atalho no menu Iniciar com o mesmo identificador (AppUserModelID) que a
; sua janela, para que fixar na barra de tarefas e as listas de atalhos funcionem por programa.

; Versões anteriores punham os atalhos numa pasta "MyOffice" e tinham um atalho geral.
!macro moCleanOldFolder
  Delete "$SMPROGRAMS\MyOffice\*.lnk"
  RMDir "$SMPROGRAMS\MyOffice"
  Delete "$SMPROGRAMS\MyOffice.lnk"
  Delete "$DESKTOP\MyOffice.lnk"
!macroend

; Cada programa tem o seu ícone (resources\icons\<id>.ico), no menu Iniciar e no ambiente de trabalho.
!macro moShortcut NAME ARG AUMI DESC ICON
  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}" "$INSTDIR\resources\icons\${ICON}.ico" 0 SW_SHOWNORMAL "" "${DESC}"
  WinShell::SetLnkAUMI "$SMPROGRAMS\${NAME}.lnk" "${AUMI}"
  CreateShortCut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "${ARG}" "$INSTDIR\resources\icons\${ICON}.ico" 0 SW_SHOWNORMAL "" "${DESC}"
  WinShell::SetLnkAUMI "$DESKTOP\${NAME}.lnk" "${AUMI}"
!macroend

!macro moRemoveShortcut NAME AUMI
  WinShell::UninstShortcut "$SMPROGRAMS\${NAME}.lnk"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  WinShell::UninstShortcut "$DESKTOP\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  WinShell::UninstAppUserModelId "${AUMI}"
!macroend

!macro customInstall
  ; Os atalhos ficam diretamente no menu Iniciar, como o Word e o Excel (sem pasta "MyOffice").
  !insertmacro moCleanOldFolder
  !insertmacro moShortcut "MyOffice Texto" "--writer" "pt.myoffice.writer" "Escrever documentos, cartas e relatórios" "writer"
  !insertmacro moShortcut "MyOffice Folhas" "--sheets" "pt.myoffice.sheets" "Folhas de cálculo, fórmulas e gráficos" "sheets"
  !insertmacro moShortcut "MyOffice Diapositivos" "--slides" "pt.myoffice.slides" "Criar e apresentar diapositivos" "slides"
  !insertmacro moShortcut "MyOffice Desenho" "--draw" "pt.myoffice.draw" "Fluxogramas, mapas mentais e organogramas" "draw"
  !insertmacro moShortcut "MyOffice Notas" "--notes" "pt.myoffice.notes" "Cadernos com secções, páginas e desenho à mão" "notes"
  !insertmacro moShortcut "MyOffice PDF" "--pdf" "pt.myoffice.pdf" "Ler, anotar, assinar e organizar PDF" "pdf"
  !insertmacro moShortcut "MyOffice Bases de dados" "--db" "pt.myoffice.db" "Tabelas, formulários, consultas e relatórios" "db"
  !insertmacro moShortcut "MyOffice Assistente" "--assistant" "pt.myoffice.assistant" "Ajuda, fórmulas e rascunhos sem Internet" "assistant"
!macroend


!macro customUnInstall
  ; Atalhos de cada programa (também os de versões antigas) e respetivos grupos na barra de tarefas.
  !insertmacro moRemoveShortcut "MyOffice Texto" "pt.myoffice.writer"
  !insertmacro moRemoveShortcut "MyOffice Folhas" "pt.myoffice.sheets"
  !insertmacro moRemoveShortcut "MyOffice Diapositivos" "pt.myoffice.slides"
  !insertmacro moRemoveShortcut "MyOffice Desenho" "pt.myoffice.draw"
  !insertmacro moRemoveShortcut "MyOffice Notas" "pt.myoffice.notes"
  !insertmacro moRemoveShortcut "MyOffice PDF" "pt.myoffice.pdf"
  !insertmacro moRemoveShortcut "MyOffice Bases de dados" "pt.myoffice.db"
  !insertmacro moRemoveShortcut "MyOffice Assistente" "pt.myoffice.assistant"
  WinShell::UninstAppUserModelId "pt.myoffice.home"
  ; Atalhos gerais "MyOffice" de versões anteriores (havia um menu inicial).
  Delete "$DESKTOP\MyOffice.lnk"
  Delete "$SMPROGRAMS\MyOffice.lnk"
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
