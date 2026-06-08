---
description: Executa o pipeline CND de forma totalmente autônoma — busca tarefas no Redmine, processa cada uma pelo pipeline completo e commita. Agendado via Task Scheduler do Windows (ver scripts/install-scheduled-task.ps1) para rodar todos os dias às 7h.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, WebFetch, mcp__cnd-pipeline__*
---

## Pipeline CND — Modo Autônomo

Você está operando em modo autônomo. Execute cada passo na ordem abaixo, sem pedir confirmação.

---

### Configuração

- **`MAX_TAREFAS = 5`** — limite de tarefas processadas por execução agendada. Para alterar, edite só este valor.
- Contador persistido em `c:\Workspace\cnd-automation\.claude\auto_count` (texto puro, um inteiro).
- O contador **incrementa apenas em sucesso (PASSO 13)** ou **falha registrada no Redmine (PASSO 11)**. Encerramentos por pausa/fila vazia/erro de ambiente não contam.
- Para resetar o ciclo: `Remove-Item c:\Workspace\cnd-automation\.claude\auto_count`.

---

### PASSO 0 — Pré-requisito de ambiente (não pular)

O projeto `C:\Workspace\cnd` é Laravel 6 e **só roda em PHP 7.4**. PHP 8+ no host faz o artisan crashar no boot (incompatibilidade `ArrayAccess`/`ReflectionParameter`). Por isso o `pipeline_test` **DEVE** executar dentro do container Docker `configs-development-app-1` (que tem PHP 7.3.33 e o diretório `C:\Workspace\cnd\app` montado em `/var/www/html/app`).

Como garantir antes de qualquer `pipeline_test`:

1. Confira que `DOCKER_CONTAINER=configs-development-app-1` e `DOCKER_WORKING_DIR=/var/www/html` estão definidos — o servidor MCP lê primeiro do `.env` do projeto e, em alternativa, do bloco `env` em `.claude/settings.json` do usuário.
2. Confira que o container está de pé: `docker ps --filter name=configs-development-app-1 --format "{{.Names}}"`.
3. Se o `artisan_output` voltar com paths do host (`C:\...\vendor\...` ou `/usr/local/...`) ou erros de `ArrayAccess`/`ReflectionParameter::getClass`, é sinal de que o MCP server está usando o PHP do host — **peça ao usuário para reiniciar o MCP `cnd-pipeline`** (env só é lida no spawn do processo) e só então retome. Não tente "consertar" o helpers.php nem propor downgrade do PHP do host, esses caminhos já foram descartados.

---

### PASSO 1 — Verificar pausa e limite

Verifique se o arquivo `c:\Workspace\cnd-automation\STOP` existe:
```powershell
Test-Path c:\Workspace\cnd-automation\STOP
```
- **True** → exiba "⏸ Pipeline pausado. Delete o arquivo STOP para retomar." e **encerre o ciclo**.
- **False** → continue.

Verifique o contador de tarefas processadas contra `MAX_TAREFAS` (ver Configuração):
```powershell
$count = if (Test-Path c:\Workspace\cnd-automation\.claude\auto_count) { [int](Get-Content c:\Workspace\cnd-automation\.claude\auto_count) } else { 0 }
$count
```
- Se `count >= MAX_TAREFAS` → exiba "🏁 Limite de {MAX_TAREFAS} tarefas atingido. Delete `.claude/auto_count` para reiniciar." e **encerre o ciclo**.
- Caso contrário, continue.

---

### PASSO 2 — Buscar próxima tarefa

Chame `redmine_next_task`.

- `task: null` → "📭 Fila vazia." e **encerre o ciclo**.
- `auto_refreshed: true` → informe quantas tarefas foram carregadas.
- Tarefa retornada → anote `id`, `subject`, `description` e o **`inicio`** (timestamp ISO atual, ex.: gerado via `Get-Date -Format "o"` em PowerShell ou `new Date().toISOString()`). Esse `inicio` é usado na notificação do Google Chat nos PASSOS 11/12.

---

### PASSO 3 — Detectar tipo de operação

Leia o início do `subject`:

| Subject começa com | Operação |
|--------------------|----------|
| `Implementar`      | **NOVA IMPLEMENTAÇÃO** — classe inexistente, criar do zero |
| `Revisar`          | **MANUTENÇÃO** — classe existente, corrigir problema |

