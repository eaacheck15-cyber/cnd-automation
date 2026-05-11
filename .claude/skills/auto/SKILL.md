---
description: Executa o pipeline CND de forma totalmente autônoma — busca tarefas no Redmine, processa cada uma pelo pipeline completo e commita. Use com /loop para rodar continuamente sem intervenção.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, WebFetch, mcp__cnd-pipeline__*
---

## Pipeline CND — Modo Autônomo

Você está operando em modo autônomo. Execute cada passo na ordem abaixo, sem pedir confirmação.

---

### Pré-requisito de ambiente (não pular)

O projeto `C:\Workspace\cnd` é Laravel 6 e **só roda em PHP 7.4**. PHP 8+ no host faz o artisan crashar no boot (incompatibilidade `ArrayAccess`/`ReflectionParameter`). Por isso o `pipeline_test` **DEVE** executar dentro do container Docker `configs-development-app-1` (que tem PHP 7.3.33 e o diretório `C:\Workspace\cnd\app` montado em `/var/www/html/app`).

Como garantir antes de qualquer `pipeline_test`:

1. Confira que `C:\Users\Matheus.Rosa\.claude.json` (config global do Claude Code — não há `.mcp.json` no projeto) tem `DOCKER_CONTAINER=configs-development-app-1` e `DOCKER_WORKING_DIR=/var/www/html` no bloco `env` do servidor `cnd-pipeline`.
2. Confira que o container está de pé: `docker ps --filter name=configs-development-app-1 --format "{{.Names}}"`.
3. Se o `artisan_output` voltar com paths Windows (`C:\Workspace\cnd\vendor\...`) ou erros de `ArrayAccess`/`ReflectionParameter::getClass`, é sinal de que o MCP server está usando o PHP do host — **peça ao usuário para reiniciar o MCP `cnd-pipeline`** (env só é lida no spawn do processo) e só então retome. Não tente "consertar" o helpers.php nem propor downgrade do PHP do host, esses caminhos já foram descartados.

---

### PASSO 1 — Verificar pausa

Verifique se o arquivo `c:\Workspace\cnd-automation\STOP` existe:
```powershell
Test-Path c:\Workspace\cnd-automation\STOP
```
- **True** → exiba "⏸ Pipeline pausado. Delete o arquivo STOP para retomar." e **encerre o ciclo**.
- **False** → continue.

---

### PASSO 2 — Buscar próxima tarefa

Chame `redmine_next_task`.

- `task: null` → "📭 Fila vazia." e **encerre o ciclo**.
- `auto_refreshed: true` → informe quantas tarefas foram carregadas.
- Tarefa retornada → anote `id`, `subject` e `description` e continue.

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
- `pdf_path` — preenchido quando o portal devolveu PDF. Útil para validar que o fluxo terminou.
- `popup_pages` — número de popups detectados (use isso para confirmar que `page_index` foi necessário)
- `failed_step` — índice do step que falhou (auto-retry interno já tentou 2x antes de marcar como falha)
- `failure_reason` — mensagem do erro do Playwright
- `diagnostics` — snapshot textual da página no momento da falha:
  - `current_url`, `page_title` — detecta redirect inesperado (login, manutenção, captcha bloqueando)
  - `visible_elements` — lista de botões/links/inputs/selects visíveis com `text`, `label`, `name`, `id`. Compare com o texto da instrução para descobrir o nome real do elemento.
  - `dom_snippet` — body HTML truncado em 8KB para inspeção pontual

Chame `pipeline_browser_capture` com `nav_steps` preenchido.

Se vier `failed_step`, **use `diagnostics.visible_elements`** para descobrir o texto/label real e ajuste só aquele step na 2ª tentativa (não refaça o `nav_steps` inteiro). Limite total: 2 tentativas.

**Se a 2ª tentativa também voltar com `failed_step`** (HAR incompleto), não desista — siga em frente usando o que já existe no projeto:

- **MANUTENÇÃO**: a classe PHP atual já implementa o fluxo HTTP completo. Rodar `pipeline_test` com o CNPJ insere na fila do MongoDB e o artisan executa o código existente, revelando onde o portal real quebra hoje — costuma ser mais informativo que HAR parcial. Pule os PASSOS 8–10A, vá direto ao 10B usando o código atual sem alterações iniciais, analise o `artisan_output` no PASSO 11 (o ponto que falha aponta o endpoint/parâmetro que mudou) e corrija com base nesse output + `diagnostics`.

- **NOVA IMPLEMENTAÇÃO**: procure classes existentes que atendam URLs parecidas (mesmo domínio, mesmo sistema/fornecedor). Ex.: URL `gpi07.cloud.el.com.br` → grep por outras classes que batem em `*.cloud.el.com.br` ou herdam da mesma base. Use uma como template, adapte ao novo CNPJ/portal e rode `pipeline_test`. Só registre falha (PASSO 12) se o teste não devolver PDF/dados após até 3 tentativas no PASSO 11.

Em ambos os casos, use `failure_reason` + `diagnostics.current_url`/`page_title` para compor a mensagem da falha quando ela for inevitável.

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
- A interpretação do fluxo HTTP atual do site (PASSO 9)
- O problema descrito na seção `expectativas`

Compare o fluxo HTTP atual com o que o código PHP está replicando. Identifique o que diverge:
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

Se passar → vá para PASSO 12 (sucesso).

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
- `notes`:
```
Tentativa de resolução automática pela CND Automation — não foi possível concluir.

Motivo: {descrição humana do erro}
```

Exiba: `❌ #{task_id} — {class_name} — {motivo}`

**Encerre o ciclo.**

---

### PASSO 12 — Commit e encerramento com sucesso

Chame `pipeline_commit` com `task_id`, `task_subject` (subject completo da tarefa), `class_name`, `type` e `state`.

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
```

Exiba: `✅ #{task_id} — {class_name} — commitado e atualizado no Redmine.`

---

### PASSO 13 — Atualizar knowledge base

Objetivo: registrar o que funcionou para evitar redescobrir em tarefas futuras.

#### 13.1 — Identificar classe base

Leia o arquivo PHP da classe para encontrar qual base ela estende:
```php
class CertificateX extends CertificateServlet  // → CertificateServlet
```

#### 13.2 — Atualizar "Última execução bem-sucedida" na base

Localize o arquivo correspondente em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md`.

Se existir, atualize a linha `Última execução bem-sucedida`:
```
## Última execução bem-sucedida
- {AAAA-MM-DD} | Tarefa #{task_id} | {class_name}
```

Se o arquivo da base não existir, crie-o em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md` com o padrão observado nesta execução.

#### 13.3 — Criar ou atualizar arquivo da certidão

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

#### 13.4 — Commit dos knowledge files

Se algum arquivo de knowledge foi criado ou modificado, commite apenas esses arquivos:
```powershell
git -C C:\Workspace\cnd add .claude/patterns/
git -C C:\Workspace\cnd commit -m "docs: atualiza knowledge base — {class_name} #{task_id}"
```
