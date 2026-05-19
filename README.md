# CND Automation — MCP Pipeline

Servidor MCP que automatiza a implementação de certidões no projeto CND. Para cada tarefa do Redmine, executa o fluxo completo: descoberta → captura de navegador → extração de HAR → interpretação → geração de código PHP → teste → commit.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20+
- [PHP](https://www.php.net/) acessível no PATH (ou via Docker)
- [rebrowser-playwright](https://github.com/rebrowser/rebrowser-playwright) com Chromium instalado (fork stealth do Playwright; API idêntica)
- [Claude Code](https://claude.ai/code) CLI instalado
- Acesso ao Redmine da Questor e ao repositório CND

## Instalação

```powershell
git clone https://github.com/MatheusRosaQuestor/cnd-automation.git
cd cnd-automation
npm install
npx rebrowser-playwright install chromium
npm run build
```

Clone também o repositório CND ao lado, no caminho que será informado em `GIT_WORKING_DIR` (ver Configuração):

```powershell
git clone git@gitlab.questor.com.br:timeweb/cnd.git C:\Workspace\cnd
```

## Configuração

São dois arquivos:

| Arquivo | O quê | Versionado? |
|---|---|---|
| [`.mcp.json`](.mcp.json) | Spawn do servidor MCP (`node ./dist/index.js`). Já vem pronto no projeto. | Sim |
| `.env` | Variáveis de ambiente do MCP server (paths, API keys, webhooks). Copie de `.env.example`. | **Não** (gitignored) |
| `.claude/settings.json` | Permissões do Claude Code para evitar prompts em cada tool. Opcional, mas recomendado. | **Não** (gitignored) |

### 1. `.env`

```powershell
cp .env.example .env
```

Edite preenchendo:
- `GIT_WORKING_DIR` — caminho absoluto onde o repo CND foi clonado (ex.: `C:\Workspace\cnd`)
- `WORK_DIR` — caminho absoluto pro diretório de trabalho do MCP (ex.: `C:\Workspace\cnd-automation\work`)
- `REDMINE_API_KEY` — pegue em https://redmine.questor.com.br → Minha conta → chave de acesso à API
- `GOOGLE_CHAT_WEBHOOK_URL` — gerar em **Configurações do Space → Apps e integrações → Adicionar webhooks**, colar a URL inteira (contém token, tratar como senha)

> **DOCKER_CONTAINER é obrigatório.** O CND é Laravel 6 / PHP 7.4 e o host normalmente tem PHP 8+. Sem o container, `pipeline_test` crasha no boot do Artisan. Default no `.env.example`: `configs-development-app-1`.

> `REDMINE_ASSIGNED_TO_ID=1062` (grupo "Desenvolvimento Web") = origem das tarefas. `REDMINE_FAILURE_ASSIGNEE_ID=875` (grupo "Analista de Negocio Web/Imobiliario") = destino quando o `/auto` falha — a tarefa é reatribuída automaticamente.

### 2. `.claude/settings.json` (recomendado)

Sem esse arquivo, o Claude Code prompta a cada uso de tool. Crie pra liberar de uma vez:

```json
{
  "permissions": {
    "allow": [
      "mcp__cnd-pipeline__pipeline_discover",
      "mcp__cnd-pipeline__pipeline_browser_capture",
      "mcp__cnd-pipeline__pipeline_extract_har",
      "mcp__cnd-pipeline__pipeline_interpret_flow",
      "mcp__cnd-pipeline__pipeline_generate_code",
      "mcp__cnd-pipeline__pipeline_test",
      "mcp__cnd-pipeline__pipeline_commit",
      "mcp__cnd-pipeline__redmine_next_task",
      "mcp__cnd-pipeline__redmine_get_tasks",
      "mcp__cnd-pipeline__redmine_update_task",
      "mcp__cnd-pipeline__notify_google_chat",
      "Bash(Test-Path:*)",
      "Bash(docker ps:*)",
      "Bash(Get-ChildItem:*)",
      "Bash(Get-Content:*)",
      "Bash(git -C C:\\Workspace\\cnd add:*)",
      "Bash(git -C C:\\Workspace\\cnd commit:*)",
      "Bash(git -C C:\\Workspace\\cnd status:*)",
      "Bash(git -C C:\\Workspace\\cnd diff:*)",
      "Bash(git -C C:\\Workspace\\cnd log:*)",
      "Read", "Write", "Edit", "Glob", "Grep"
    ],
    "additionalDirectories": ["C:\\Workspace\\cnd"]
  }
}
```

Substitua `C:\\Workspace\\cnd` pelo seu `GIT_WORKING_DIR` real (precisa bater).

### CapMonster (resolver captcha no HAR capture)

O `pipeline_browser_capture` carrega a extensão [CapMonster](https://capmonster.cloud/) (versionada em `resources/capmonster/`) para resolver captchas durante a gravação do HAR. **Configure uma vez por máquina:**

1. Rode qualquer `pipeline_browser_capture` (ou execute `/auto` uma vez) — vai abrir o Chromium com a extensão carregada.
2. Clique no ícone de extensões (peça de quebra-cabeça) na barra do navegador, fixe a CapMonster.
3. Abra o popup da CapMonster, cole sua **Client Key** do [dashboard](https://dashboard.capmonster.cloud/) e salve.
4. Pode fechar — a chave fica salva em `browser-profile/` (gitignored) e persiste entre execuções.

> A extensão é usada **apenas no HAR capture**. O código PHP em produção usa o solver próprio embutido nas classes-base da CND.

## Uso

### Modo autônomo (agendado)

O `/auto` é disparado diariamente às **07:00** pelo Task Scheduler do Windows. Cada execução processa no máximo `MAX_TAREFAS` tarefas (default `5`, definido em [.claude/skills/auto/SKILL.md](.claude/skills/auto/SKILL.md)) e então encerra.

**Instalar o agendamento (rodar UMA vez por máquina):**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-scheduled-task.ps1
```

Isso cria a tarefa **"CND Auto Daily"** no Task Scheduler do seu usuário (não precisa Administrador). O script imprime o próximo horário de disparo ao final. A tarefa chama [scripts/auto-daily.ps1](scripts/auto-daily.ps1), que executa `claude -p "/auto"` na pasta do projeto e loga em `logs/auto-daily-YYYY-MM-DD.log`.

**Conferir / desinstalar:**

```powershell
# ver status e proximo disparo
Get-ScheduledTask -TaskName "CND Auto Daily" | Get-ScheduledTaskInfo

# disparar manualmente para testar
Start-ScheduledTask -TaskName "CND Auto Daily"

# remover
Unregister-ScheduledTask -TaskName "CND Auto Daily" -Confirm:$false
```

**Resetar o contador de tarefas processadas** (`MAX_TAREFAS`):

```powershell
Remove-Item .claude\auto_count
```

**Observações:**
- A task roda como usuário interativo. Se a máquina estiver desligada ou o usuário deslogado às 7h, ela dispara assim que possível (graças a `-StartWhenAvailable`).
- Confirme que o seu CLI do Claude Code aceita os flags usados em `auto-daily.ps1` (`-p "/auto" --permission-mode acceptEdits`). Ajuste se a sua versão usar nomes diferentes.

### Pausar o pipeline

```powershell
.\stop-pipeline.ps1
```

O agente termina a tarefa atual e para no início do próximo ciclo.

### Retomar o pipeline

```powershell
.\resume-pipeline.ps1
```

### Uso manual (tarefa individual)

Também é possível rodar uma tarefa específica pelo Claude Code chamando os tools diretamente:

```
use redmine_get_tasks to fetch open tasks, then run pipeline for task #1234
```

## Tools disponíveis

| Tool | Descrição |
|------|-----------|
| `redmine_next_task` | Retorna a próxima tarefa da fila local (auto-atualiza a cada 24h) |
| `redmine_get_tasks` | Força atualização da fila do Redmine |
| `pipeline_discover` | Analisa a descrição da tarefa e extrai URL, inputs e fluxo esperado |
| `pipeline_browser_capture` | Abre o Playwright, navega no portal e captura o HAR |
| `pipeline_extract_har` | Filtra o HAR, mantendo apenas requisições relevantes |
| `pipeline_interpret_flow` | Classifica cada step HTTP e detecta o tipo de fluxo |
| `pipeline_generate_code` | Coleta contexto e exemplos para geração da classe PHP |
| `pipeline_test` | Escreve o arquivo, atualiza o config e roda `php artisan issue` |
| `pipeline_commit` | Faz o commit do arquivo gerado e do config atualizado |
| `redmine_update_task` | Atualiza status, responsável e adiciona nota numa tarefa do Redmine |
| `notify_google_chat` | Envia card de sucesso/falha para um Google Chat Space via webhook (`GOOGLE_CHAT_WEBHOOK_URL`) |

## Desenvolvimento

```powershell
npm run dev   # compila TypeScript em modo watch
npm run build # build único
```

Após qualquer alteração no código, rebuilde e reinicie o servidor MCP no Claude Code (`/mcp` → restart).