Extraia também:
- **`type`**: subject contém "Federal" → `Federal`; "Estadual" → `State`; "Municipal" → `Municipal`
- **`state`**: sigla UF no subject (ex: "de Cajati - SP" → `SP`). Obrigatório para State e Municipal.
- **`url`**: campo `URL:` ou `URL Site:` na description
- **`cnpj`**: campo `CNPJ:` na description
- **`inputs_adicionais`**: seção `Campos Adicionais Para a Certidão` ou `Dados para Emissão`
- **`instrucoes`**: seção `Instrução Emissão No site`
- **`expectativas`**: seção `Expectativas`

---

### PASSO 3A — NOVA IMPLEMENTAÇÃO: definir class_name

Gere o `class_name` em PascalCase a partir da cidade/órgão no subject:
- "Implementar Captura Certidão Municipal de Cajati - SP" → `CertificateCajati`
- "Implementar Captura Certidão Federal - Receita Federal" → `CertificateReceitaFederal`
- "Implementar Captura Certidão Estadual de Minas Gerais - SEFAZ" → `CertificateSefazMG`

Remova acentos, espaços e caracteres especiais. Prefixo sempre `Certificate`.

---

### PASSO 3B — MANUTENÇÃO: extrair class_name e ler código existente

Extraia o `class_name` do campo `Certidão:` na description:
- `Certidão: CertificateIguaracu` → `class_name = "CertificateIguaracu"`

Localize e leia o arquivo PHP existente no projeto CND:
```powershell
Get-ChildItem -Path C:\Workspace\cnd -Recurse -Filter "{class_name}.php" | Select-Object -ExpandProperty FullName
```

Leia o arquivo com a ferramenta Read. Esse código será a base para as correções.

---

### PASSO 4 — Consultar knowledge base

Antes de iniciar qualquer análise, verifique se existe conhecimento acumulado sobre esta certidão ou sua base.

> O formato desses arquivos é definido no **PASSO 12 (Atualizar knowledge base)**, que é quem os grava ao final da tarefa — leia aqui no mesmo padrão que será gravado lá.

#### 4.1 — Verificar arquivo específico da certidão

```powershell
$path = "C:\Workspace\cnd\.claude\patterns\{federal|state}\{class_name}.md"
if (Test-Path $path) { Get-Content $path }
```

Se existir: leia e anote fluxo, parâmetros críticos e armadilhas. Isso guiará a implementação/correção.

#### 4.2 — Verificar base (somente MANUTENÇÃO)

Para tarefas de manutenção, você já sabe qual base a classe estende (lida no PASSO 3B). Verifique:

```powershell
$path = "C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md"
if (Test-Path $path) { Get-Content $path }
```

Se existir: leia e anote armadilhas e padrões conhecidos da base.

> Se nenhum arquivo existir, continue normalmente — a knowledge base será criada ao final desta tarefa.

---

### PASSO 5 — Discovery

Chame `pipeline_discover` com `task_id` e `task_description` (description completa da tarefa).

Salve: `url`, `inputs`, `expected_flow`, `complexity`.

---

### PASSO 6 — Captura do browser

O objetivo é capturar o tráfego HTTP do portal para que o código PHP possa replicar as requisições. O browser é apenas o meio para navegar e disparar esse tráfego.

**Vale para os dois tipos de operação.** Em **MANUTENÇÃO**, a captura é obrigatória e vem **antes** de qualquer `pipeline_test` — mesmo já existindo código PHP. O HAR fresco é o *ground truth* pra responder a pergunta central da manutenção: **o site mudou ou não?** Você compara request-a-request o que a classe atual manda vs. o que o portal espera hoje (PASSO 9B). Não existe atalho "a classe existe → pula pro teste": sem o HAR fresco você estaria adivinhando pelo stack trace do artisan em vez de diagnosticar pelo tráfego real. O `pipeline_test` valida a correção depois do diff, não substitui o diff.

Monte `nav_steps` seguindo as `instrucoes` da tarefa: cada linha da seção "Instrução Emissão No site" vira **1 step**, na mesma ordem. O número de steps acompanha o número de linhas — pode ser 2 ou 12, sem limite.

**Estratégia:** prefira sempre as actions baseadas em **texto visível** (`click_text`, `fill_field`, `select_text`). Os textos entre aspas na instrução (ex.: `Clicar em "buscar"`, `Digitar o CNPJ "..."`, `Natureza "Mobiliário (Empresas)"`) são exatamente o que essas actions esperam. Só caia em seletor CSS (`click`/`fill`/`select`) quando não houver texto distintivo, ou em `frame_*` para iframes.

