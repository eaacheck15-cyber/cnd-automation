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

## Redmine — transições de status

Não dá pra pular direto de **Ag. Desenv. (56)** pra **Ag. Review (84)** — o Redmine aceita a chamada mas o status não muda. A sequência válida é:

1. `56` Ag. Desenv. → `57` Em Desenv. (ao começar a trabalhar)
2. `57` Em Desenv. → `84` Ag. Review (ao concluir)

Se a tarefa estiver em Ag. Desenv. e precisar ir pra Ag. Review, faça **duas chamadas** de `redmine_update_task` em sequência: primeiro `status_id: "57"`, depois `status_id: "84"`.

## Notas no Redmine — formato padrão

Toda chamada de `redmine_update_task` que adiciona `notes` (commit/encerramento de tarefa, não a transição inicial pra "Em Desenv.") deve seguir **exatamente** este template:

```
Alterações realizadas:
> {Implementação da classe {ClassName} para emissão automática de certidão.
   | Correção da classe {ClassName} — {descrição curta do que foi corrigido.}}

Projetos e Arquivos Modificados:
> cnd — {caminho relativo do arquivo PHP}
> cnd — config/certificates.php

Branch: cnd-automation
```

A linha `Branch: cnd-automation` é **obrigatória** — sinaliza ao revisor de qual branch do repo `cnd` ele deve abrir o merge request. O `pipeline_commit` sempre commita em `cnd-automation` (valor de `GIT_BRANCH` no `.env`); não inventar outro nome.

Sem prosa adicional, sem detalhes técnicos de fluxo/teste — esse formato curto é o que o time consome. Detalhes técnicos vão no commit message, não na nota do Redmine.

## Pipeline — sempre usar as tools `pipeline_*`

Não rodar `php artisan` direto nem invocar steps manualmente. Use `mcp__cnd-pipeline__pipeline_*` (discover, browser_capture, extract_har, interpret_flow, generate_code, test, commit).

Ao passar CNPJ/CPF para `pipeline_test` (parâmetro `cnpj`), sempre **só dígitos**, sem pontos, barras ou hífens. O insert em `listaespera` espera o valor cru.

### Fallback AHK — `pipeline_browser_capture_ahk`

Quando o `pipeline_browser_capture` (Playwright) falha 2x, a **3ª tentativa é o AHK** sempre que os `nav_steps` forem 100% baseados em texto (`goto`, `wait`, `click_text`, `fill_field`, `select_text`) — independente da causa aparente da falha. Se algum step usa `selector` ou `frame_*`, o AHK rejeita; nesse caso pular direto pro HAR-parcial.

Sinais que confirmam Cloudflare/canvas (use pra ajustar a chamada, não pra decidir SE chama):
- `diagnostics.page_title` contém `"Um momento"` / `"Just a moment"` / `"Verifying"` → Cloudflare challenge interativo (a tool auto-estende espera de 15s pra 45s)
- `dom_snippet` referencia `cdn-cgi/challenge-platform` → Cloudflare
- `visible_elements` quase vazio + DOM trivial (`<flt-*>`, `main.dart.js`, canvas) → Flutter Web canvas-rendered — **a tool NÃO auto-estende a espera**. Coloque `wait` de pelo menos **15000ms** entre o `goto` e o primeiro `fill_field`/`click_text` (Flutter precisa pintar o canvas + carregar fontes Material/CupertinoIcons antes da OCR achar os campos). Se voltar `failed_step` no primeiro campo com 6s de espera, suba pra 15s e retente — em vez de assumir que a OCR não funciona.

Profile persistente em `browser-profile/` é compartilhado com o Playwright e acumula cookies/histórico ao longo dos runs. Detalhes completos no PASSO 6 do [.claude/skills/auto/SKILL.md](.claude/skills/auto/SKILL.md).

## Estilo das classes `Certificate*` — orquestração, não script

Toda classe gerada deve seguir o padrão do restante do projeto (ex.: `CertificateTRF4ProcessosDistribuidos`):

- `startIssuance()` **só orquestra** — chama métodos privados com nomes que descrevem a etapa (`initSession`, `solveCaptcha`, `requestCnd`, `getUrlPdf`, etc.). Nunca tem `$this->http->...` direto e **nunca chama `issuePDF()` direto** (o `issuePDF()` é invocado pela classe-base depois do `startIssuance()`). Mesmo quando o fluxo é trivial (só 1 GET pro endpoint que já devolve o PDF), `startIssuance()` deve chamar pelo menos um método privado de inicialização — `initSession()` com um GET na home ou no endpoint de "registrar dispositivo"/cookie inicial — pra manter o padrão de orquestração.
- `issuePDF()` também é orquestração, **mas** pode ter um `$this->http->...` direto quando for só a request final que baixa o PDF (ex.: `$response = $this->http->get($this->urlPdf); if (stringIsPdf($response->body)) $this->downloadPDF($response->body);`). Lógica de várias etapas dentro dele continua proibida.
- Dentro de cada método privado, **use bom senso**: se duas/três requests fazem parte da mesma etapa lógica (ex.: um GET pra carregar form + POST do form na mesma sessão), pode deixá-las juntas pra não fragmentar demais. Se forem etapas distintas, vira um método por request.
- Payloads de POST vão em `getParams*()` privados, headers em `requestHeaders*()`.
- Parsing/extração de campos da resposta também em métodos próprios (`loadHiddenFields`, `getPossibleErrors`, `fixHtml`, etc.).
- **Nomes canônicos:** quando o site não entrega PDF e a gente monta o HTML pra `generatePDF`, o método chama-se **`fixHtml`** (~140 ocorrências no projeto). Não inventar `buildHtml`/`renderHtml`/etc.

