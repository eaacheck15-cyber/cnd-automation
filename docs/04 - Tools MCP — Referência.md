# 04 - Tools MCP — Referência

← Voltar para [[CND Automation — Documentação Técnica|Home]]

As 12 tools são registradas em `src/index.ts` sob o servidor `mcp-cnd-pipeline` (prefixo `mcp__cnd-pipeline__`). Cada tool é **atômica**: a orquestração fica na skill [[05 - Skill auto — Orquestrador|/auto]].

| Tool | Etapa | Implementação |
|------|-------|---------------|
| `pipeline_discover` | Descoberta | `src/tools/discover.ts` |
| `pipeline_browser_capture` | Captura | `src/tools/browser.ts` |
| `pipeline_browser_capture_ahk` | Captura (fallback) | `src/tools/browser_ahk.ts` |
| `pipeline_extract_har` | Extração | `src/tools/extract.ts` |
| `pipeline_interpret_flow` | Interpretação | `src/tools/interpret.ts` |
| `pipeline_generate_code` | Geração (contexto) | `src/tools/generate.ts` |
| `pipeline_test` | Teste | `src/tools/test.ts` |
| `pipeline_commit` | Commit | `src/tools/commit.ts` |
| `redmine_get_tasks` | Redmine | `src/tools/redmine.ts` |
| `redmine_next_task` | Redmine | `src/tools/redmine.ts` |
| `redmine_update_task` | Redmine | `src/tools/redmine.ts` |
| `notify_google_chat` | Notificação | `src/tools/notify.ts` |

> Não há mais `pipeline_run` nem `pipeline_get_state`. A orquestração é da skill; o estado durável é só a fila Redmine.

---

## `pipeline_discover`
Analisa a descrição da tarefa e extrai por **regex**: URL principal, inputs (CNPJ/CPF só dígitos), fluxo esperado (linhas que começam com `>`) e nível de complexidade.

```ts
pipeline_discover({ task_id: string, task_description: string })
  → { url, inputs: string[], expected_flow: string[], complexity: "low"|"medium"|"high" }
```
- `complexity`: `high` se a descrição contém "captcha"; `medium` se "login"/"senha"/"certificado digital"; senão `low`.
- Detalhes em [[08 - Extração e Interpretação de HAR]] (mesma família) e na própria etapa do [[05 - Skill auto — Orquestrador|SKILL]].

## `pipeline_browser_capture`
Abre o Playwright (Chromium headed) com a extensão CapMonster, executa os `nav_steps` e grava `WORK_DIR/har/{task_id}.har` com `mode="full"` + `content="embed"`.

```ts
pipeline_browser_capture({
  task_id, url, inputs: string[], expected_flow: string[],
  nav_steps?: NavStep[]
}) → { har_path, pdf_path?, popup_pages?, failed_step?, failure_reason?, diagnostics? }
```
- Suporta iframes (`frame_fill`/`frame_click` + `frame_url`) e popups (`page_index`).
- Detecta e salva PDF (Content-Type pdf/octet-stream **ou** download), validando magic bytes `%PDF-`.
- Tudo sobre actions, diagnostics e PDF em [[06 - Captura de Browser — Playwright]].

## `pipeline_browser_capture_ahk`
**Fallback** — só quando o Playwright falhou 2x e os `nav_steps` são 100% baseados em texto. Sobe Chrome real via CDP, dirige por AutoHotkey + OCR (Tesseract) e grava o HAR pelos eventos `Network.*` do CDP.

```ts
pipeline_browser_capture_ahk({
  task_id, url, inputs, expected_flow, nav_steps?,
  playwright_diagnostics?: { page_title?, dom_snippet? }
}) → { har_path, pdf_path?, failed_step?, failure_reason?, mode: "ahk" }
```
- Só aceita `goto`, `wait`, `click_text`, `fill_field`, `select_text`. Actions com `selector`/`frame_*` são rejeitadas.
- `playwright_diagnostics` ajuda a detectar Cloudflare e estender a espera de challenge de 15s → 45s.
- Detalhes em [[07 - Fallback AHK — OCR + AutoHotkey]].

## `pipeline_extract_har`
Filtra o HAR mantendo apenas GET/POST relevantes (remove imagens, scripts, fontes, mapas). Retorna um array cronológico de `FlowStep`.

```ts
pipeline_extract_har({ har_path: string }) → FlowStep[]
```
- Mantém só headers `content-type`, `origin`, `referer`, `cookie`.
- Ver [[08 - Extração e Interpretação de HAR]].

## `pipeline_interpret_flow`
Classifica cada step (INIT/AUTH/CONSULTA/EMISSAO/POLLING/DOWNLOAD/VALIDACAO) e detecta o `flow_type` global (DIRETO/LOGIN_FORM/LOGIN_CERT/PROTOCOLO/CAPTCHA/HIBRIDO).

