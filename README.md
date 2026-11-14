# MyOffice

Suite de escritório para desktop, instalável em Windows, macOS e Linux. Funciona sem ligação à Internet e os documentos ficam apenas no seu computador.

A interface segue o modelo habitual das suites de escritório: barra de título na cor de cada aplicação, friso com separadores (Base, Inserir, Fórmulas…) e vista **Ficheiro** para abrir, guardar e exportar.

| Módulo | O que faz | Formato próprio | Importa | Exporta |
| --- | --- | --- | --- | --- |
| **Texto** | Documentos com estilos, tipos e tamanhos de letra, cores, listas, ligações, imagens, tabelas, quebras de página e localizar/substituir | `.modoc` | `.html`, `.txt` | PDF, HTML, TXT |
| **Folhas** | Folha de cálculo (100 linhas × 26 colunas) com fórmulas, formatos de número (moeda, percentagem), ordenação, copiar/colar e anular | `.mosheet` | `.csv` | PDF, CSV |
| **Diapositivos** | Apresentações com esquemas, temas, caixas de texto, imagens, formas e notas do orador; modo de apresentação em ecrã inteiro; assistente de sugestões | `.moslides` | — | PDF |

## Assistente (Diapositivos)

No separador **Assistente** dos Diapositivos há um motor de sugestões próprio, incluído na aplicação. Funciona sem ligação à Internet, sem chave e sem custos, e nenhum texto sai do computador.

- **Criar apresentação** — indica-se o tema, o público e o número de diapositivos. O assistente reconhece o tipo de apresentação (plano, relatório, formação, produto ou geral) e cria a estrutura adequada, com os tópicos a preencher e conselhos nas notas do orador.
- **Sugestões** — analisa o diapositivo atual e mostra dicas (texto a mais, tópicos longos, falta de números ou de notas) e versões alternativas que se aplicam com um clique e se anulam com Ctrl+Z:
  - *Mais conciso*: fica a ideia principal de cada frase, sem expressões de enchimento; o texto original passa para as notas do orador.
  - *Uma ideia por tópico*: separa frases com várias ideias.
  - *Números primeiro*: sobe os tópicos com dados concretos.

O assistente segue regras de escrita para apresentações em português; não é um modelo de linguagem, por isso não escreve conteúdo novo sobre o tema nem conhece factos. O código está em `src/js/assistant.js`.

## Temas predefinidos

Os três módulos partilham o mesmo conjunto de 13 temas: Escritório, Executivo, Oceano, Floresta, Pôr do sol, Coral, Menta, Lavanda, Areia, Grafite, Noite, Técnico e Contraste. Cada tema define:

- uma **paleta**: cor escura, cor clara e seis cores de destaque, que aparecem como amostras nos seletores de cor;
- um **par de tipos de letra**, um para os títulos e outro para o texto;
- um **elemento gráfico** para os diapositivos (linha, barra, faixa, lateral, arco, canto ou moldura), com uma versão própria para o diapositivo de título.

Onde se aplicam:

- **Diapositivos** — Estrutura › Temas, mais quatro **variantes** de cor de cada tema (Claro, Suave, Vivo e Escuro). Aplicam-se a toda a apresentação. As cores de texto de todas as combinações cumprem o contraste mínimo de 4,5:1.
- **Texto** — Estrutura › Temas do documento: tipos de letra do texto e dos títulos e cor dos títulos, também no PDF e no HTML exportados.
- **Folhas** — Esquema de página › Temas: tipo de letra da grelha e estilos de «Formatar como tabela» (um por cor de destaque).

Os temas, nomes e desenhos são próprios do MyOffice; os tipos de letra são os que já existem em cada sistema operativo. O código está em `src/js/themes.js`.

## Segurança

