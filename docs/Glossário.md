# Glossário

← Voltar para [[CND Automation — Documentação Técnica|Home]]

Vocabulário do domínio CND Automation. Termos linkam para a nota que os detalha.

## Domínio / negócio
- **CND** — Certidão Negativa de Débitos. Também o nome do sistema PHP (Laravel 6) que emite as certidões e consome as classes geradas.
- **Certidão regular / irregular** — resultado da emissão. Ambas têm o PDF arquivado quando disponível. Ver [[15 - Convenções das Classes Certificate]].
- **Esfera** — nível da certidão: **Federal**, **Estadual** (State) ou **Municipal** (com UF).
- **Órgão / portal** — site governamental (prefeitura, SEFAZ, TRF…) de onde a certidão é emitida.
- **`listaespera`** — coleção MongoDB do CND onde fica a fila de solicitações; o [[09 - Geração e Teste do Código PHP|pipeline_test]] insere um doc de teste lá antes de rodar `artisan issue`.
- **`Codtypecertificate`** — campo do doc de CND; preenchido manualmente pelo dev (placeholder na geração).

## Pipeline
- **Pipeline** — sequência descoberta → captura → extração → interpretação → geração → teste → commit. Ver [[03 - Pipeline — Fluxo Completo]].
- **`/auto`** — a [[05 - Skill auto — Orquestrador|skill]] que orquestra o pipeline.
- **NOVA IMPLEMENTAÇÃO** — subject `Implementar…`; cria classe do zero.
- **MANUTENÇÃO** — subject `Revisar…`; corrige classe existente.
- **`MAX_TAREFAS`** — limite de tarefas por execução agendada (5). Ver [[14 - Operação e Agendamento]].

## Captura
- **HAR** — *HTTP Archive*: JSON com todo o tráfego de rede capturado. A interface entre captura e interpretação. Ver [[08 - Extração e Interpretação de HAR]].
- **`nav_steps`** — passos de navegação que dirigem o browser; cada linha da instrução vira um step. Ver [[06 - Captura de Browser — Playwright]].
- **text actions** — `click_text` / `fill_field` / `select_text`: actions por texto/rótulo visível (preferenciais).
- **CapMonster** — extensão Chromium que resolve captcha **só** no HAR capture. Ver [[12 - Captcha — CapMonster e Solver PHP]].
- **Fallback AHK** — Chrome real + AutoHotkey + OCR como 3ª tentativa. Ver [[07 - Fallback AHK — OCR + AutoHotkey]].
- **CDP** — *Chrome DevTools Protocol*; o fallback dirige o Chrome e captura tráfego por ele.
- **OCR / Tesseract** — localiza texto na tela por imagem (modo TSV) quando não há DOM.

## Interpretação
- **FlowType** — classificação global do fluxo: `DIRETO`, `LOGIN_FORM`, `LOGIN_CERT`, `PROTOCOLO`, `CAPTCHA`, `HIBRIDO`.
- **Blocos** — tipo de cada step HTTP: `INIT`, `AUTH`, `CONSULTA`, `EMISSAO`, `POLLING`, `DOWNLOAD`, `VALIDACAO`.
- **`base_class`** — classe-base PHP detectada por URL (`CertificateBethaCND`, `CertificateGpi`, …). Ver [[09 - Geração e Teste do Código PHP]].

## Código PHP (classes Certificate)
- **`startIssuance()`** — orquestra a emissão; só chama métodos privados.
- **`issuePDF()`** — invocado pela classe-base após `startIssuance`; pode ter a request final do PDF.
- **`processIssuance()`** — atribui `situation`/`expirationDate`/`protocolNumber` (bloco VALIDACAO).
- **`fixHtml`** — nome canônico do método que monta HTML para `generatePDF` quando o site não entrega PDF.
- **`protocolNumber = "S/N"`** — valor padrão quando não há número de protocolo.

## Redmine
- **Ag. Desenv. (56)** — origem das tarefas / destino em falha.
- **Em Desenv. (57)** — em processamento.
- **Ag. Review (84)** — concluído, aguardando revisão.
- **Em Teste (59)** — status ignorado pela fila.
- **Grupo 1062** — "Desenvolvimento Web" (origem). **Grupo 875** — "Analista de Negocio Web/Imobiliario" (reatribuição em falha). Ver [[10 - Integração Redmine]].

## Infra
- **MCP** — *Model Context Protocol*; protocolo das tools expostas pelo servidor `mcp-cnd-pipeline`. Ver [[04 - Tools MCP — Referência]].
- **Docker `configs-development-app-1`** — container com PHP 7.3.33 onde o `artisan` roda. Ver [[13 - Configuração — Variáveis de Ambiente]].
- **`cnd-automation`** — a branch do repo CND onde o pipeline commita; também o nome deste repo (a ferramenta).
