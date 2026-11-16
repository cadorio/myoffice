# MyOffice 1.5.0 — Professional

## Objetivo
Evoluir o MyOffice de uma suite desktop funcional para uma alternativa de produtividade mais completa, mantendo processamento local, privacidade e uma experiência simples.

## Princípios
- Priorizar estabilidade, integridade dos documentos e compatibilidade antes de acrescentar funcionalidades cosméticas.
- Preservar o funcionamento offline sempre que tecnicamente possível.
- Não enviar documentos para serviços externos sem consentimento explícito.
- Manter as funcionalidades existentes da versão 1.4.0.
- Validar cada área com testes automatizados e ficheiros reais de referência.

## Fase 0 — Base técnica e segurança
- [ ] Rebase/recriar a PR de segurança do instalador sobre a versão atual de `main` (1.4.0).
- [ ] Corrigir metadados de versão de `package.json` e `package-lock.json`.
- [ ] Validar permissões do instalador, geração de SHA-256, SBOM e relatório de segurança.
- [ ] Documentar claramente o estado da assinatura Authenticode; não prometer ausência de avisos SmartScreen sem certificado válido.
- [ ] Rever dependências, permissões Electron, IPC, CSP e superfícies de importação de ficheiros.
- [ ] Executar testes, build Windows x64 e testes manuais em Windows 10/11.

## Fase 1 — MyOffice Texto
- [ ] Melhorar importação/exportação DOCX sem perda de formatação.
- [ ] Implementar cabeçalhos, rodapés e numeração de páginas.
- [ ] Melhorar tabelas, imagens, listas, estilos e paginação.
- [ ] Criar testes de regressão com documentos DOCX de referência.
- [ ] Documentar as limitações que ainda não forem suportadas.

## Fase 2 — MyOffice Folhas
- [ ] Suportar várias folhas por livro.
- [ ] Expandir funções e compatibilidade de fórmulas.
- [ ] Melhorar referências entre folhas, intervalos nomeados e validação de dados.
- [ ] Tornar filtros e ordenação persistentes.
- [ ] Incorporar gráficos no documento e na exportação XLSX, quando suportado.
- [ ] Criar testes de compatibilidade XLSX e de cálculo.

## Fase 3 — MyOffice Diapositivos
- [ ] Melhorar importação/exportação PPTX.
- [ ] Adicionar transições e animações essenciais.
- [ ] Melhorar temas, alinhamento, grelhas e edição de elementos.
- [ ] Melhorar modo de apresentação e notas do apresentador.
- [ ] Criar testes de regressão com apresentações PPTX de referência.

## Fase 4 — Assistente IA local
- [ ] Permitir contextualização do documento ou folha atualmente aberta.
- [ ] Criar ações de resumo, revisão, explicação e sugestões.
- [ ] Exigir confirmação antes de aplicar alterações ao conteúdo.
- [ ] Mostrar claramente que modelo está instalado e os requisitos de hardware.
- [ ] Preservar modo sem IA e funcionamento offline.

## Fase 5 — Produto e distribuição
- [ ] Implementar atualizações seguras com verificação de integridade.
- [ ] Melhorar acessibilidade, onboarding, recuperação de erros e telemetria opcional (opt-in).
- [ ] Preparar testes com utilizadores reais e recolher feedback.
- [ ] Definir modelo Free/Pro/Business e limites funcionais.
- [ ] Decidir e documentar a licença do código antes de aceitar contribuições ou distribuir comercialmente.
- [ ] Preparar website, página de funcionalidades, política de privacidade, termos e canal de suporte.

## Critérios para publicar 1.5.0
- [ ] Todos os testes automatizados passam.
- [ ] Build Windows x64 concluída sem erros.
- [ ] Testes manuais de instalação, atualização, importação, exportação e recuperação concluídos.
- [ ] Nenhuma regressão crítica conhecida.
- [ ] Limitações e requisitos publicados de forma transparente.
- [ ] Release notes e artefactos verificados por SHA-256 publicados.

## Fora do âmbito desta versão
- Colaboração em tempo real e sincronização cloud multiutilizador.
- Compatibilidade total com Microsoft Office.
- Aplicações móveis nativas.
- Promessas de equivalência funcional com Microsoft 365 ou LibreOffice.

Este documento é um plano de trabalho, não uma declaração de funcionalidades já implementadas.
