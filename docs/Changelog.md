# Changelog da Documentação

← Voltar para [[CND Automation — Documentação Técnica|Home]]

Registro automático das atualizações desta documentação. Cada entrada é gerada pela skill `/update-docs` (rodada todo dia às 18:00 via Task Scheduler), a partir dos commits novos do repo `cnd-automation`. Entradas mais recentes no topo.

---

## 2026-05-27 (sync `7db60ad..3ad0f4a`)

Commits sincronizados (`7db60ad..3ad0f4a`):
- `61e1086` docs: documentacao do projeto no Obsidian (docs/) + skill /update-docs diaria
- `9a2ff73` feat: fila do /auto filtra por status (Ag. Desenv.) e pula Em Teste
- `6ddaa7f` chore: script de bootstrap do browser (setup-browser.ps1)
- `3ad0f4a` revert: remove setup-browser.ps1 (nao necessario no projeto)

Notas atualizadas: nenhuma (a documentacao criada em `61e1086` ja refletia o filtro de fila de `9a2ff73`; commits `6ddaa7f`/`3ad0f4a` cancelam-se mutuamente).

---

## 2026-05-27

Geração inicial completa da documentação (manual), sincronizada com o commit `7db60ad`.

Notas criadas/atualizadas:
- [[CND Automation — Documentação Técnica]] (Home/índice) e todas as notas `01`–`17`
- [[Glossário]]
- [[Pipeline CND - Fluxograma]] → convertida em redirecionamento para [[03 - Pipeline — Fluxo Completo]]

A partir daqui, as atualizações passam a ser **incrementais e diárias** (só as notas afetadas pelos commits do dia). Estado de sincronização em `cnd-automation/.claude/docs_sync_commit`.