```ts
pipeline_interpret_flow({ flow: FlowStep[], artisan_feedback?: string })
  → { flow_type, steps: { type, step }[] }
```

## `pipeline_generate_code`
**Não escreve PHP** — coleta contexto para o Claude escrever: base class detectada por URL, namespace, até 3 exemplos do repo CND, trecho do `CND_BLOCKS_MEMORY.json` e instruções (incluindo a ordem dos membros).

```ts
pipeline_generate_code({ interpretation, task_description, class_name, type, state? })
  → { base_class, namespace, examples: string[], blocks_memory, instructions }
```
- Ver [[09 - Geração e Teste do Código PHP]] e [[15 - Convenções das Classes Certificate]].

## `pipeline_test`
Escreve o PHP no repo CND, faz lint, registra no `config/certificates.php`, faz upsert na `listaespera` (Mongo), roda `artisan issue` (no Docker) e limpa o registro de teste.

```ts
pipeline_test({ class_name, type, state?, php_code, cnpj, nome? })
  → { success, errors: string[], artisan_output }
```
- `cnpj` deve ser **só dígitos**. Heurísticas de sucesso e passos detalhados em [[09 - Geração e Teste do Código PHP]].

## `pipeline_commit`
Após teste bem-sucedido: garante a branch `cnd-automation`, `git add` da classe + `config/certificates.php`, commita (`#{task_id} - {task_subject}`), faz `fetch` + `pull --rebase` + **`push`**, e roda `artisan update-class-list`.

```ts
pipeline_commit({ task_id, task_subject, class_name, type, state? })
  → { committed, commit_hash, message }
```
> ⚠️ A *descrição* da tool em `index.ts` ainda menciona adicionar `CND_BLOCKS_MEMORY.json` ao commit, mas o **código** (`commit.ts`) adiciona apenas a classe PHP + `config/certificates.php` (mudança deliberada — ver commit `2d913cb`).

## `redmine_get_tasks`
Busca issues da API do Redmine (filtra por projeto, status, responsável) e **regrava a fila local**.

```ts
redmine_get_tasks({ project_id?, status_id?, assigned_to_id?, offset?, limit? })
  → { issues, total_count, queue_saved }
```

## `redmine_next_task`
Retorna a próxima tarefa da fila local; auto-refresh se a fila estiver ausente, esgotada ou com mais de 24h. Pula status ignorados (59) e reatribui tarefas sem descrição.

```ts
redmine_next_task() → { task | null, remaining, cursor, fetched_at, auto_refreshed }
```
- Ver [[10 - Integração Redmine]].

## `redmine_update_task`
Atualiza status, responsável e/ou adiciona nota. Constantes: **57** Em Desenv., **84** Ag. Review, **56** Ag. Desenv.

```ts
redmine_update_task({ issue_id: number, status_id?, notes?, assigned_to_id? })
```
> A transição **56 → 84 não funciona direto** — é preciso `56→57` e depois `57→84`. Ver [[10 - Integração Redmine]] e o `CLAUDE.md`.

## `notify_google_chat`
Envia um card de SUCESSO (🟢) ou ERRO (🔴) ao Google Chat via `GOOGLE_CHAT_WEBHOOK_URL`. Se o webhook não estiver configurado, retorna `{ sent: false }` sem erro.

```ts
notify_google_chat({ task_id, class_name, status: "SUCESSO"|"ERRO", inicio,
  duracao_segundos?, tipo?, esfera?, motivo?, reatribuido_para? })
  → { sent, reason? }
```
- Ver [[11 - Notificações Google Chat]].

---

## Tipos compartilhados (`src/types.ts`)

```ts
type CertificateType = "Federal" | "State" | "Municipal";
type FlowType = "DIRETO" | "LOGIN_FORM" | "LOGIN_CERT" | "PROTOCOLO" | "CAPTCHA" | "HIBRIDO";
type BlockType = "INIT" | "AUTH" | "CONSULTA" | "EMISSAO" | "POLLING" | "DOWNLOAD" | "VALIDACAO";

interface FlowStep { step; method; url; query; headers; cookies; payload; status }
interface NavStep {
  action: "goto"|"fill"|"click"|"wait"|"select"|"frame_fill"|"frame_click"
        | "click_text"|"fill_field"|"select_text";
  url?; selector?; value?; ms?; frame_url?; page_index?; text?; label?;
}
```

---

## Veja também
- [[03 - Pipeline — Fluxo Completo]] — quando cada tool é chamada.
- [[05 - Skill auto — Orquestrador]] — a lógica que as encadeia.