### Ordem dos membros dentro da classe

Mantenha **sempre** esta ordem de cima pra baixo — agrupa o que é configuração no topo e o que é comportamento embaixo, e torna o diff de review previsível:

1. **URLs** — propriedades `$url*` (`$urlInit`, `$urlCaptcha`, `$urlPdf`, etc.).
2. **Headers** — métodos `requestHeaders*()` privados que devolvem array de headers HTTP.
3. **Payloads** — métodos `getParams*()` privados que montam o body de POSTs.
4. **Funções gerais** — `startIssuance()`, demais métodos privados de etapa (`initSession`, `solveCaptcha`, `requestCnd`, etc.), helpers (`loadHiddenFields`, `getPossibleErrors`, `fixHtml`) e `processIssuance()` por último.

Sintoma comum de classe gerada fora do padrão: o "header" de URLs aparecendo **embaixo** dos métodos — sempre que isso acontecer, reordene antes de chamar `pipeline_test`.

## Registro em `config/certificates.php`

O array tem três seções comentadas (`FEDERAL`, `ESTADUAL`, `MUNICIPAL`); a seção MUNICIPAL é subdividida por UF com cabeçalhos `// AC`, `// AL`, `// AM`, etc.

Ao inserir uma nova classe (manualmente ou após `pipeline_test`/`pipeline_commit`):
- Inserir **dentro da seção da esfera certa** (Federal / Estadual / Municipal).
- Para Municipal, dentro do bloco da UF correspondente (`// PR`, `// SP`, etc.).
- **Ordem alfabética** (case-insensitive) dentro do bloco.
- **Nunca** deixar a entrada no final do arquivo "solta" — é o sintoma típico de um append automático que precisa ser realocado.

Isso vale para **toda** geração de classe, não só refactor. Se a classe gerada não estiver assim, refatore antes de testar.

## Commits — um único commit por tarefa, sempre em `cnd-automation`

Toda execução do `/auto` (sucesso ou ajuste pós-test) deve resultar em **um único commit** no repo `cnd`, na branch **`cnd-automation`**, com a mensagem padrão do `pipeline_commit` (`#{task_id} - {task_subject}`).

- **Antes de chamar `pipeline_commit`**: confira a branch (`git -C C:/Workspace/cnd branch --show-current`). Se não estiver em `cnd-automation`, faça `git -C C:/Workspace/cnd checkout cnd-automation` (a branch precisa existir — se não existir, criar a partir de `develop`). O `pipeline_commit` commita na branch atual; ele NÃO troca de branch sozinho, mesmo o `GIT_BRANCH=cnd-automation` no `.env` apontando pra ela.
- Não fragmentar em commits separados de "fix entry order", "refactor após feedback", etc. — se foi preciso ajustar o código gerado depois do `pipeline_commit` (mover entry em `config/certificates.php`, refatorar `startIssuance`, etc.), faça `git reset --soft HEAD~N` e recommite tudo junto.
- Depois do commit consolidado, `git push origin cnd-automation` para subir o trabalho do dia.

## PDF e classificação regular/irregular

- **Sempre que houver PDF disponível, baixar e salvar** (`downloadPDF` / `generatePDF`). PDF gerado fica arquivado em qualquer caso (regular ou irregular).
- **Caminho padrão de classificação:** `processIssuance()` é onde se atribui `$this->situation`, `$this->expirationDate` e `$this->protocolNumber`, lendo o PDF/dados já capturados. Use isso como default.
- **`protocolNumber` ausente:** quando nem o PDF nem a tarefa do Redmine indicam onde extrair o número de protocolo (alguns órgãos simplesmente não emitem), atribua `$this->protocolNumber = "S/N"`. Não inventar regex, não deixar vazio, não tentar derivar de outros campos.
- **Exceção — `saveCertificateRegular` / `saveCertificateIrregular` dentro de um fetch:** só quando a própria resposta do site **já carrega uma mensagem que certifica a situação sem gerar PDF** (ex.: TRF4 retorna "Nenhum processo com movimentação foi localizado" no HTML antes de qualquer PDF). Nesses casos, o helper salva o conteúdo textual como "certidão" e curto-circuita. Não é o caminho padrão; é para quando o site simplesmente não entrega PDF naquele cenário.

## Como me treinar (para todos os devs)

Memória de time está versionada neste repo:
- **Regra dura, vale pra todo mundo** → editar este `CLAUDE.md` (PR review obrigatório).
- **Contexto longo / referência** → criar arquivo em `.claude/knowledge/` e linkar daqui.
- **Preferência pessoal** → ficar na memória local do dev (`~/.claude/projects/.../memory/`).

Quando eu errar durante `/auto`, corrija na hora explicando *por quê*. Se a lição valer pra todos, vire PR neste arquivo.
