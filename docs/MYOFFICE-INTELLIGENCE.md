# MyOffice Intelligence — arquitetura e plano de desenvolvimento

## Objetivo

Desenvolver uma inteligência própria do MyOffice, mantida pelo projeto e integrada nos módulos Texto, Folhas e Diapositivos. Não depender de descarregamentos obrigatórios de modelos de terceiros, nem enviar documentos do utilizador para serviços externos sem uma decisão explícita e transparente.

## Estado nesta versão de desenvolvimento

- O antigo runtime baseado em Phi-3.5/Qwen2.5 e o respetivo descarregamento foram removidos da aplicação.
- A API IPC de gestão de modelos foi retirada do processo principal e do preload.
- A criação de apresentações e as sugestões de escrita continuam disponíveis através do motor determinístico existente. A interface identifica o resultado como estrutura inicial, não como texto gerado por um modelo generativo.
- A análise visual de diapositivos já considera fotografias, sobreposições, margens e dimensões, sem alterar imagens automaticamente.
- Ainda não existe um modelo generativo próprio. Não anunciar a IA como concluída nesta fase.

## Princípios de arquitetura

1. **Motor independente:** código, dados de avaliação, regras, prompts internos e versões sob controlo do MyOffice.
2. **Privacidade por defeito:** documentos processados localmente. Qualquer opção futura de processamento remoto terá de ser explícita, desativável e documentada.
3. **Sem alterações silenciosas:** a IA propõe; o utilizador revê e confirma antes de aplicar alterações.
4. **Contexto controlado:** cada módulo fornece apenas o conteúdo selecionado ou aberto que o utilizador autorizar.
5. **Respostas estruturadas:** operações tipadas e validadas antes de chegar à interface.
6. **Degradação segura:** se o motor não estiver disponível ou falhar, edição, gravação e exportação continuam a funcionar.

## Componentes a desenvolver

- **AI Core:** ciclo de pedido, contexto, cancelamento, limites e gestão de erros.
- **Document Adapters:** conversores seguros de Texto, Folhas e Diapositivos para contexto estruturado.
- **Task Engine:** tarefas específicas, como resumir, explicar, rever, sugerir fórmulas, analisar dados e melhorar diapositivos.
- **Suggestion Validator:** validação de esquema, limites, referências e operações permitidas.
- **Evaluation Suite:** casos de teste em português europeu, qualidade factual, regressões e desempenho.
- **UI Approval Layer:** comparação entre original e proposta, aplicação seletiva, desfazer e histórico.

## Fases propostas

1. **Fundação:** contratos internos, contexto dos documentos, validação de pedidos e testes sem dependência de modelos externos.
2. **Assistente de documentos:** resumo, explicação e revisão de texto, com citações a secções/trechos do próprio documento.
3. **Folhas inteligentes:** explicação de fórmulas, sugestões de fórmulas, deteção de anomalias e interpretação de tabelas.
4. **Diapositivos inteligentes:** análise de texto e composição, incluindo fotografias, gráficos e legibilidade; propostas sempre reversíveis.
5. **Motor generativo próprio:** escolher e implementar a estratégia técnica depois de benchmarks, requisitos de hardware, qualidade em PT-PT e avaliação de licenças. Não fixar agora um modelo externo como dependência.
6. **Qualidade e distribuição:** testes com documentos reais anonimizados, desempenho em máquinas modestas, segurança, documentação e beta fechada.

## Critérios para considerar a IA pronta

- Não exige que o utilizador descarregue manualmente um modelo.
- Não altera documentos sem aprovação explícita.
- Não inventa dados ou valores e distingue factos do conteúdo de inferências.
- Tem testes automatizados para os três módulos e para erros/cancelamento.
- Tem medições de desempenho e memória em hardware mínimo definido.
- Tem documentação clara sobre privacidade, limitações e funcionalidades disponíveis.
