# 02 - Stack, Estrutura e Build

← Voltar para [[CND Automation — Documentação Técnica|Home]]

## Stack e dependências

| Camada | Tecnologia | Versão |
|--------|------------|--------|
| Linguagem (MCP server) | TypeScript (`strict`, ESM) | 5.8.3 |
| Runtime | Node.js | 20+ |
| Protocolo | `@modelcontextprotocol/sdk` | ^1.12.0 |
| LLM SDK | `@anthropic-ai/sdk` | ^0.91.1 |
| Automação browser (padrão) | `rebrowser-playwright` + Chromium | ^1.52.0 |
| Automação browser (fallback) | `chrome-remote-interface` (CDP) + Chrome real | ^0.34.0 |
| HAR a partir de CDP | `chrome-har` | ^1.3.1 |
| Validação de schema | `zod` | ^3.24.4 |
| Env | `dotenv` | ^16.5.0 |
| OCR (fallback) | Tesseract (binário externo) | — |
| Input OS-level (fallback) | AutoHotkey v2 (binário externo) | — |
| Captcha solver (captura) | CapMonster (extensão Chromium) | versionada em `resources/capmonster/` |
| Backend PHP testado | PHP 7.3 via Docker | — |
| DB de teste | MongoDB (`listaespera`) via Docker | — |
| Git host CND | GitLab Questor | — |
| Ticket system | Redmine, projeto `1106` | — |

> **`rebrowser-playwright`** é um fork *stealth* do Playwright com API idêntica — reduz detecção de automação. O fallback usa **Chrome real** dirigido por CDP + AutoHotkey, ainda mais difícil de detectar (input OS-level). Ver [[07 - Fallback AHK — OCR + AutoHotkey]].

---

## Estrutura do projeto

```
cnd-automation/
├── .claude/
│   ├── knowledge/                 ← contexto longo lido sob demanda
│   │   └── README.md
│   └── skills/
│       └── auto/
│           └── SKILL.md           ← orquestração autônoma (13 passos)
├── browser-profile/               ← profile persistente Chromium/Chrome (gitignored)
│                                     compartilhado entre Playwright e AHK
├── dist/                          ← saída do tsc (gitignored)
├── resources/
│   ├── ahk/
│   │   └── runner.ahk             ← runner AutoHotkey (click/type/focus por CLI)
│   ├── capmonster/                ← extensão Chromium versionada (solver de captcha no HAR)
│   └── tessdata/                  ← treinos do Tesseract (por + eng + osd) versionados
├── scripts/
│   ├── auto-daily.ps1             ← runner chamado pelo Task Scheduler (claude -p "/auto")
│   └── install-scheduled-task.ps1 ← registra a task "CND Auto Daily" às 07:00
├── src/
│   ├── index.ts                   ← Servidor MCP — registra as 12 tools
│   ├── types.ts                   ← tipos compartilhados (FlowStep, NavStep, etc.)
│   ├── config.ts                  ← env vars + paths derivados
│   └── tools/
│       ├── discover.ts            ← regex extraction da descrição
│       ├── browser.ts             ← Playwright (text actions, popups, frames, PDF)
│       ├── browser_ahk.ts         ← fallback: Chrome via CDP + AHK + OCR
│       ├── ocr.ts                 ← Tesseract: localiza texto na tela (TSV bbox)
│       ├── extract.ts             ← HAR parser → flow[]
│       ├── interpret.ts           ← FlowType + classificação de blocos
│       ├── generate.ts            ← monta contexto p/ Claude (não escreve PHP)
│       ├── test.ts                ← lint + Mongo upsert + artisan + cleanup
│       ├── commit.ts              ← git add/commit + fetch/pull --rebase/push + update-class-list
│       ├── redmine.ts             ← API direta + fila local (TTL 24h)
│       └── notify.ts              ← card Google Chat (sucesso/falha)
├── .env.example                   ← template do .env (copiar e preencher)
├── .mcp.json                      ← spawn do servidor MCP (node ./dist/index.js)
├── .gitignore
├── CLAUDE.md                      ← regras de time carregadas em toda conversa
├── README.md
├── package.json
├── tsconfig.json
├── stop-pipeline.ps1              ← cria arquivo STOP (pausa)
└── resume-pipeline.ps1            ← remove arquivo STOP (retoma)
```

E, fora do repositório, o diretório de trabalho:

```
WORK_DIR/ (ex.: C:\Workspace\cnd-automation\work)
├── state/
│   └── task_queue.json        ← fila Redmine { fetched_at, total_count, cursor, tasks[] }
└── har/
    ├── {task_id}.har          ← tráfego capturado
    └── {task_id}.pdf          ← quando o portal entrega PDF (magic bytes %PDF- validados)
```

E o contador de execução da skill:

```
.claude/auto_count             ← inteiro: tarefas processadas no ciclo (vs MAX_TAREFAS)
.claude/STOP                   ← se existir, pausa o pipeline (criado por stop-pipeline.ps1)
```

> ⚠️ A doc antiga citava `src/state/StateManager.ts`, `src/tools/pipeline.ts` e `src/tools/decision.ts`. **Esses arquivos não existem mais.** A árvore acima reflete o estado atual (`git ls-files`).

---

## Build e desenvolvimento

```powershell
# instalação inicial
npm install
npx rebrowser-playwright install chromium
npm run build

# desenvolvimento
npm run dev     # tsc --watch
npm run build   # build único (tsc)
npm start       # node dist/index.js (normalmente o Claude faz o spawn via .mcp.json)
```

O servidor MCP é iniciado pelo Claude Code conforme [`.mcp.json`](.mcp.json):

```json
{
  "mcpServers": {
    "cnd-pipeline": { "command": "node", "args": ["./dist/index.js"] }
  }
}
```

> **Importante:** após qualquer alteração no código TypeScript, é preciso `npm run build` **e reiniciar o MCP** no Claude Code (`/mcp` → restart). As variáveis de ambiente do [[13 - Configuração — Variáveis de Ambiente|.env]] são lidas **apenas no spawn** do processo — mudou o `.env`, reinicie o MCP.

---

## Veja também
- [[13 - Configuração — Variáveis de Ambiente]] — todas as env vars.
- [[04 - Tools MCP — Referência]] — o que cada arquivo em `src/tools/` expõe.
- [[14 - Operação e Agendamento]] — scripts PowerShell e Task Scheduler.
