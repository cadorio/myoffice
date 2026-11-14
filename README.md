# MyOffice

Suite de escritório para desktop, instalável em Windows, macOS e Linux. Funciona sem ligação à Internet (exceto o assistente de IA, que é opcional) e os documentos ficam no seu computador.

A interface segue o modelo habitual das suites de escritório: barra de título na cor de cada aplicação, friso com separadores (Base, Inserir, Fórmulas…) e vista **Ficheiro** para abrir, guardar e exportar.

| Módulo | O que faz | Formato próprio | Importa | Exporta |
| --- | --- | --- | --- | --- |
| **Texto** | Documentos com estilos, tipos e tamanhos de letra, cores, listas, ligações, imagens, tabelas, quebras de página e localizar/substituir | `.modoc` | `.html`, `.txt` | PDF, HTML, TXT |
| **Folhas** | Folha de cálculo (100 linhas × 26 colunas) com fórmulas, formatos de número (moeda, percentagem), ordenação, copiar/colar e anular | `.mosheet` | `.csv` | PDF, CSV |
| **Diapositivos** | Apresentações com esquemas, temas, caixas de texto, imagens, formas e notas do orador; modo de apresentação em ecrã inteiro; assistente de IA | `.moslides` | — | PDF |

## Assistente de IA (Diapositivos)

No separador **IA** dos Diapositivos:

- **Criar apresentação** — indica-se o tema, o público e o número de diapositivos; o assistente gera títulos, tópicos e notas do orador, já com o tema visual escolhido.
- **Sugestões** — propõe versões alternativas do diapositivo atual (mais concisa, mais clara, mais persuasiva); cada uma pode ser aplicada com um clique e anulada com Ctrl+Z.

O assistente usa o Claude, através da API da Anthropic, e precisa de uma chave da API (IA › Chave da API). A utilização é cobrada pela Anthropic na conta dessa chave.

- A chave fica guardada cifrada pelo sistema operativo (Windows e macOS; no Linux, quando existe um porta-chaves). Sem cifra disponível, só é mantida até fechar a aplicação. Em alternativa, pode definir a variável de ambiente `ANTHROPIC_API_KEY`.
- Só o texto dos diapositivos é enviado para a Anthropic, e apenas quando se pede uma sugestão. Tudo o resto funciona sem ligação à Internet.

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
npm test           # testes do motor de fórmulas
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
ai.js          assistente de IA (chamadas à API da Anthropic, feitas só no processo principal)
preload.js     ponte segura entre a interface e o processo principal
src/           interface (HTML, CSS e JavaScript sem dependências)
  js/formula.js  motor de fórmulas
  js/writer.js   Texto
  js/sheets.js   Folhas
  js/slides.js   Diapositivos
  js/app.js      navegação e gestão de ficheiros
build/         ícone da aplicação
test/          testes
```

A interface corre isolada (sandbox, sem acesso ao Node.js); só o processo principal toca no disco, e apenas em ficheiros escolhidos pelo utilizador nos diálogos do sistema. O conteúdo de ficheiros abertos é limpo antes de ser mostrado.
