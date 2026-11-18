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

; ---------- Escolher os programas a instalar ----------
; Uma página com uma caixa por programa. Só os programas escolhidos ficam com atalho e aparecem
; na aplicação. Numa atualização silenciosa mantém-se a escolha anterior (guardada no registo).
!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh
Var moSel_writer
Var moChk_writer
Var moSel_sheets
Var moChk_sheets
Var moSel_slides
Var moChk_slides
Var moSel_draw
Var moChk_draw
Var moSel_notes
Var moChk_notes
Var moSel_projects
Var moChk_projects
Var moSel_pdf
Var moChk_pdf
Var moSel_db
Var moChk_db
Var moSel_assistant
Var moChk_assistant

Function moProgramsPage
  ${If} ${Silent}
    Abort
  ${EndIf}
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 22u "Escolha os programas que quer instalar. Pode voltar a instalar para mudar a escolha."
  Pop $0
  ${NSD_CreateCheckbox} 8u 26u 100% 11u "Texto — documentos, cartas e relatórios"
  Pop $moChk_writer
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "writer"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_writer
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 38u 100% 11u "Folhas — folhas de cálculo e gráficos"
  Pop $moChk_sheets
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "sheets"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_sheets
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 50u 100% 11u "Diapositivos — apresentações"
  Pop $moChk_slides
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "slides"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_slides
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 62u 100% 11u "Desenho — fluxogramas e esquemas"
  Pop $moChk_draw
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "draw"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_draw
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 74u 100% 11u "Notas — cadernos de notas"
  Pop $moChk_notes
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "notes"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_notes
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 86u 100% 11u "Projetos — planeamento e gráfico de Gantt"
  Pop $moChk_projects
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "projects"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_projects
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 98u 100% 11u "PDF — ler, anotar e assinar"
  Pop $moChk_pdf
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "pdf"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_pdf
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 110u 100% 11u "Bases de dados — tabelas, formulários e servidores"
  Pop $moChk_db
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "db"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_db
  ${EndIf}
  ${NSD_CreateCheckbox} 8u 122u 100% 11u "Assistente — ajuda sem Internet"
  Pop $moChk_assistant
  ReadRegStr $1 HKCU "Software\MyOffice\Programas" "assistant"
  ${If} $1 != "0"
    ${NSD_Check} $moChk_assistant
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function moProgramsLeave
  StrCpy $2 0
  ${NSD_GetState} $moChk_writer $moSel_writer
  ${If} $moSel_writer == ${BST_CHECKED}
    StrCpy $moSel_writer "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_writer "0"
  ${EndIf}
  ${NSD_GetState} $moChk_sheets $moSel_sheets
  ${If} $moSel_sheets == ${BST_CHECKED}
    StrCpy $moSel_sheets "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_sheets "0"
  ${EndIf}
  ${NSD_GetState} $moChk_slides $moSel_slides
  ${If} $moSel_slides == ${BST_CHECKED}
    StrCpy $moSel_slides "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_slides "0"
  ${EndIf}
  ${NSD_GetState} $moChk_draw $moSel_draw
  ${If} $moSel_draw == ${BST_CHECKED}
    StrCpy $moSel_draw "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_draw "0"
  ${EndIf}
  ${NSD_GetState} $moChk_notes $moSel_notes
  ${If} $moSel_notes == ${BST_CHECKED}
    StrCpy $moSel_notes "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_notes "0"
  ${EndIf}
  ${NSD_GetState} $moChk_projects $moSel_projects
  ${If} $moSel_projects == ${BST_CHECKED}
    StrCpy $moSel_projects "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_projects "0"
  ${EndIf}
  ${NSD_GetState} $moChk_pdf $moSel_pdf
  ${If} $moSel_pdf == ${BST_CHECKED}
    StrCpy $moSel_pdf "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_pdf "0"
  ${EndIf}
  ${NSD_GetState} $moChk_db $moSel_db
  ${If} $moSel_db == ${BST_CHECKED}
    StrCpy $moSel_db "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_db "0"
  ${EndIf}
  ${NSD_GetState} $moChk_assistant $moSel_assistant
  ${If} $moSel_assistant == ${BST_CHECKED}
    StrCpy $moSel_assistant "1"
    IntOp $2 $2 + 1
  ${Else}
    StrCpy $moSel_assistant "0"
  ${EndIf}
  ${If} $2 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Escolha pelo menos um programa."
    Abort
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom moProgramsPage moProgramsLeave
!macroend
!endif

