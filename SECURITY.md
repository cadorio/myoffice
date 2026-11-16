# Segurança do MyOffice

## Distribuição e verificação

Descarrega o MyOffice apenas a partir do repositório oficial:
https://github.com/cadorio/myoffice

As compilações Windows publicam, quando todos os passos terminam com sucesso:
- Instalador `.exe`.
- Hash SHA-256 para confirmar a integridade do download.
- `SECURITY-REPORT.txt`, com o estado da assinatura e o resultado/indisponibilidade da análise Defender.
- `DEFENDER-SCAN.txt`, quando a ferramenta Microsoft Defender está disponível.
- `MyOffice-sbom.cdx.json`, inventário CycloneDX das dependências de produção.

No PowerShell, compara o resultado de `Get-FileHash .\MyOffice-Setup-1.4.0.exe -Algorithm SHA256` com o ficheiro `.sha256` publicado. Um hash igual confirma a integridade face ao artefacto publicado; não prova que o programa é isento de malware.

## Assinatura Authenticode

A assinatura exige um certificado de assinatura de código válido configurado nos segredos do GitHub Actions:
- `WIN_CSC_LINK`: certificado PFX ou ligação segura ao certificado.
- `WIN_CSC_KEY_PASSWORD`: palavra-passe do certificado.

Sem esses segredos, o instalador permanece sem assinatura e o Windows SmartScreen pode apresentar um aviso. A assinatura não garante que todos os antivírus deixem de emitir alertas.

## Análise Microsoft Defender

O workflow tenta analisar o instalador no runner Windows quando o utilitário está disponível. O relatório distingue ferramenta indisponível, análise ignorada e execução concluída. A análise automatizada não é uma certificação de segurança nem substitui testes independentes.

## Comunicação responsável de vulnerabilidades

Não publiques detalhes de vulnerabilidades por resolver em issues públicas. Usa o reporte privado do GitHub:
https://github.com/cadorio/myoffice/security/advisories/new

Inclui a versão afetada, os passos para reproduzir o problema e o impacto observado. Não envies documentos pessoais ou dados confidenciais.