**Actions baseadas em texto (preferenciais):**
- `click_text` (`text`) — clica em botão/link/input pelo texto visível. Ex.: linha "Clicar em 'buscar'" → `{action:"click_text", text:"buscar"}`
- `fill_field` (`label`, `value`) — preenche input pelo rótulo visível. Ex.: "Digitar o CNPJ '46.201...'" → `{action:"fill_field", label:"CNPJ", value:"46201083002474"}`
- `select_text` (`label`, `value`) — seleciona option pelo texto. Ex.: "Natureza 'Mobiliário (Empresas)'" → `{action:"select_text", label:"Natureza", value:"Mobiliário (Empresas)"}`

**Actions baseadas em seletor (fallback):**
- `goto` (`url`) — navega na aba alvo
- `fill` (`selector`, `value`) — limpa o campo e digita
- `click` (`selector`) — clica
- `select` (`selector`, `value`) — seleciona option pelo value
- `wait` (`ms`) — espera fixa
- `frame_fill` / `frame_click` (`selector`, `frame_url`) — atua dentro de um iframe localizado por substring de URL (ex.: `frame_url: "/iframe/municipal"`, ou `frame_url: "recaptcha/api2/anchor"`). Usado em portais Betha clássico, Fiorilli antigo e similares.

**Múltiplas abas/popups:** quando o portal abre uma nova aba via `window.open` ou `target="_blank"` (ex.: RJ SINCAD, alguns municipais que abrem o PDF em popup), use `page_index` no step: `0` (default) é a aba principal, `1` é o primeiro popup detectado, `2` o segundo, e assim por diante. As requisições de todas as abas caem no mesmo HAR.

**Output relevante:**
- `har_path` — sempre presente, mesmo em falha (steps que rodaram já estão capturados)
- `pdf_path` — **só vem preenchido quando o portal entregou um PDF de verdade no fluxo** (magic bytes `%PDF-` validados; fontes/binários servidos como `octet-stream` não passam). Como o PDF da certidão sai depois do último step, presença de `pdf_path` ≈ "fluxo completou com sucesso". Ausência mesmo com `failed_step` no final = a certidão não foi emitida ainda, o último click não chegou no PDF.
- `popup_pages` — número de popups detectados (use isso para confirmar que `page_index` foi necessário)
- `failed_step` — índice do step que falhou (auto-retry interno já tentou 2x antes de marcar como falha)
- `failure_reason` — mensagem do erro do Playwright
- `diagnostics` — snapshot textual da página no momento da falha:
  - `current_url`, `page_title` — detecta redirect inesperado (login, manutenção, captcha bloqueando)
  - `visible_elements` — lista de botões/links/inputs/selects visíveis com `text`, `label`, `name`, `id`. Compare com o texto da instrução para descobrir o nome real do elemento.
  - `dom_snippet` — body HTML truncado em 8KB para inspeção pontual

Chame `pipeline_browser_capture` com `nav_steps` preenchido — essa é a **1ª tentativa (Playwright)**.

Se vier `failed_step`, a **2ª tentativa** depende da composição dos `nav_steps`:

- **Todos os steps são texto puro** (`goto`, `wait`, `click_text`, `fill_field`, `select_text`) → **2ª tentativa = AHK** (`pipeline_browser_capture_ahk`, ver abaixo). **Não repita em Playwright** — vá direto pro AHK. O input OS-level é estritamente mais real e o profile compartilhado pode ter acumulado cookies/sessão que destrancam o portal.
- **Algum step usa `selector`, `fill`, `click`, `select`, `frame_fill` ou `frame_click`** → o AHK rejeita (não há DOM pra inspecionar). **2ª tentativa = Playwright ajustada**: use `diagnostics.visible_elements` pra achar o texto/label/selector real e ajuste **só o step que falhou** (não refaça o `nav_steps` inteiro). Se ainda assim falhar, vá pra "Quando aproveitar o HAR parcial".

Pegue o HAR de qualquer das duas tentativas que tiver funcionado. **Limite total: 2 tentativas** (Playwright + AHK, ou Playwright + Playwright ajustada).

#### Fallback AHK: `pipeline_browser_capture_ahk`

