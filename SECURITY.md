# Segurança do MyOffice

## Distribuição e verificação

Descarrega o MyOffice apenas a partir do repositório oficial:

https://github.com/cadorio/myoffice

Cada compilação Windows disponibiliza, quando a geração termina com sucesso:

- O instalador `.exe`.
- Um ficheiro `.sha256` com o respetivo resumo SHA-256.
- `SECURITY-REPORT.txt`, com o estado da assinatura Authenticode e o resultado da verificação no Microsoft Defender executada no runner de compilação.
- `MyOffice-sbom.cdx.json`, inventário CycloneDX das dependências de produção.

Para validar o ficheiro no Windows PowerShell, executa na pasta do instalador:

```powershell
Get-FileHash .\MyOffice-Setup-1.3.0.exe -Algorithm SHA256
```

Compara o valor apresentado com o conteúdo do ficheiro `.sha256`. Um hash igual confirma que o ficheiro corresponde ao artefacto para o qual o hash foi publicado; não prova, por si só, que o software é seguro.

## Assinatura digital

A assinatura Authenticode permite identificar o editor e detetar alterações ao executável. A compilação só será assinada quando o repositório tiver um certificado de assinatura de código válido configurado nos segredos GitHub Actions:

- `WIN_CSC_LINK`: certificado PFX ou ligação segura ao certificado.
- `WIN_CSC_KEY_PASSWORD`: palavra-passe do certificado.

Sem esses segredos, o instalador fica sem assinatura digital e o Windows SmartScreen pode apresentar um aviso. A assinatura não garante que todos os antivírus deixem de emitir alertas; a reputação SmartScreen também depende da reputação do certificado e do ficheiro.

## Comunicação responsável de vulnerabilidades

Não publiques detalhes de vulnerabilidades por resolver em issues públicas. Usa a funcionalidade privada de reporte de vulnerabilidades do GitHub:

https://github.com/cadorio/myoffice/security/advisories/new

Inclui a versão afetada, os passos para reproduzir o problema e o impacto observado. Não envies documentos pessoais ou dados confidenciais.

## Limites das verificações

A análise no Microsoft Defender é uma verificação automatizada no ambiente de compilação, não uma certificação de ausência de malware nem uma análise por todos os fornecedores de antivírus. Os hashes servem para verificar integridade. O inventário SBOM documenta dependências, mas não substitui a análise e atualização dessas dependências.
