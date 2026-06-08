# 01 - Visão Geral e Arquitetura

← Voltar para [[CND Automation — Documentação Técnica|Home]]

## Propósito

Automatizar o ciclo completo de **descoberta → captura → interpretação → geração de código → teste → commit** das classes PHP que emitem certidões (Federal / Estadual / Municipal) consumidas pelo sistema **CND** da Questor.

### O problema que resolve

Cada nova prefeitura/órgão exige uma **classe PHP** que replica, request a request, o fluxo HTTP do portal de emissão da certidão. Feito à mão, o processo é:

1. Ler a tarefa no Redmine.
2. Navegar no portal e inspecionar o tráfego de rede.
3. Escrever a classe PHP replicando o fluxo.
4. Testar localmente (`artisan issue`).
5. Revisar e commitar.

O `cnd-automation` transforma esse esforço repetitivo numa execução **autônoma** orquestrada pelo Claude Code, com retry guiado por erro e uma [[16 - Knowledge Base e Memória de Time|knowledge base]] acumulativa.

### Entrada e saída

- **Input:** uma tarefa no Redmine do projeto `1106`, atribuída ao grupo "Desenvolvimento Web" (ID `1062`), em status **Ag. Desenv. (56)**, cujo subject começa com `Implementar` ou `Revisar`.
- **Output:**
  - commit no repositório **CND** (branch `cnd-automation`) com a classe PHP + atualização do `config/certificates.php`;
  - status no Redmine → **Ag. Review (84)** com nota padronizada;
  - card 🟢 no Google Chat;
  - arquivo de knowledge atualizado no repo CND.
- **Em caso de falha** (3 tentativas): status volta a **Ag. Desenv. (56)**, tarefa é **reatribuída** ao grupo Analista de Negócio (ID `875`) e um card 🔴 é enviado.

---

## Arquitetura

```mermaid
flowchart TB
    subgraph CLAUDE["Claude Code (host Windows)"]
        SKILL["/auto skill\n.claude/skills/auto/SKILL.md"]
        SCHED["Task Scheduler\n(auto-daily.ps1, 07:00)"]
    end

    subgraph MCP["Servidor MCP — mcp-cnd-pipeline (Node/TS)"]
        IDX["index.ts\n12 tools registradas"]
        DISC["discover"]
        BROW["browser (Playwright)"]
        AHK["browser_ahk (CDP+OCR)"]
        EXTR["extract (HAR parser)"]
        INTP["interpret"]
        GEN["generate (contexto)"]
        TEST["test (lint+Mongo+artisan)"]
        COM["commit (git+push)"]
        REDM["redmine (API + fila)"]
        NOT["notify (Google Chat)"]
    end

    subgraph EXT["Sistemas externos"]
        RED["Redmine API\nredmine.questor.com.br"]
        PORTAL["Portais do órgão\n(via Chromium/Chrome)"]
        CAP["CapMonster (extensão)"]
        TESS["Tesseract OCR"]
        GIT["Repo CND\ngitlab.questor.com.br"]
        DOCKER["Docker\nPHP 7.3 + MongoDB"]
        GCHAT["Google Chat\nwebhook"]
    end

    SCHED --> SKILL
    SKILL --> IDX
    IDX --> DISC & BROW & AHK & EXTR & INTP & GEN & TEST & COM & REDM & NOT
    REDM <--> RED
    BROW <--> PORTAL
    BROW --> CAP
    AHK <--> PORTAL
    AHK --> TESS
    COM --> GIT
    TEST --> DOCKER
    NOT --> GCHAT

    style SKILL fill:#6366f1,color:#fff
    style IDX fill:#0ea5e9,color:#fff
    style RED fill:#f59e0b,color:#fff
    style PORTAL fill:#22c55e,color:#fff
    style GIT fill:#ef4444,color:#fff
    style DOCKER fill:#8b5cf6,color:#fff
```

---

## Pontos-chave da arquitetura

- **A skill `/auto` é o cérebro.** O servidor MCP só expõe *tools atômicas*; a orquestração (qual tool chamar, em que ordem, quando retentar, como tratar falha) vive no [[05 - Skill auto — Orquestrador|SKILL.md]]. Isso permite evoluir o fluxo **sem rebuildar TypeScript** — basta editar o markdown.
- **HAR é a interface entre captura e interpretação.** O browser grava o tráfego em `WORK_DIR/har/{task_id}.har` com `mode="full"` + `content="embed"`, para que os bodies (HTML/JSON/PDF) cheguem inline — exigência do PHP downstream que faz parsing via `loadHiddenFieldsFromString`. Ver [[08 - Extração e Interpretação de HAR]].
- **Duas vias de captura.** [[06 - Captura de Browser — Playwright|Playwright]] é o caminho padrão; o [[07 - Fallback AHK — OCR + AutoHotkey|fallback AHK]] entra como 3ª tentativa quando o Playwright falha 2x e os passos são 100% baseados em texto.
- **PHP roda em Docker.** O repo CND é Laravel 6 / PHP 7.4; o host normalmente tem PHP 8+. Por isso o `pipeline_test` executa `artisan` **dentro do container** `configs-development-app-1` (PHP 7.3.33). Ver [[13 - Configuração — Variáveis de Ambiente]].
- **Persistência local mínima.** O único estado durável é a fila Redmine em `WORK_DIR/state/task_queue.json` (TTL 24h) e os HAR/PDF em `WORK_DIR/har/`. Não há mais "state file por tarefa" (o antigo `StateManager` foi removido).
- **Dois repositórios acoplados.** `cnd-automation` (este, a ferramenta) escreve dentro de `cnd` (o produto). A knowledge base e as classes geradas vivem no repo CND.

---

## Ciclo de vida de uma tarefa (visão macro)

```mermaid
sequenceDiagram
    participant TS as Task Scheduler
    participant A as /auto (Claude)
    participant M as MCP server
    participant R as Redmine
    participant P as Portal
    participant D as Docker (PHP)
    participant G as GitLab CND

    TS->>A: 07:00 — claude -p "/auto"
    A->>M: redmine_next_task
    M->>R: GET /issues.json (status 56)
    R-->>M: tarefa
    A->>R: status 57 (Em Desenv.)
    A->>M: pipeline_discover
    A->>M: pipeline_browser_capture (nav_steps)
    M->>P: navega e grava HAR
    A->>M: extract_har → interpret_flow → generate_code
    A->>A: escreve a classe PHP
    A->>M: pipeline_test
    M->>D: artisan issue --class=X
    D-->>M: artisan_output
    A->>M: pipeline_commit
    M->>G: push branch cnd-automation
    A->>R: status 84 (Ag. Review)
    A->>M: notify_google_chat (SUCESSO)
```

---

## Veja também
- [[03 - Pipeline — Fluxo Completo]] — o fluxograma detalhado com decisões e retries.
- [[02 - Stack, Estrutura e Build]] — tecnologias e árvore de arquivos.
- [[Glossário]] — vocabulário do domínio.