> Regra canônica em CLAUDE.md › "Fallback AHK — `pipeline_browser_capture_ahk`" — manter os dois em sincronia ao alterar.

**Sinais que confirmam que o AHK é a saída certa** (use pra ajustar a chamada, não pra decidir SE chama):

- `diagnostics.page_title` contém `"Um momento"`, `"Just a moment"`, `"Verifying"` → Cloudflare challenge interativo
- `dom_snippet` mostra `<script>` apontando pra `cdn-cgi/challenge-platform` → Cloudflare
- `visible_elements` quase vazio + DOM trivial (ex.: só `<flt-*>` tags, `main.dart.js`, canvas) → Flutter Web renderizado em canvas, sem DOM acessível
- Falha logo no primeiro `fill_field`/`click_text` com "No input/element found" mesmo após `wait` longo

A tool `pipeline_browser_capture_ahk` sobe um Chrome real, dirige por OCR + AutoHotkey (input OS-level, indistinguível de humano) e grava o HAR via CDP. Mesma assinatura (`task_id`, `url`, `inputs`, `expected_flow`, `nav_steps`), porém:

- Cada step que usa OCR é ~500ms mais lento que Playwright (screenshot + tesseract).
- A janela do Chrome precisa ficar **em foreground durante toda a execução** — não use o PC enquanto roda.
- **Passe o `diagnostics`** do Playwright no parâmetro `playwright_diagnostics` da chamada. Quando os campos `page_title`/`dom_snippet` mostrarem sinais de Cloudflare, a tool estende automaticamente a espera por challenge de 15s pra 45s antes do primeiro clique — você não precisa adicionar um `wait` manual gigante no `nav_steps`. Profile (`browser-profile/`) é compartilhado com o Playwright, então cookies `cf_clearance` capturados na tentativa anterior já viajam pro Chrome do AHK automaticamente.

Se o fallback AHK também falhar (`failed_step` retornado), aí sim siga pra "Quando aproveitar o HAR parcial" ou registre falha no PASSO 11.

#### Quando aproveitar o HAR parcial

Se ambas as tentativas falharem (HAR incompleto), não desista — o HAR parcial pode ter valor real (cookies, CSRF, headers e payloads autênticos dos passos que rodaram). Em **nenhum** caso a manutenção pula a extração/interpretação/diff: sempre passe pelo HAR (completo ou parcial) antes do `pipeline_test`.

- **NOVA IMPLEMENTAÇÃO** — sempre que houver pelo menos 1 passo capturado. Use os requests capturados como verdade absoluta pros primeiros N passos (URL, headers, payload, hidden fields), e só caia em template/classe-irmã pra montar o restante do fluxo. Chame `pipeline_extract_har` + `pipeline_interpret_flow` no HAR parcial e siga o PASSO 9A normalmente — a base_class/template preenche o tail, mas o início é real. O `pdf_path` no output é um sinal de **confiança** sobre o quão completo está o HAR (com PDF = HAR provavelmente cobriu tudo; sem PDF = tail vai depender mais do template), mas não decide nada sozinho — a falha real só é constatada no `pipeline_test` (PASSO 10).

- **MANUTENÇÃO** — **sempre** extraia e interprete o HAR que tiver (PASSOS 7 e 8) e faça o diff do PASSO 9B contra o código existente, mesmo com HAR parcial. Onde o HAR cobre, o diff é a verdade: se achar divergência nos passos cobertos (endpoint renomeado, parâmetro novo, header faltando), corrija direto no código. Onde o HAR não cobre (steps após o `failed_step`), o diff fica cego naquele trecho — mas isso **não** é motivo pra pular o teste nem pra pular o diff: aplique as correções que o trecho coberto revelou e deixe o `pipeline_test` (PASSO 10) validar o resto, lendo o `artisan_output` pra localizar a divergência no trecho não coberto. O HAR parcial reduz o escopo do que o teste precisa descobrir; ele nunca substitui a captura nem o diff.

Em qualquer caso, se o `pipeline_test` falhar 3x sem dar pra corrigir, vá pro PASSO 11 (falha) usando `failure_reason` + `diagnostics.current_url`/`page_title` pra compor a mensagem.

---

### PASSO 7 — Extração do HAR

Chame `pipeline_extract_har` com o `har_path` retornado no passo anterior.

Salve o array `flow`.

---

### PASSO 8 — Interpretação do fluxo

Chame `pipeline_interpret_flow` com o `flow` extraído.

