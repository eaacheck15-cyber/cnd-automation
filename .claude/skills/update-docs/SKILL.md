---
description: Mantém a documentação do projeto no vault do Obsidian fiel ao estado atual do repo cnd-automation. Levanta TODAS as alterações líquidas desde a última sincronização (git diff --name-only último..HEAD, cobrindo todos os commits do intervalo), e para cada arquivo afetado reconcilia a nota lendo o arquivo-fonte ATUAL — não confia num único commit. Atualiza só as notas afetadas e registra no Changelog. Agendado via Task Scheduler do Windows (scripts/install-docs-task.ps1) para rodar todo dia às 18:00.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
---

## Atualização da documentação (Obsidian) — modo autônomo

Você mantém a documentação técnica do projeto `cnd-automation` (que vive no **vault do Obsidian**) **fiel ao estado atual do projeto**. Execute cada passo na ordem, sem pedir confirmação.

**Princípio central:** não basta olhar "o último commit". O objetivo é pegar **todas as alterações desde a última sincronização** (passando por todos os commits no intervalo) e, para cada área tocada, **comparar a documentação contra o código como ele está AGORA** — lendo os arquivos-fonte atuais — em vez de aplicar o texto de um diff cegamente. Assim nenhuma mudança importante de um commit intermediário passa sem verificação, e reverts/idas-e-vindas refletem o estado líquido real.

### Caminhos fixos

- **Repo documentado:** `C:\Workspace\cnd-automation`
- **Vault (destino das notas):** `C:\Workspace\cnd-automation\docs` — fica **dentro** do repo (versionado, o time clona e abre `docs/` como vault no Obsidian).
- **Estado (último commit já documentado):** `C:\Workspace\cnd-automation\.claude\docs_sync_commit` (texto puro, um hash; gitignored)
- **Changelog:** `docs\Changelog.md`

