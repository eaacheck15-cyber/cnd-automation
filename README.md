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

Crie o arquivo `.claude/settings.json` com as variáveis de ambiente do servidor MCP (não commite este arquivo — ele já está no `.gitignore`):

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
      "Bash(git -C C:\\caminho\\para\\cnd add:*)",
      "Bash(git -C C:\\caminho\\para\\cnd commit:*)",
      "Bash(git -C C:\\caminho\\para\\cnd status:*)",
      "Bash(git -C C:\\caminho\\para\\cnd diff:*)",
      "Bash(git -C C:\\caminho\\para\\cnd log:*)",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep"
    ],
    "additionalDirectories": [
      "C:\\caminho\\para\\cnd"
    ]
  },
  "mcpServers": {
    "cnd-pipeline": {
      "command": "node",
      "args": ["C:\\caminho\\para\\cnd-automation\\dist\\index.js"],
      "env": {
        "GIT_WORKING_DIR": "C:\\caminho\\para\\cnd",
        "GIT_REPO_URL": "git@gitlab.questor.com.br:timeweb/cnd.git",
        "GIT_BRANCH": "cnd-automation",
        "GIT_USER_NAME": "mcp-cnd-pipeline",
        "GIT_USER_EMAIL": "mcp@questores.com.br",
        "WORK_DIR": "C:\\caminho\\para\\cnd-automation\\work",
        "PHP_BINARY": "php",
        "REDMINE_URL": "https://redmine.questor.com.br",
        "REDMINE_API_KEY": "SUA_API_KEY_AQUI",
        "REDMINE_PROJECT_ID": "1106",
        "REDMINE_ASSIGNED_TO_ID": "1062",
        "REDMINE_FAILURE_ASSIGNEE_ID": "875",
        "DOCKER_CONTAINER": "",
        "DOCKER_WORKING_DIR": "/var/www/html",
        "GOOGLE_CHAT_WEBHOOK_URL": ""
      }
    }
  }
}
```

> **DOCKER_CONTAINER**: se o PHP rodar dentro de um container Docker, informe o nome do container (ex: `configs-development-app-1`). Deixe vazio para usar o PHP do host.

> **REDMINE_ASSIGNED_TO_ID** = `1062` (grupo "Questor Sistemas - Desenvolvimento Web") é a origem das tarefas processadas. **REDMINE_FAILURE_ASSIGNEE_ID** = `875` (grupo "Questor Sistemas - Analista de Negocio Web/Imobiliário") é o destino quando o `/auto` não consegue resolver — a tarefa é reatribuída automaticamente para análise manual.

> **GOOGLE_CHAT_WEBHOOK_URL**: webhook do Google Chat para notificações de sucesso/falha por tarefa. Gerar em **Configurações do Space → Apps e integrações → Adicionar webhooks** e colar a URL completa (contém token, tratar como senha). Se vazio, as notificações são silenciosamente puladas.

> **permissions**: libera as MCP tools do pipeline e os comandos Bash usados pela skill `/auto` sem prompts. Substitua `C:\\caminho\\para\\cnd` pelo caminho real onde o repo CND foi clonado (precisa bater com `GIT_WORKING_DIR` e aparecer também em `additionalDirectories` pra permitir Read/Edit fora do workspace).

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