Salve `flow_type` e `steps`.

---

### PASSO 9A — NOVA IMPLEMENTAÇÃO: gerar classe PHP

Chame `pipeline_generate_code` com `interpretation`, `task_description`, `class_name`, `type` e `state`.

Com base no resultado (exemplos, base_class, blocks_memory, instructions), **escreva a classe PHP completa** seguindo as instruções retornadas.

Chame `pipeline_test` com `class_name`, `type`, `state`, `php_code`, `cnpj` e `nome` (se disponível na tarefa).

---

### PASSO 9B — MANUTENÇÃO: corrigir classe PHP existente

Você já tem:
- O código PHP atual (lido no PASSO 3B)
- A interpretação do fluxo HTTP **fresco** do site, vinda da captura do PASSO 6 (extraída/interpretada nos PASSOS 7 e 8) — sempre presente, porque manutenção sempre captura primeiro
- O problema descrito na seção `expectativas`

O diff entre o HAR fresco e o código existente é o **ponto de partida obrigatório** do diagnóstico — não comece adivinhando pelo `artisan_output`. Compare o fluxo HTTP atual com o que o código PHP está replicando e identifique o que diverge:
- Endpoints diferentes ou renomeados?
- Parâmetros novos, removidos ou com valores diferentes?
- Headers ou cookies necessários que o código não está enviando?
- Lógica de validação do resultado incorreta (ex: regex errada, campo de status mudou)?

Aplique as correções mínimas necessárias no código existente.

Chame `pipeline_test` com `class_name`, `type`, `state`, `php_code`, `cnpj` e `nome` (se disponível na tarefa).

---

### PASSO 10 — Retry em caso de falha no teste

Se o teste falhar:
- Analise o `artisan_output`, identifique a causa raiz e corrija o código.
- Chame `pipeline_test` novamente.
- Repita até **3 tentativas** no total.
- Se todas falharem → vá para PASSO 11 (falha).

Se passar → vá para PASSO 12 (sucesso — knowledge + commit).

---

### PASSO 11 — Registrar falha no Redmine

Traduza o erro para uma descrição objetiva e humana. Exemplos:
- "Captcha detectado na página de emissão — não foi possível automatizar."
- "Parâmetro `inscricaoMunicipal` não encontrado no retorno da API."
- "Portal bloqueou a requisição via automação (possível detecção de bot)."
- "Endpoint de emissão retornou estrutura de resposta diferente do esperado."
- "Certidão retorna status de falha mesmo para empresa regular no site."

Chame `redmine_update_task`:
- `issue_id`: id da tarefa
- `status_id`: `"56"` (Ag. Desenv.)
- `assigned_to_id`: ID do grupo **"Questor Sistemas - Analista de Negocio Web/Imobiliário"** (valor de `REDMINE_FAILURE_ASSIGNEE_ID` no `.env` / `.claude/settings.json`). Reatribui a tarefa pra esse grupo para que um analista avalie manualmente.
- `notes`:
```
Tentativa de resolução automática pela CND Automation — não foi possível concluir.

Motivo: {descrição humana do erro}
```

Exiba: `❌ #{task_id} — {class_name} — {motivo} (reatribuído para Analista de Negócio)`

Notifique o Google Chat chamando `notify_google_chat`:
- `task_id`: id numérico da tarefa
- `class_name`: nome da classe (ex.: `CertificateCajati`)
- `status`: `"ERRO"`
- `tipo`: `"NOVA IMPLEMENTAÇÃO"` ou `"MANUTENÇÃO"` (mesma classificação do PASSO 3)
- `motivo`: a mesma descrição humana do erro usada na nota do Redmine
- `inicio`: timestamp anotado no PASSO 2
- `duracao_segundos`: `(agora - inicio)` em segundos

Incremente o contador:
```powershell
$p = "c:\Workspace\cnd-automation\.claude\auto_count"; $n = if (Test-Path $p) { [int](Get-Content $p) } else { 0 }; ($n + 1) | Out-File $p -Encoding utf8
```

**Encerre o ciclo.**

---

### PASSO 12 — Atualizar knowledge base

Objetivo: registrar o que funcionou para evitar redescobrir em tarefas futuras. Gere o knowledge **agora**, antes do commit — assim ele entra no mesmo commit da classe (PASSO 13).

#### 12.1 — Identificar classe base

