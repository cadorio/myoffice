# MyOffice

**Uma suite de escritório para Windows, simples, privada e leve.**

O MyOffice reúne quatro áreas numa única aplicação: **Texto**, **Folhas**, **Diapositivos** e o **Assistente IA**, que ajuda a utilizar os programas e a criar conteúdos. Foi desenvolvido com Electron e é distribuído para computadores Windows de 64 bits, com Windows 10 versão 22H2 ou Windows 11. Os documentos são processados localmente e a aplicação foi concebida para funcionar sem ligação à Internet.

[Consultar compilações e instaladores](https://github.com/cadorio/myoffice/actions) · [Ver código-fonte](https://github.com/cadorio/myoffice) · [Reportar um problema](https://github.com/cadorio/myoffice/issues)

> **Versão 1.4.0 — MyOffice Horizon (em desenvolvimento)**  
> Esta versão introduz um espaço de trabalho renovado, modelos editáveis, gráficos em Folhas e uma aplicação independente de Assistente IA. A versão 1.4.0 está em validação na PR #11; ainda não foi publicada como versão estável nem existe instalador final desta versão.

## Capturas de ecrã

As imagens abaixo são capturas da interface real do MyOffice Horizon 1.4.0, geradas pelo workflow de pré-visualização. Clica numa imagem para a abrir em tamanho completo.

### Ecrã inicial

![Ecrã inicial do MyOffice](docs/screenshots/inicio.png)

### MyOffice Texto

![Editor de texto MyOffice](docs/screenshots/texto.png)

### MyOffice Folhas

![Folha de cálculo MyOffice](docs/screenshots/folhas.png)

### MyOffice Diapositivos

![Editor de apresentações MyOffice](docs/screenshots/diapositivos.png)

### Assistente IA independente

![Assistente IA do MyOffice](docs/screenshots/assistente-ia.png)

O Assistente IA tem uma área própria, com conversa e atalhos para obter ajuda sobre Texto, Folhas e Diapositivos.

### Modo escuro

![MyOffice em modo escuro](docs/screenshots/modo-escuro.png)

## O que inclui

| **MyOffice Texto** | **MyOffice Folhas** | **MyOffice Diapositivos** |
| --- | --- | --- |
| Criar e editar documentos, formatar texto, listas, tabelas, ligações e imagens. | Trabalhar com células, fórmulas, formatos numéricos, ordenação e copiar/colar. | Criar apresentações com temas, esquemas, texto, imagens, formas e notas do orador. |
| `.modoc` · DOCX · HTML · TXT | `.mosheet` · XLSX · CSV | `.moslides` · PPTX |

### Funcionalidades principais

- **Espaço de trabalho MyOffice Horizon** — página inicial renovada com acesso direto às ferramentas, modelos editáveis e pesquisa de ficheiros recentes.
- **Seis modelos prontos a usar** — relatório, ata de reunião, orçamento mensal com fórmulas, gestor de tarefas, apresentação de projeto e apresentação de aula.
- **Gráficos em Folhas** — pré-visualização de gráficos de colunas e linhas a partir de dados selecionados, com exportação SVG.
- **Assistente IA independente** — aplicação própria para conversar com a IA, esclarecer dúvidas sobre os três programas, pedir ajuda para escrever, criar fórmulas e estruturar apresentações. Também mantém as ações de revisão em Texto e análise em Folhas. Utiliza modelos de linguagem executados localmente no computador.
- **Filtros rápidos em Folhas** — mostrar apenas as linhas que correspondem a um texto na coluna ativa; a ordenação ascendente e descendente também está disponível.
- **Três módulos integrados** — alternar entre documentos, folhas de cálculo e apresentações.
- **Abertura de ficheiros Office** — importar DOCX, XLSX e PPTX e exportar para esses formatos.
- **Abertura direta** — abrir ficheiros DOCX e PPTX com o MyOffice através do sistema operativo; no Windows, existem também atalhos para iniciar diretamente Texto, Folhas ou Diapositivos.
- **Temas e personalização** — 13 temas partilhados, variantes de cor para apresentações e modo claro/escuro.
- **Recuperação automática** — rascunhos de documentos alterados são guardados periodicamente para permitir recuperação após uma falha.
- **Pesquisa de ficheiros recentes** — filtrar a lista de documentos usados recentemente diretamente no ecrã inicial.
- **Privacidade local** — os documentos permanecem no computador; a aplicação não depende de uma conta nem de armazenamento na nuvem.

### Análise de dados em Folhas

Para criar um gráfico, selecione uma tabela com as categorias na primeira coluna e os valores numéricos na segunda. No separador **Dados**, escolha **Gráfico** e alterne entre colunas e linhas. O gráfico pode ser exportado em SVG para ser utilizado noutros documentos.

Os filtros rápidos permitem mostrar as linhas da seleção que correspondem a um texto na coluna ativa e podem ser removidos com **Limpar filtro**. **Limitações atuais:** os gráficos são pré-visualizações exportáveis, não objetos incorporados na folha; os filtros são temporários e não ficam guardados no ficheiro.

A análise por IA é opcional, requer descarregar um dos modelos disponíveis e é executada localmente. Sem um modelo instalado, os módulos de escritório continuam a funcionar normalmente.

## Instalação

O MyOffice é distribuído oficialmente para computadores Windows de 64 bits. O requisito mínimo definido para a distribuição é o Windows 10 versão 22H2; o Windows 11 também é suportado.

| Sistema | Ficheiro | Requisito |
| --- | --- | --- |
| Windows 10 | `.exe` | Versão 22H2, 64 bits |
| Windows 11 | `.exe` | 64 bits |

**[Consultar compilações e descarregar o instalador Windows](https://github.com/cadorio/myoffice/actions)**

Abre a compilação mais recente concluída com sucesso e descarrega o artefacto `MyOffice-Windows`. O nome do instalador da versão 1.4.0 será `MyOffice-Setup-1.4.0.exe`, quando a versão for compilada e publicada. As versões estáveis serão também disponibilizadas em [Releases](https://github.com/cadorio/myoffice/releases) quando forem publicadas.

> **Aviso de assinatura:** os instaladores atuais não estão assinados digitalmente. O Windows SmartScreen pode apresentar avisos na primeira execução. A assinatura requer certificados próprios, configurados como segredos no GitHub Actions.

Depois da instalação, os formatos nativos `.modoc`, `.mosheet` e `.moslides` podem ser associados ao MyOffice. A configuração do instalador também regista DOCX e PPTX como formatos que podem ser abertos com a aplicação.

### Requisitos mínimos e desempenho

- **Sistema operativo:** Windows 10 versão 22H2 (64 bits) ou Windows 11.
- **Memória:** 4 GB de RAM como objetivo mínimo; 8 GB recomendados.
- **Processador:** dual-core como referência mínima.
- **Ligação à Internet:** não é necessária para criar e editar documentos; é necessária para descarregar modelos opcionais de IA.

Os requisitos de hardware são objetivos de compatibilidade e ainda precisam de ser confirmados através de testes em computadores físicos de diferentes idades. O desempenho da IA local depende de requisitos superiores e não faz parte dos requisitos para utilizar os módulos de escritório.

## Compatibilidade com Microsoft Office

O MyOffice importa e exporta `.docx`, `.xlsx` e `.pptx`. A conversão procura preservar o conteúdo e a formatação mais comuns, mas **não é uma substituição integral do Microsoft Office**. Alguns elementos avançados podem não ser importados ou exportados.

| Formato | Importação suportada | Limitações conhecidas |
| --- | --- | --- |
| DOCX | Títulos, parágrafos, alinhamento, formatação de caracteres, listas, tabelas, ligações, imagens e quebras de página. | Não preserva cabeçalhos/rodapés, notas, comentários e revisões, colunas, caixas de texto e células unidas. |
| XLSX | Primeira folha: valores, fórmulas, estilos básicos, alinhamento e formatos numéricos/moeda. | Uma folha por livro; limite de 100 linhas × 26 colunas; sem gráficos ou tabelas dinâmicas. Funções não suportadas podem apresentar `#NOME?`. |
| PPTX | Texto e posição das caixas, listas, imagens, retângulos, elipses, fundo e notas do orador na importação. | Não preserva animações, transições, gráficos, tabelas, SmartArt ou fundos com imagem; algumas informações de tema e notas não são exportadas. |

Os ficheiros originais não são alterados durante a importação: o documento convertido é guardado no formato próprio do MyOffice. Os ficheiros exportados foram verificados com LibreOffice e com as bibliotecas python-docx, openpyxl e python-pptx; não foram validados no Microsoft Office.

## Assistente IA local

O MyOffice 1.4.0 acrescenta uma aplicação independente chamada **Assistente IA**. A partir dela, o utilizador pode colocar perguntas, pedir instruções passo a passo sobre Texto, Folhas e Diapositivos, obter ajuda a escrever documentos, criar fórmulas e planear apresentações. O assistente não altera ficheiros automaticamente: as sugestões devem ser revistas e aplicadas pelo utilizador.

A IA também está disponível nos próprios programas: revisão e resumo em **Texto** e análise de dados selecionados em **Folhas**. As funcionalidades de IA são opcionais e utilizam os modelos locais disponíveis na aplicação.

- **Texto** — produz um resumo, identifica pontos pouco claros e sugere melhorias para o documento.
- **Folhas** — resume os dados selecionados, aponta tendências observáveis e identifica limitações da tabela.
- **Diapositivos** — gera estruturas de apresentação, títulos, tópicos, notas e sugestões de melhoria.
- **Modelos locais** — descarrega-se um modelo de linguagem aberto uma vez e executa-se no próprio computador, sem enviar o conteúdo dos documentos para um serviço externo.

Modelos disponíveis:
- **Phi-3.5 mini** (cerca de 2,4 GB, licença MIT) — opção de maior qualidade; recomendado para computadores com pelo menos 8 GB de memória.
- **Qwen2.5 1.5B** (cerca de 1,1 GB, Apache 2.0) — mais leve e rápido, com respostas geralmente menos consistentes.

A transferência do modelo requer Internet; depois de instalado, o processamento é local. O conteúdo gerado pode conter erros ou utilizar português do Brasil, pelo que deve ser revisto. O desempenho depende do hardware e da memória disponíveis.

## Aparência e produtividade

- **Identidade visual MyOffice Horizon** — espaço de trabalho com hierarquia visual própria, modelos editáveis, pesquisa de ficheiros e acesso rápido às três ferramentas.
- **Desempenho** — interface sem animações decorativas obrigatórias e com efeitos visuais reduzidos para favorecer computadores modestos.
- **Modo claro e escuro** — acompanha a preferência do sistema, com possibilidade de alteração na aplicação.
- **13 temas de documento** — Escritório, Executivo, Oceano, Floresta, Pôr do sol, Coral, Menta, Lavanda, Areia, Grafite, Noite, Técnico e Contraste.
- **Temas de apresentação** — cada tema inclui variantes Claro, Suave, Vivo e Escuro.
- **Zoom** — Texto e Folhas permitem ajustar a visualização entre 50% e 200%.
- **Fórmulas** — funções em português e inglês, com operadores matemáticos, comparação e concatenação.

## Fórmulas disponíveis

As fórmulas começam por `=`. Os argumentos podem ser separados por ponto e vírgula ou vírgula; dentro das fórmulas, o separador decimal é o ponto.

| Função | Equivalente | Exemplo |
| --- | --- | --- |
| `SOMA` | `SUM` | `=SOMA(A1:A10)` |
| `MÉDIA` | `AVERAGE` | `=MÉDIA(B2:B8)` |
| `MÍNIMO`, `MÁXIMO` | `MIN`, `MAX` | `=MÁXIMO(A1:C1)` |
| `CONTAR`, `CONTAR.VAL` | `COUNT`, `COUNTA` | `=CONTAR(A1:A10)` |
| `SE`, `SE.ERRO` | `IF`, `IFERROR` | `=SE(A1>10;"alto";"baixo")` |
| `E`, `OU`, `NÃO` | `AND`, `OR`, `NOT` | `=E(A1>0;B1>0)` |
| `ARRED`, `INT`, `ABS`, `RAIZQ`, `POTÊNCIA`, `RESTO`, `PRODUTO`, `PI` | `ROUND`, `INT`, `ABS`, `SQRT`, `POWER`, `MOD`, `PRODUCT`, `PI` | `=ARRED(A1/3;2)` |
| `CONCATENAR`, `NÚM.CARACT`, `MAIÚSCULAS`, `MINÚSCULAS`, `COMPACTAR` | `CONCAT`, `LEN`, `UPPER`, `LOWER`, `TRIM` | `=A1&" "&B1` |
| `SOMA.SE`, `CONTAR.SE` | `SUMIF`, `COUNTIF` | `=SOMA.SE(A1:A9;">10";B1:B9)` |
| `PROCV` | `VLOOKUP` | `=PROCV("pera";A1:C9;3;FALSO)` |
| `HOJE` | `TODAY` | `=HOJE()` |

Operadores suportados: `+ - * / ^ %`, `&` e comparações `= <> < > <= >=`. Use `$` para fixar referências, por exemplo `$A$1`.

## Privacidade e segurança

O MyOffice foi concebido para manter o processamento dos documentos no computador:

- A aplicação bloqueia pedidos de rede durante a utilização normal e não navega para páginas externas.
- A interface corre em sandbox, sem acesso direto ao Node.js; a comunicação com o processo principal passa por uma ponte controlada.
- Os ficheiros são lidos e escritos através de diálogos do sistema e nos formatos suportados.
- A gravação é atómica para reduzir o risco de corrupção em caso de falha.
- O conteúdo importado é validado e limpo antes de ser apresentado.
- A exportação CSV neutraliza conteúdos que poderiam ser interpretados como fórmulas por outras folhas de cálculo.

**Limitações de segurança a considerar:** os instaladores ainda não têm assinatura digital e a verificação de integridade do pacote não está ativa. A funcionalidade de IA requer descarregar os modelos, pelo que essa operação inicial necessita de Internet.

## Limitações atuais

O MyOffice ainda não oferece todas as funcionalidades das suites comerciais. Entre as funcionalidades que não estão implementadas encontram-se:

- Gráficos incorporados e guardados nas folhas de cálculo, tabelas dinâmicas e filtros persistentes.
- Várias folhas por livro.
- Cabeçalhos, rodapés e numeração de páginas.
- Revisão de alterações e comentários.
- Animações e vista do apresentador avançada.
- Coautoria em tempo real e armazenamento na nuvem.
- Correio eletrónico e calendário.

## Estado da versão Horizon

A versão **1.4.0 — MyOffice Horizon** está em desenvolvimento na [pull request #11](https://github.com/cadorio/myoffice/pull/11). Inclui o novo espaço de trabalho, seis modelos editáveis, gráficos de pré-visualização/exportação em Folhas e a aplicação independente Assistente IA. A validação automática e as capturas são acompanhadas no [GitHub Actions](https://github.com/cadorio/myoffice/actions). Esta versão ainda não foi integrada em `main`, etiquetada ou publicada como versão estável.

## Desenvolvimento

### Requisitos

- Node.js 22 ou superior.
- npm.
- Para compilar instaladores, recomenda-se executar o processo no sistema operativo de destino.

### Executar localmente

```bash
git clone https://github.com/cadorio/myoffice.git
cd myoffice
npm install
npm start
```

### Testes e compilação

```bash
npm test           # executa os testes automatizados
npm run dist       # cria o instalador para o sistema atual
npm run dist:win   # instalador Windows
```

Os artefactos locais são colocados na pasta `dist/`. O workflow **Instalador Windows** do GitHub Actions executa `npm ci` e `npm test` antes de compilar o instalador Windows de 64 bits. Cada push para `main` gera artefactos; uma tag `vX.Y.Z` publica também uma GitHub Release.

## Estrutura do projeto

```text
main.js          Processo principal Electron: janela, menus e ficheiros
preload.js       Ponte controlada entre interface e processo principal
ai.js            Integração do assistente com IA local
ai-worker.mjs    Processo de execução do modelo local
license.js       Verificação de licenças e período experimental
src/             Interface HTML, CSS e JavaScript
  js/writer.js   Módulo Texto
  js/sheets.js   Módulo Folhas
  js/slides.js   Módulo Diapositivos
  js/formula.js  Motor de fórmulas
  js/ooxml.js    Importação e exportação DOCX, XLSX e PPTX
  js/themes.js   Temas partilhados
  js/assistant.js Assistente de apresentações
build/           Recursos e configuração do instalador
test/            Testes automatizados
tools/           Ferramentas de licenciamento e avisos de terceiros
```

## Licenciamento

O repositório está marcado como `UNLICENSED` no `package.json`. Isto significa que **não deve ser assumido que o código está disponível sob uma licença open source**. Antes de reutilizar, redistribuir ou integrar o projeto noutro produto, consulta o proprietário do repositório.

O projeto inclui também componentes de terceiros. As respetivas licenças estão documentadas em [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

---

**MyOffice** — um projeto independente. Não é afiliado, patrocinado ou aprovado pela Microsoft. Microsoft Word, Excel e PowerPoint são marcas dos respetivos proprietários.
