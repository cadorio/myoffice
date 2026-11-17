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

## Azure Trusted Signing (recomendado)

É a forma mais barata de assinar (cerca de 10 € por mês) e a Microsoft confia nela de imediato no SmartScreen e no Defender.

1. No portal Azure, crie uma conta **Trusted Signing**, faça a validação de identidade e crie um perfil de certificado *Public Trust*.
2. Crie um registo de aplicação no Microsoft Entra ID com um segredo de cliente e dê-lhe a função **Trusted Signing Certificate Profile Signer** na conta.
3. Em **Settings → Secrets and variables → Actions**, crie:
   - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`;
   - `AZURE_SIGN_ENDPOINT` (por exemplo `https://weu.codesigning.azure.net`);
   - `AZURE_SIGN_ACCOUNT` (nome da conta) e `AZURE_SIGN_PROFILE` (nome do perfil);
   - `AZURE_SIGN_PUBLISHER` (nome do editor, exatamente como no certificado).
4. A próxima versão sai assinada: o instalador NSIS, o MSI e o `MyOffice.exe` do ZIP portátil.

Se existirem segredos Azure, são usados em vez do PFX.

## Falsos positivos do antivírus

Programas novos e sem assinatura são por vezes marcados por heurística. Quando isso acontecer:

1. Envie o ficheiro à Microsoft em <https://www.microsoft.com/wdsi/filesubmission>, escolhendo **Software developer** e **Incorrectly detected as malware**.
2. Para outros antivírus, use o formulário de falsos positivos de cada fabricante.
3. Indique o SHA-256 do ficheiro, que está no `SHA256SUMS.txt` da release.

O MyOffice ajuda a reduzir estes alertas: o executável traz editor, copyright e versão preenchidos, não pede privilégios de administrador (exceto o MSI, que instala para todos) e não descarrega código da Internet.