Leia o arquivo PHP da classe para encontrar qual base ela estende:
```php
class CertificateX extends CertificateServlet  // → CertificateServlet
```

#### 12.2 — Atualizar "Última execução bem-sucedida" na base

Localize o arquivo correspondente em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md`.

Se existir, atualize a linha `Última execução bem-sucedida`:
```
## Última execução bem-sucedida
- {AAAA-MM-DD} | Tarefa #{task_id} | {class_name}
```

Se o arquivo da base não existir, crie-o em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md` com o padrão observado nesta execução.

#### 12.3 — Criar ou atualizar arquivo da certidão

Verifique se existe `C:\Workspace\cnd\.claude\patterns\{federal|state}\{class_name}.md`.

- **Se não existe**: crie com as informações desta execução.
- **Se existe**: atualize apenas o que mudou (novos parâmetros, armadilhas descobertas, data).

Conteúdo do arquivo:

```markdown
# {class_name}

**Base:** {BaseClass}
**Localização:** `app/Certificates/{type}/{class_name}.php`

## Fluxo PHP

{passos resumidos do fluxo identificado no PASSO 8 — apenas o que é específico desta certidão}

## Parâmetros críticos

{parâmetros não óbvios ou específicos deste portal, extraídos do código gerado}

## Armadilhas conhecidas

{problemas encontrados durante os retries ou observações do fluxo — omitir se nenhum}

## Última execução bem-sucedida

- {AAAA-MM-DD} | Tarefa #{task_id}
```

> Esses arquivos serão staged e commitados no **PASSO 13** — não crie um commit `docs:` separado. Como o `pipeline_commit` faz `git commit` de tudo que está staged, basta tê-los staged antes de chamá-lo, resultando em **um único commit por tarefa** com classe + config + knowledge.

---

### PASSO 13 — Commit e encerramento com sucesso

O knowledge já foi gerado no PASSO 12 e está em `.claude/patterns/`. Stage e commite junto com a classe — **um único commit por tarefa**.

**13.1 — Stage do knowledge:**
```powershell
git -C C:\Workspace\cnd add .claude/patterns/
```

**13.2 — Commit.** Chame `pipeline_commit` com `task_id`, `task_subject` (subject completo da tarefa), `class_name`, `type` e `state`. Ele faz `git add` do PHP + `config/certificates.php` e depois `git commit` de **tudo que está staged** — então os arquivos de knowledge pré-staged no 13.1 entram no **mesmo commit** `#{task_id} - {task_subject}`. **Um único commit por tarefa**, com classe + config + knowledge juntos.

Chame `redmine_update_task`:
- `issue_id`: id da tarefa
- `status_id`: `"84"` (Ag. Review)
- `notes`:
```
Alterações realizadas:
> {implementação: "Implementação da classe {ClassName} para emissão automática de certidão."
   manutenção: "Correção da classe {ClassName} — {descrição curta do que foi corrigido}."}

Projetos e Arquivos Modificados:
> cnd — {caminho relativo do arquivo PHP}
> cnd — config/certificates.php

Branch: cnd-automation
```

> Regra canônica do template em CLAUDE.md › "Notas no Redmine — formato padrão" — manter os dois em sincronia ao alterar.

A linha `Branch: cnd-automation` é **obrigatória** — sinaliza ao revisor de qual branch do repo `cnd` ele deve abrir o merge request. Não inventar outro nome de branch; o `pipeline_commit` sempre commita em `cnd-automation` (valor de `GIT_BRANCH` no `.env`).

Exiba: `✅ #{task_id} — {class_name} — commitado e atualizado no Redmine.`

Notifique o Google Chat chamando `notify_google_chat`:
- `task_id`: id numérico da tarefa
- `class_name`: nome da classe (ex.: `CertificateCajati`)
- `status`: `"SUCESSO"`
- `tipo`: `"NOVA IMPLEMENTAÇÃO"` ou `"MANUTENÇÃO"`
- `esfera`: `"Federal"`, `"Estadual <UF>"` ou `"Municipal <UF>"` (ex.: `"Municipal SP"`)
- `inicio`: timestamp anotado no PASSO 2
- `duracao_segundos`: `(agora - inicio)` em segundos

Incremente o contador:
```powershell
$p = "c:\Workspace\cnd-automation\.claude\auto_count"; $n = if (Test-Path $p) { [int](Get-Content $p) } else { 0 }; ($n + 1) | Out-File $p -Encoding utf8
```
