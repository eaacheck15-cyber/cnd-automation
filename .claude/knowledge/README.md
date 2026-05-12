# .claude/knowledge/

Documentos de contexto longo para o Claude — lidos **sob demanda**, não em toda conversa.

## Diferença para `CLAUDE.md`

- [`CLAUDE.md`](../../CLAUDE.md) — carregado em toda conversa. Regras curtas e duras. Custa tokens em **toda** tarefa.
- Este diretório — só lido quando a tarefa pede. Pode ter texto longo (arquitetura, histórico, decisões).

## Quando criar um arquivo aqui

- Documento de arquitetura ou fluxo (ex: `pipeline.md`, `redmine-flow.md`)
- Histórico de decisões técnicas que ajudam o Claude a entender o "porquê" de partes do código
- Catálogo de gotchas específicos de um portal/órgão (ex: `portal-sefaz-sp.md`)

## Como referenciar

No `CLAUDE.md` (ou em outro arquivo de knowledge), linkar explicitamente:

> Para detalhes do fluxo do pipeline, veja [.claude/knowledge/pipeline.md](.claude/knowledge/pipeline.md).

Assim eu sei que existe e leio quando a tarefa for relevante.

## Revisão

Mudanças aqui são documentação — review mais leve que `CLAUDE.md`, mas ainda via PR para outros devs verem.