> As notas são escritas **direto no disco** em `docs\` (o Obsidian indexa ao abrir; não depende de ele estar rodando). Como `docs\` fica dentro do repo (= diretório de trabalho do run), **não** é preciso `--add-dir`. As notas ficam em `docs\{nome da nota}.md` (ex.: `docs\04 - Tools MCP — Referência.md`).

> ⚠️ **Cada chamada de shell é independente** — variáveis PowerShell (`$head`, `$last`, …) **não** sobrevivem entre invocações de tool. Sempre que um passo precisar de um valor obtido antes, use o **hash literal** que você anotou (não confie em `$variavel` de um passo anterior).

---

### PASSO 1 — Determinar a baseline (até onde já foi documentado)

Rode **tudo numa só invocação** (os valores precisam coexistir no mesmo shell):

```powershell
$repo = "C:\Workspace\cnd-automation"
$statePath = Join-Path $repo ".claude\docs_sync_commit"
$head = (git -C $repo rev-parse HEAD).Trim()
# leitura tolerante a BOM (U+FEFF) e a espaços/quebras
$last = if (Test-Path $statePath) { (Get-Content $statePath -Raw).Trim([char]0xFEFF).Trim() } else { "" }
# baseline é válida só se o commit ainda existe no histórico
$valid = $false
if ($last) { git -C $repo cat-file -e "$last^{commit}" 2>$null; $valid = ($LASTEXITCODE -eq 0) }
"HEAD=$head"; "LAST=$last"; "VALID=$valid"
```

**Anote `HEAD` e `LAST` como hashes literais** — você vai colá-los nos comandos dos próximos passos (variáveis de shell não persistem entre chamadas).

- Se `$valid` é true **e** `$last` == `$head`: **nada mudou desde a última sincronização** → exiba "📭 Sem alterações novas desde a última sincronização." e **encerre** (não escreva nada, não mexa no Changelog, não altere o estado).
- Se `$last` estiver **vazio** OU `$valid` for **false** (estado perdido / baseline reescrita / primeiro run sem baseline): faça uma **reconciliação completa** — trate todos os arquivos-fonte documentáveis como "a verificar" e confira nota por nota contra o estado atual (mais pesado; é o fallback de segurança). Não tente adivinhar uma baseline com `HEAD~1`, pois isso ignoraria commits anteriores. Ao final, grave o `HEAD` no estado (PASSO 6).
- Caso contrário (baseline válida e diferente do HEAD): a baseline é `LAST` e o alvo é `HEAD` (o estado atual). O conjunto de mudanças é avaliado **ponta a ponta** (`LAST..HEAD`), cobrindo **todos** os commits no meio.

---

### PASSO 2 — Levantar TODAS as alterações líquidas (não commit a commit)

Use a comparação **ponta a ponta** entre a baseline e o estado atual — isso reúne as mudanças de **todos** os commits do intervalo de uma vez (e neutraliza idas-e-vindas: se um arquivo mudou e voltou, ele não aparece; se mudou em vários commits, vale o estado final). **Substitua `{LAST}` e `{HEAD}` pelos hashes literais do PASSO 1:**

```powershell
git -C C:\Workspace\cnd-automation diff --name-only {LAST}..{HEAD}   # conjunto COMPLETO de arquivos alterados (líquido)
git -C C:\Workspace\cnd-automation log  --oneline   {LAST}..{HEAD}   # lista de commits — só para o Changelog
```

Monte a lista de **arquivos alterados** a partir do `--name-only` (essa é a fonte da verdade de "o que mudou", não o último commit). Guarde também os **subjects dos commits** para o Changelog.

Ignore mudanças que **não afetam a documentação**: `dist/`, `package-lock.json`, `browser-profile/`, arquivos em `resources/capmonster/`, `resources/tessdata/`, `logs/`, `.claude/auto_count`, `.claude/docs_sync_commit`.

---

### PASSO 3 — Mapear arquivos → notas afetadas

Use este mapa (arquivo do repo → nota no vault). Uma mudança pode tocar mais de uma nota.

| Arquivo(s) alterado(s) | Nota(s) a revisar |
|---|---|
| `src/index.ts` (registro/descr. de tools) | `04 - Tools MCP — Referência` (+ a nota da etapa específica) |
| `src/tools/discover.ts` | `04 - Tools MCP — Referência`, `08 - Extração e Interpretação de HAR` |
| `src/tools/browser.ts` | `06 - Captura de Browser — Playwright` |
| `src/tools/browser_ahk.ts`, `src/tools/ocr.ts`, `resources/ahk/runner.ahk` | `07 - Fallback AHK — OCR + AutoHotkey` |
| `src/tools/extract.ts`, `src/tools/interpret.ts` | `08 - Extração e Interpretação de HAR` |
| `src/tools/generate.ts`, `src/tools/test.ts`, `src/tools/commit.ts` | `09 - Geração e Teste do Código PHP` |
| `src/tools/redmine.ts` | `10 - Integração Redmine` |
| `src/tools/notify.ts` | `11 - Notificações Google Chat` |
| `src/config.ts`, `.env.example`, `.mcp.json` | `13 - Configuração — Variáveis de Ambiente` |
| `src/types.ts` | `04 - Tools MCP — Referência` (seção de tipos) |
| `scripts/*.ps1`, `stop-pipeline.ps1`, `resume-pipeline.ps1` | `14 - Operação e Agendamento` |
| `.claude/skills/auto/SKILL.md` | `05 - Skill auto — Orquestrador`, `03 - Pipeline — Fluxo Completo` |
| `.claude/skills/update-docs/SKILL.md` | `14 - Operação e Agendamento` (seção de auto-atualização) |
| `CLAUDE.md` | `12 - Captcha`, `15 - Convenções das Classes Certificate`, `16 - Knowledge Base e Memória`, `10 - Integração Redmine` (conforme a regra alterada) |
| `package.json`, `tsconfig.json`, estrutura de pastas | `02 - Stack, Estrutura e Build` |
| `README.md` | a nota correspondente ao assunto do trecho mudado |

> Use também as **mensagens dos commits** do intervalo (subjects/bodies de `git log {LAST}..{HEAD}`) como contexto para julgar a relevância de cada arquivo — um commit costuma explicar *por que* algo mudou, ajudando a decidir se a nota precisa ser ajustada. A verdade do *o que* documentar continua sendo o arquivo-fonte atual (PASSO 4).

Mudanças estruturais grandes (nova tool, novo passo na skill, novo subsistema) também podem exigir ajuste na **Home** (`CND Automation — Documentação Técnica`) e no `Glossário`.

Se nenhuma nota for afetada (ex.: só mexeram em `dist/`), **encerre** registrando no Changelog que não houve mudança documental, e atualize o estado (PASSO 6).

---

### PASSO 4 — Reconciliar SÓ as notas afetadas contra o estado ATUAL (cirúrgico, mas verificando)

Para cada arquivo alterado → cada nota mapeada:

1. **Leia o arquivo-fonte como ele está AGORA** (`Read` do `.ts`/`.ps1`/`.md`/etc. atual) — esta é a verdade. **Não** confie só no texto do diff; o diff diz *onde* olhar, o arquivo atual diz *o que* documentar.
2. Leia a nota com `Read`.
3. **Compare** o que a nota afirma com o que o código realmente faz hoje. Onde divergir, aplique **a menor edição possível** (`Edit`) que alinhe a nota à realidade — não reescreva a nota inteira.
4. **Preserve** estilo, formatação, wikilinks e diagramas Mermaid existentes. Só mexa em diagrama se o fluxo realmente mudou.
5. Não invente conteúdo: descreva exatamente o comportamento atual do arquivo.
6. Não toque em notas que não foram afetadas (nem em edições manuais não relacionadas).

Mantenha a precisão factual: se um valor mudou (default de env, número/nome de tools, ordem de um passo, novo arquivo, função renomeada), atualize a tabela/linha/diagrama exatos. Se um arquivo foi **removido**, remova/ajuste as referências a ele nas notas. Se um arquivo foi **adicionado**, verifique se merece menção (ex.: nova tool → entra na nota `04` e na nota da etapa).

---

### PASSO 5 — Registrar no Changelog

Acrescente (prepend, logo abaixo do cabeçalho) uma entrada em `{vault}\Changelog.md`:

```markdown
## {AAAA-MM-DD}

Commits sincronizados (`{last_curto}..{head_curto}`):
- `{hash_curto}` {subject}
- ...

Notas atualizadas:
- [[{nota afetada 1}]] — {o que mudou em uma linha}
- ...
```

Se nenhuma nota mudou, registre: `Notas atualizadas: nenhuma (mudança não-documental).`

---

### PASSO 6 — Gravar o novo estado

Grave o hash do **HEAD** (o literal obtido no PASSO 1) em `C:\Workspace\cnd-automation\.claude\docs_sync_commit` usando a ferramenta **Write** — conteúdo = só o hash, sem quebra de linha.

> ⚠️ **Não** use `Out-File -Encoding utf8`: no PowerShell 5.1 ele grava **BOM**, e a leitura do próximo run interpretaria o hash como inválido. A ferramenta Write grava o conteúdo exato, sem BOM. (Se precisar mesmo do PowerShell, use `[IO.File]::WriteAllText($path, $hash)`, que também não adiciona BOM.)

Exiba um resumo final: `✅ Documentação sincronizada {LAST_curto}..{HEAD_curto} — {N} nota(s) atualizada(s).`

---

### Observações

- Este fluxo **não commita** nada — só escreve os arquivos em `docs\`. As notas agora vivem **dentro do repo** (`cnd-automation/docs/`), versionadas pelo time; o **commit/push é manual** (você revisa e publica quando quiser).
- Separado deste fluxo, há o hook `post-commit` (`.git/hooks/update-obsidian-status.ps1`) que regenera `docs/00 - Status do Projeto.md` (resumo do último commit, sem IA) a cada commit. Esse arquivo é **gitignored** (não versiona, não polui o repo). Não confundir com este `/update-docs`, que é quem cobre **todas** as alterações e atualiza o conteúdo.
- O run é disparado por `scripts/docs-daily.ps1` (Task Scheduler, 18:00). Para rodar manualmente: `/update-docs` no Claude Code.
- Para forçar uma **reconciliação completa** (verificar todas as notas contra o projeto inteiro), apague `.claude/docs_sync_commit`: sem baseline, o PASSO 1 cai no fallback de reconciliação completa.