; Cria o atalho só se o programa foi escolhido (sem página, usa a escolha guardada ou instala).
!macro moMaybeShortcut KEY NAME ARG AUMI DESC
  ${If} $moSel_${KEY} == ""
    ReadRegStr $moSel_${KEY} HKCU "Software\MyOffice\Programas" "${KEY}"
  ${EndIf}
  ${If} $moSel_${KEY} == "0"
    !insertmacro moRemoveShortcut "${NAME}" "${AUMI}"
    WriteRegStr HKCU "Software\MyOffice\Programas" "${KEY}" "0"
  ${Else}
    !insertmacro moShortcut "${NAME}" "${ARG}" "${AUMI}" "${DESC}" "${KEY}"
    WriteRegStr HKCU "Software\MyOffice\Programas" "${KEY}" "1"
    FileWrite $9 "${KEY}$\r$\n"
  ${EndIf}
!macroend

!macro customInstall
  ; Os atalhos ficam diretamente no menu Iniciar, como o Word e o Excel (sem pasta "MyOffice").
  !insertmacro moCleanOldFolder
  ; programas.txt diz à aplicação quais foram escolhidos.
  FileOpen $9 "$INSTDIR\programas.txt" w
  !insertmacro moMaybeShortcut "writer" "MyOffice Texto" "--writer" "pt.myoffice.writer" "Escrever documentos, cartas e relatórios"
  !insertmacro moMaybeShortcut "sheets" "MyOffice Folhas" "--sheets" "pt.myoffice.sheets" "Folhas de cálculo, fórmulas e gráficos"
  !insertmacro moMaybeShortcut "slides" "MyOffice Diapositivos" "--slides" "pt.myoffice.slides" "Criar e apresentar diapositivos"
  !insertmacro moMaybeShortcut "draw" "MyOffice Desenho" "--draw" "pt.myoffice.draw" "Fluxogramas, mapas mentais e organogramas"
  !insertmacro moMaybeShortcut "notes" "MyOffice Notas" "--notes" "pt.myoffice.notes" "Cadernos com secções, páginas e desenho à mão"
  !insertmacro moMaybeShortcut "projects" "MyOffice Projetos" "--projects" "pt.myoffice.projects" "Planear projetos com tarefas, prazos e gráfico de Gantt"
  !insertmacro moMaybeShortcut "pdf" "MyOffice PDF" "--pdf" "pt.myoffice.pdf" "Ler, anotar, assinar e organizar PDF"
  !insertmacro moMaybeShortcut "db" "MyOffice Bases de dados" "--db" "pt.myoffice.db" "Tabelas, formulários, consultas e relatórios"
  !insertmacro moMaybeShortcut "assistant" "MyOffice Assistente" "--assistant" "pt.myoffice.assistant" "Ajuda, fórmulas e rascunhos sem Internet"
  FileClose $9
!macroend


!macro customUnInstall
  ; Atalhos de cada programa (também os de versões antigas) e respetivos grupos na barra de tarefas.
  !insertmacro moRemoveShortcut "MyOffice Texto" "pt.myoffice.writer"
  !insertmacro moRemoveShortcut "MyOffice Folhas" "pt.myoffice.sheets"
  !insertmacro moRemoveShortcut "MyOffice Diapositivos" "pt.myoffice.slides"
  !insertmacro moRemoveShortcut "MyOffice Desenho" "pt.myoffice.draw"
  !insertmacro moRemoveShortcut "MyOffice Notas" "pt.myoffice.notes"
  !insertmacro moRemoveShortcut "MyOffice Projetos" "pt.myoffice.projects"
  !insertmacro moRemoveShortcut "MyOffice PDF" "pt.myoffice.pdf"
  !insertmacro moRemoveShortcut "MyOffice Bases de dados" "pt.myoffice.db"
  !insertmacro moRemoveShortcut "MyOffice Assistente" "pt.myoffice.assistant"
  WinShell::UninstAppUserModelId "pt.myoffice.home"
  Delete "$INSTDIR\programas.txt"
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\MyOffice\Programas"
  ${endIf}
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