- **Sem rede** — a aplicação bloqueia todos os pedidos de rede e a leitura de ficheiros fora da sua própria pasta; não abre janelas nem navega para outras páginas.
- **Interface isolada** — a página corre em sandbox, sem acesso ao Node.js, com uma política de conteúdo (CSP) que impede a execução de scripts que não sejam os da aplicação. Só a página principal pode falar com o processo que acede ao disco.
- **Ficheiros** — só são lidos e escritos ficheiros escolhidos pelo utilizador nos diálogos do sistema, e só nos formatos suportados. A gravação é atómica: uma falha a meio não corrompe o documento.
- **Documentos abertos** — o conteúdo é limpo antes de ser mostrado: scripts, objetos incorporados, ligações `javascript:`, imagens remotas e estilos capazes de se sobrepor à interface são removidos; os campos dos ficheiros são validados um a um.
- **CSV** — ao exportar, o texto começado por `=`, `+`, `-` ou `@` é neutralizado, para não ser executado como fórmula noutras folhas de cálculo.
- **Aplicação instalada** — não inclui ferramentas de programador e não pode ser usada para executar código Node arbitrário (`ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` e `--inspect` estão desativados).
- **Compilação** — as ações do GitHub Actions estão fixadas por hash de commit.

Por fazer: os instaladores não são assinados digitalmente (ver acima) e a verificação de integridade do pacote da aplicação não está ativa.

## O que ainda não existe

O MyOffice cobre o trabalho do dia a dia, mas não tem todas as funções do Microsoft 365. Em particular, ainda não tem: abrir e gravar ficheiros `.docx`, `.xlsx` e `.pptx`; gráficos e tabelas dinâmicas; várias folhas por livro; cabeçalhos, rodapés e numeração de páginas; revisão de alterações e comentários; animações e vista do apresentador; coautoria em tempo real e armazenamento na nuvem; correio e calendário.

## Instalar

Os instaladores são gerados pelo GitHub Actions (workflow **Instaladores**):

- **Windows** — `MyOffice-Setup-<versão>.exe` (assistente de instalação, com atalhos no ambiente de trabalho e no menu Iniciar)
- **macOS** — `MyOffice-<versão>-mac-<arquitetura>.dmg`
- **Linux** — `.AppImage` (portátil) e `.deb` (Debian/Ubuntu)

Para publicar uma versão, crie uma tag `vX.Y.Z` (igual à `version` do `package.json`): o workflow cria uma Release com os instaladores anexados. Em cada push para `main`, os instaladores ficam disponíveis como artefactos da execução.

> Os instaladores não são assinados digitalmente. O Windows (SmartScreen) e o macOS (Gatekeeper) mostram um aviso na primeira execução; para o evitar é preciso um certificado de assinatura de código.

Depois de instalado, os ficheiros `.modoc`, `.mosheet` e `.moslides` abrem no MyOffice com duplo clique.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm start          # abre a aplicação
npm test           # testes do motor de fórmulas e do assistente
npm run dist       # cria o instalador para o sistema atual (pasta dist/)
```

`npm run dist:win`, `dist:mac` e `dist:linux` criam o instalador de um sistema específico; cada um deve ser executado no respetivo sistema operativo.

## Fórmulas

As fórmulas começam por `=` e aceitam nomes em português ou inglês. Os argumentos separam-se com `;` ou `,` e, dentro das fórmulas, o separador decimal é o ponto (`=A1*1.5`). Nas células pode escrever números com vírgula (`1,5`).

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

Operadores: `+ - * / ^ %`, `&` (juntar texto) e comparações `= <> < > <= >=`. Use `$` para fixar referências ao copiar (`$A$1`). Copiar uma célula e colar numa seleção maior preenche toda a seleção, ajustando as referências.

## Estrutura

```
main.js        processo principal do Electron: janela, menus, leitura e escrita de ficheiros
preload.js     ponte segura entre a interface e o processo principal
src/           interface (HTML, CSS e JavaScript sem dependências)
  js/themes.js   temas partilhados (paletas, tipos de letra, variantes)
  js/formula.js  motor de fórmulas
  js/writer.js   Texto
  js/sheets.js   Folhas
  js/slides.js   Diapositivos
  js/assistant.js  assistente dos Diapositivos (motor de sugestões)
  js/app.js      navegação e gestão de ficheiros
build/         ícone da aplicação
test/          testes
```

