# Assinatura do instalador Windows

O workflow aceita um certificado de assinatura de código no formato `.pfx`. O certificado e a palavra-passe ficam nos segredos do GitHub e não são guardados no repositório.

1. Obtenha um certificado de assinatura de código emitido por uma autoridade certificadora reconhecida. Proteja o ficheiro `.pfx` com uma palavra-passe forte.
2. No computador onde está o certificado, copie o conteúdo codificado para o clipboard:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\caminho\certificado.pfx')) | Set-Clipboard
   ```

3. No repositório GitHub, abra **Settings → Secrets and variables → Actions** e crie os segredos:
   - `WIN_CSC_BASE64`: conteúdo que copiou do clipboard;
   - `WIN_CSC_KEY_PASSWORD`: palavra-passe do ficheiro `.pfx`.
4. Gere uma nova versão com uma tag `vX.Y.Z`. O workflow descodifica o certificado apenas no runner temporário e o Electron Builder assina o instalador.

O MyOffice não tem acesso aos segredos do repositório e não pode criar ou comprar um certificado em nome do proprietário. A assinatura comprova o editor e protege a integridade do ficheiro; a reputação SmartScreen também depende do certificado e da reputação acumulada dos downloads, por isso um aviso pode não desaparecer imediatamente no primeiro lançamento.

O workflow também mantém compatibilidade com `WIN_CSC_LINK` para certificados já configurados como caminho ou URL acessível ao runner.
