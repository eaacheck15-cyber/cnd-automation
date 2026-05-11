# CND Automation — MCP Pipeline

Servidor MCP que automatiza a implementação de certidões no projeto CND. Para cada tarefa do Redmine, executa o fluxo completo: descoberta → captura de navegador → extração de HAR → interpretação → geração de código PHP → teste → commit.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 20+
- [PHP](https://www.php.net/) acessível no PATH (ou via Docker)
- [Playwright](https://playwright.dev/) com Chromium instalado
- [Claude Code](https://claude.ai/code) CLI instalado
- Acesso ao Redmine da Questor e ao repositório CND

## Instalação

```powershell
git clone https://github.com/MatheusRosaQuestor/cnd-automation.git
cd cnd-automation
npm install
npx playwright install chromium
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
        "DOCKER_CONTAINER": "",
        "DOCKER_WORKING_DIR": "/var/www/html"
      }
    }
  }
}
```

> **DOCKER_CONTAINER**: se o PHP rodar dentro de um container Docker, informe o nome do container (ex: `configs-development-app-1`). Deixe vazio para usar o PHP do host.

### CapMonster (resolver captcha no HAR capture)

O `pipeline_browser_capture` carrega a extensão [CapMonster](https://capmonster.cloud/) (versionada em `resources/capmonster/`) para resolver captchas durante a gravação do HAR. **Configure uma vez por máquina:**

1. Rode qualquer `pipeline_browser_capture` (ou execute `/auto` uma vez) — vai abrir o Chromium com a extensão carregada.
2. Clique no ícone de extensões (peça de quebra-cabeça) na barra do navegador, fixe a CapMonster.
3. Abra o popup da CapMonster, cole sua **Client Key** do [dashboard](https://dashboard.capmonster.cloud/) e salve.
4. Pode fechar — a chave fica salva em `browser-profile/` (gitignored) e persiste entre execuções.

> A extensão é usada **apenas no HAR capture**. O código PHP em produção usa o solver próprio embutido nas classes-base da CND.

## Uso

### Modo autônomo (recomendado)

Abre o Claude Code na pasta do projeto e executa:

```
/loop /auto
```

O agente busca tarefas no Redmine, processa cada uma pelo pipeline completo e commita automaticamente. A fila de tarefas é atualizada uma vez por dia de forma automática.

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
| `pipeline_get_state` | Retorna o estado atual do pipeline de uma tarefa |

## Desenvolvimento

```powershell
npm run dev   # compila TypeScript em modo watch
npm run build # build único
```

Após qualquer alteração no código, rebuilde e reinicie o servidor MCP no Claude Code (`/mcp` → restart).
