# 13 - Configuração — Variáveis de Ambiente

← Voltar para [[CND Automation — Documentação Técnica|Home]] · implementação: `src/config.ts`

## Arquivos de configuração

| Arquivo | O quê | Versionado? |
|---|---|---|
| `.mcp.json` | spawn do servidor MCP (`node ./dist/index.js`) | ✅ sim |
| `.env` | variáveis do MCP server (paths, API keys, webhooks) — copiar de `.env.example` | ❌ gitignored |
| `.claude/settings.json` | permissões do Claude Code para evitar prompts a cada tool | ❌ gitignored (recomendado) |

> ⚠️ As env vars são lidas **apenas no spawn** do processo MCP (`config.ts` chama `dotenv` com `override:true`). Alterou o `.env`? **Reinicie o MCP** (`/mcp` → restart). Mesmo vale para `.claude/settings.json` → bloco `env`.

---

## Variáveis (`src/config.ts`)

### Obrigatórias
| Var | Descrição |
|-----|-----------|
| `GIT_WORKING_DIR` | path absoluto do repo CND clonado (ex.: `C:\Workspace\cnd`) |
| `WORK_DIR` | diretório de trabalho do MCP (HAR, PDFs, fila) — fora do repo CND |
| `REDMINE_API_KEY` | chave da API do Redmine (Minha conta → chave de acesso) |

### Git (commit do pipeline)
| Var | Default |
|-----|---------|
| `GIT_REPO_URL` | `""` |
| `GIT_BRANCH` | `develop` → na prática **`cnd-automation`** (definido no `.env`) |
| `GIT_USER_NAME` | `mcp-cnd-pipeline` |
| `GIT_USER_EMAIL` | `mcp@questores.com.br` |

### PHP / Docker / Mongo
| Var | Default | Nota |
|-----|---------|------|
| `PHP_BINARY` | `php` | fallback do host (não recomendado) |
| `DOCKER_CONTAINER` | `""` → **`configs-development-app-1`** | **obrigatório na prática** (Laravel 6/PHP 7.4) |
| `DOCKER_WORKING_DIR` | `/var/www/html` | monta `C:\Workspace\cnd\app` em `/var/www/html/app` |
| `MONGO_CONTAINER` | `configs-development-mongodb-1` | usado no upsert da `listaespera` |
| `MONGO_DB` | `questorservercnd` | |

> **Por que Docker é obrigatório:** o host normalmente tem PHP 8+, incompatível com Laravel 6 (`artisan` crasha no boot com `ArrayAccess`/`ReflectionParameter::getClass`). O container tem PHP 7.3.33.

### Browser
| Var | Default | Nota |
|-----|---------|------|
| `BROWSER_HEADLESS` | `false` | ⚠️ existe no config mas o `browser.ts` usa `headless:false` hardcoded |

### Redmine
| Var | Default |
|-----|---------|
| `REDMINE_URL` | `https://redmine.questor.com.br` |
| `REDMINE_PROJECT_ID` | `1106` |
| `REDMINE_ASSIGNED_TO_NAME` | `Questor Sistemas - Desenvolvimento Web` |
| `REDMINE_ASSIGNED_TO_ID` | `""` → **`1062`** (origem das tarefas) |
| `REDMINE_FAILURE_ASSIGNEE_ID` | `""` → **`875`** (destino em falha) |
| `REDMINE_STATUS_EM_DESENV` | `57` |
| `REDMINE_STATUS_AG_REVIEW` | `84` |
| `REDMINE_STATUS_AG_DESENV` | `56` |
| `REDMINE_NEXT_TASK_STATUS` | `56` (único status carregado na fila) |
| `REDMINE_NEXT_TASK_SKIP_STATUSES` | `59` (lista CSV de status ignorados) |

### Notificação
| Var | Default | Nota |
|-----|---------|------|
| `GOOGLE_CHAT_WEBHOOK_URL` | `""` | vazio = não notifica (sem erro). **Contém token.** |

### Fallback AHK (binários externos)
| Var | Default |
|-----|---------|
| `CHROME_BINARY` | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `AHK_BINARY` | `C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe` |
| `TESSERACT_BINARY` | `C:\Program Files\Tesseract-OCR\tesseract.exe` |

### Paths derivados (não-env)
- `BLOCKS_MEMORY_PATH` = `{GIT_WORKING_DIR}/.claude/blocks/CND_BLOCKS_MEMORY.json`
- `HAR_DIR` = `{WORK_DIR}/har`
- `TASK_QUEUE_PATH` = `{WORK_DIR}/state/task_queue.json`
- `TESSDATA_DIR` = `{repo}/resources/tessdata`

---

## `.claude/settings.json` (recomendado)

Libera as tools e diretórios para o Claude Code não promptar a cada chamada. Trecho essencial:

```json
{
  "permissions": {
    "allow": [
      "mcp__cnd-pipeline__pipeline_discover",
      "mcp__cnd-pipeline__pipeline_browser_capture",
      "mcp__cnd-pipeline__pipeline_browser_capture_ahk",
      "mcp__cnd-pipeline__pipeline_extract_har",
      "mcp__cnd-pipeline__pipeline_interpret_flow",
      "mcp__cnd-pipeline__pipeline_generate_code",
      "mcp__cnd-pipeline__pipeline_test",
      "mcp__cnd-pipeline__pipeline_commit",
      "mcp__cnd-pipeline__redmine_next_task",
      "mcp__cnd-pipeline__redmine_get_tasks",
      "mcp__cnd-pipeline__redmine_update_task",
      "mcp__cnd-pipeline__notify_google_chat",
      "Read", "Write", "Edit", "Glob", "Grep"
    ],
    "additionalDirectories": ["C:\\Workspace\\cnd"]
  }
}
```
`additionalDirectories` precisa bater com o `GIT_WORKING_DIR` real.

---

## Veja também
- [[02 - Stack, Estrutura e Build]] — onde os arquivos vivem e como buildar.
- [[14 - Operação e Agendamento]] — agendamento e controle do pipeline.
- [[10 - Integração Redmine]] — significado dos IDs de status/grupo.
