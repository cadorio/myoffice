# MyOffice

**Uma suite de escritório para desktop, simples, privada e multiplataforma.**

O MyOffice reúne três ferramentas numa única aplicação: **Texto**, **Folhas** e **Diapositivos**. Foi desenvolvido com Electron e funciona em Windows, macOS e Linux. Os documentos são processados localmente e a aplicação foi concebida para funcionar sem ligação à Internet.

[Descarregar versões](https://github.com/cadorio/myoffice/actions) · [Ver código-fonte](https://github.com/cadorio/myoffice) · [Reportar um problema](https://github.com/cadorio/myoffice/issues)

> **Versão atual do código: 1.2.0**  
> Os três instaladores desta versão foram compilados com sucesso e os testes automatizados passaram. Ainda falta validação manual em computadores reais com Windows, macOS e Linux. Os instaladores desta execução estão disponíveis em [GitHub Actions — Instaladores](https://github.com/cadorio/myoffice/actions/runs/43866280716).

## Capturas de ecrã

As imagens seguintes são capturas reais da aplicação MyOffice.

| Ecrã inicial | MyOffice Texto |
| --- | --- |
| ![Ecrã inicial do MyOffice](docs/screenshots/inicio.png) | ![Editor MyOffice Texto](docs/screenshots/texto.png) |

| MyOffice Folhas | MyOffice Diapositivos |
| --- | --- |
| ![Folha de cálculo MyOffice](docs/screenshots/folhas.png) | ![Editor de apresentações MyOffice](docs/screenshots/diapositivos.png) |

| Assistente de apresentações | Modo escuro |
| --- | --- |
| ![Assistente dos Diapositivos](docs/screenshots/assistente.png) | ![MyOffice em modo escuro](docs/screenshots/modo-escuro.png) |

## O que inclui

| **MyOffice Texto** | **MyOffice Folhas** | **MyOffice Diapositivos** |
| --- | --- | --- |
| Criar e editar documentos, formatar texto, listas, tabelas, ligações e imagens. | Trabalhar com células, fórmulas, formatos numéricos, ordenação e copiar/colar. | Criar apresentações com temas, esquemas, texto, imagens, formas e notas do orador. |
| `.modoc` · DOCX · HTML · TXT | `.mosheet` · XLSX · CSV | `.moslides` · PPTX |

### Funcionalidades principais

- **Três módulos integrados** — alternar entre documentos, folhas de cálculo e apresentações.
- **Abertura de ficheiros Office** — importar DOCX, XLSX e PPTX e exportar para esses formatos.
- **Abertura direta** — abrir ficheiros DOCX e PPTX com o MyOffice através do sistema operativo; no Windows, existem também atalhos para iniciar diretamente Texto, Folhas ou Diapositivos.
- **Temas e personalização** — 13 temas partilhados, variantes de cor para apresentações e modo claro/escuro.
- **Recuperação automática** — rascunhos de documentos alterados são guardados periodicamente para permitir recuperação após uma falha.
- **Privacidade local** — os documentos permanecem no computador; a aplicação não depende de uma conta nem de armazenamento na nuvem.

## Instalação

O MyOffice gera pacotes para os três principais sistemas operativos:

| Sistema | Ficheiro | Observações |
| --- | --- | --- |
| Windows | `.exe` | Instalador NSIS de 64 bits, com atalhos no Ambiente de Trabalho e Menu Iniciar. |
| macOS | `.dmg` | Imagem de disco para instalação. |
| Linux | `.AppImage` e `.deb` | AppImage portátil ou pacote Debian/Ubuntu. |

**[Abrir a execução de compilação 1.2.0 e descarregar os três artefactos](https://github.com/cadorio/myoffice/actions/runs/43866280716)**

Na secção **Artifacts**, descarrega o pacote correspondente ao teu sistema: `MyOffice-Windows`, `MyOffice-macOS` ou `MyOffice-Linux`. Cada artefacto é um ZIP que contém o instalador.

As próximas versões publicadas estarão disponíveis em [Releases](https://github.com/cadorio/myoffice/releases). O workflow cria uma Release automaticamente quando é publicada uma tag `vX.Y.Z` correspondente à versão indicada no `package.json`.

> **Aviso de assinatura:** os instaladores atuais não estão assinados digitalmente. O Windows SmartScreen e o macOS Gatekeeper podem apresentar avisos na primeira execução. A assinatura requer certificados próprios, configurados como segredos no GitHub Actions.

Depois da instalação, os formatos nativos `.modoc`, `.mosheet` e `.moslides` podem ser associados ao MyOffice. A configuração do instalador também regista DOCX e PPTX como formatos que podem ser abertos com a aplicação.

## Compatibilidade com Microsoft Office

O MyOffice importa e exporta `.docx`, `.xlsx` e `.pptx`. A conversão procura preservar o conteúdo e a formatação mais comuns, mas **não é uma substituição integral do Microsoft Office**. Alguns elementos avançados podem não ser importados ou exportados.

| Formato | Importação suportada | Limitações conhecidas |
| --- | --- | --- |
| DOCX | Títulos, parágrafos, alinhamento, formatação de caracteres, listas, tabelas, ligações, imagens e quebras de página. | Não preserva cabeçalhos/rodapés, notas, comentários e revisões, colunas, caixas de texto e células unidas. |
| XLSX | Primeira folha: valores, fórmulas, estilos básicos, alinhamento e formatos numéricos/moeda. | Uma folha por livro; limite de 100 linhas × 26 colunas; sem gráficos ou tabelas dinâmicas. Funções não suportadas podem apresentar `#NOME?`. |
| PPTX | Texto e posição das caixas, listas, imagens, retângulos, elipses, fundo e notas do orador na importação. | Não preserva animações, transições, gráficos, tabelas, SmartArt ou fundos com imagem; algumas informações de tema e notas não são exportadas. |

Os ficheiros originais não são alterados durante a importação: o documento convertido é guardado no formato próprio do MyOffice. Os ficheiros exportados foram verificados com LibreOffice e com as bibliotecas python-docx, openpyxl e python-pptx; não foram validados no Microsoft Office.

## Assistente de apresentações e IA local

O módulo Diapositivos inclui um assistente para estruturar apresentações e sugerir melhorias.

- **Criar apresentação** — gera títulos, tópicos e notas a partir de um tema.
- **Sugestões** — apresenta recomendações de escrita e versões alternativas de um diapositivo.
- **Modelos locais** — é possível descarregar um modelo de linguagem aberto uma vez e executá-lo no próprio computador, sem enviar o texto dos documentos para um serviço externo.

Modelos disponíveis:
- **Phi-3.5 mini** (cerca de 2,4 GB, licença MIT) — opção de maior qualidade; recomendado para computadores com pelo menos 8 GB de memória.
- **Qwen2.5 1.5B** (cerca de 1,1 GB, Apache 2.0) — mais leve e rápido, com respostas geralmente menos consistentes.

A transferência do modelo requer Internet; depois de instalado, o processamento é local. O conteúdo gerado pode conter erros ou utilizar português do Brasil, pelo que deve ser revisto. O desempenho depende do hardware e da memória disponíveis.

## Aparência e produtividade

- **Identidade visual Aurora** — interface renovada com tons índigo, verde-turquesa e neutros quentes.
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

- Gráficos e tabelas dinâmicas nas folhas de cálculo.
- Várias folhas por livro.
- Cabeçalhos, rodapés e numeração de páginas.
- Revisão de alterações e comentários.
- Animações e vista do apresentador avançada.
- Coautoria em tempo real e armazenamento na nuvem.
- Correio eletrónico e calendário.

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
npm run dist:mac   # instalador macOS
npm run dist:linux # pacotes Linux
```

Os artefactos locais são colocados na pasta `dist/`. O workflow **Instaladores** do GitHub Actions executa `npm ci` e `npm test` antes de compilar os pacotes para Windows, macOS e Linux. Cada push para `main` gera artefactos; uma tag `vX.Y.Z` publica também uma GitHub Release.

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
