# CND Automation — instruções para o Claude

Este arquivo é carregado automaticamente em toda conversa neste repositório. Mantenha-o **curto e de alto valor** — regras que valem para todo dev, em toda tarefa. Detalhes longos vão em [.claude/knowledge/](.claude/knowledge/) e são lidos sob demanda.

## Stack e ambiente

- O projeto consumido pela pipeline (`C:\Workspace\cnd`) usa **Laravel 6 + PHP 7.4**. Esse é o setup oficial e definitivo — não sugerir upgrade de Laravel nem outra versão de PHP.
- Se `pipeline_test` falhar com erros tipo `Return type of ... should be compatible with ArrayAccess` ou `ReflectionParameter::getClass() is deprecated`, o `php.exe` da pipeline está em PHP 8+. Reportar como problema de configuração de ambiente e parar — não propor workaround no código.

## Captcha — duas camadas

1. **HAR capture** (`pipeline_browser_capture`): Chromium com extensão CapMonster carregada de `resources/capmonster/`. Pago, usado só para gravar o tráfego.
2. **Execução real** (`pipeline_test` → `php artisan issue`): a CND tem solver de captcha próprio em PHP nas classes-base.

Regras:
- **Nunca** sugerir integrar CapMonster no PHP gerado — a CND já tem solver próprio.
- O limite de 2 tentativas no HAR capture é controle de custo, não bug. Não aumentar sem conversar.
- Falha de captcha em `artisan issue` → problema no solver PHP / herança da classe-base, não na extensão.

## Pipeline — sempre usar as tools `pipeline_*`

Não rodar `php artisan` direto nem invocar steps manualmente. Use `mcp__cnd-pipeline__pipeline_*` (discover, browser_capture, extract_har, interpret_flow, generate_code, test, commit, run, get_state).

## Como me treinar (para todos os devs)

Memória de time está versionada neste repo:
- **Regra dura, vale pra todo mundo** → editar este `CLAUDE.md` (PR review obrigatório).
- **Contexto longo / referência** → criar arquivo em `.claude/knowledge/` e linkar daqui.
- **Preferência pessoal** → ficar na memória local do dev (`~/.claude/projects/.../memory/`).

Quando eu errar durante `/auto`, corrija na hora explicando *por quê*. Se a lição valer pra todos, vire PR neste arquivo.
