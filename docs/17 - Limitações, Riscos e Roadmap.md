# 17 - Limitações, Riscos e Roadmap

← Voltar para [[CND Automation — Documentação Técnica|Home]]

Pontos de atenção do estado atual (não bloqueadores para uso supervisionado, mas dívida técnica a tratar).

---

## Limitações conhecidas

| Categoria | Limitação | Impacto |
|-----------|-----------|---------|
| **Browser** | `headless: false` hardcoded em `browser.ts` (a env `BROWSER_HEADLESS` não é usada nesse caminho) | não roda em servidor headless; depende de display |
| **Browser** | `slowMo: 300` ms fixo | performance limitada por design (parece humano) |
| **Browser** | `--no-sandbox`, `--disable-web-security`, `--ignore-certificate-errors` | adequado só para ambiente de dev confiável |
| **Browser** | `browser-profile/` cresce indefinidamente | sem política de cleanup |
| **AHK** | janela do Chrome precisa ficar em **foreground** durante todo o run | o PC não pode ser usado enquanto roda |
| **AHK** | só actions de texto; ~500ms a mais por step (OCR) | cobertura e velocidade limitadas |
| **Captcha** | CapMonster exige Client Key manual por máquina | setup manual; é pago |
| **Test** | sucesso detectado por **substring** em `artisan_output` | falso-positivo/negativo possível |
| **Test** | `artisan issue` com timeout 120s | pode falhar em portais lentos |
| **Redmine** | sem retry/backoff em 429/5xx | falha imediata sob throttling |
| **Redmine** | fila com `limit=100` | tarefas além das 100 não entram (mitigado pelo filtro status 56) |
| **Estado** | HARs/PDFs em `WORK_DIR/har/` nunca limpos | crescimento indefinido |
| **Git** | `commit.ts` não trata conflito de rebase | falha se o `pull --rebase` der conflito |
| **Ambiente** | depende de Docker de pé (`configs-development-app-1`) e Mongo | se o container cai, `pipeline_test` quebra |
| **Acoplamento** | knowledge base e classes vivem no repo CND | forte acoplamento entre os dois repos |
| **Segurança** | API key Redmine e webhook Google Chat em env/settings | risco se vazarem (tratar como senha) |
| **Doc da tool** | descrição de `pipeline_commit` cita `CND_BLOCKS_MEMORY.json` que não é mais commitado | confunde quem lê só a descrição |

---

## Pré-requisito crítico de ambiente

O repo CND é **Laravel 6 / PHP 7.4** — setup oficial e definitivo (não sugerir upgrade). O `pipeline_test` **deve** rodar no Docker (PHP 7.3.33). Se o `artisan_output` mostrar erros de `ArrayAccess`/`ReflectionParameter::getClass` ou paths do host, o MCP está usando PHP do host → **reiniciar o MCP** (env só lida no spawn). Ver [[05 - Skill auto — Orquestrador]] e [[13 - Configuração — Variáveis de Ambiente]].

---

## Roadmap sugerido

### Curto prazo (estabilização)
1. Usar de fato a flag `BROWSER_HEADLESS` (já existe no config).
2. Política de cleanup para `WORK_DIR/har/` e `browser-profile/`.
3. Retry com backoff no `redmine.ts` para 429/5xx.
4. Endurecer a heurística de sucesso do `pipeline_test` (além de substring).
5. Atualizar a descrição de `pipeline_commit` em `index.ts` (remover menção ao `CND_BLOCKS_MEMORY.json`).

### Médio prazo (escala)
6. Métricas estruturadas (`success_rate`, `avg_attempts`, categorias de falha) lendo logs/fila.
7. Tratamento de conflito de rebase no `commit.ts`.
8. Suíte de testes unitários para funções puras: `discover.ts`, `extract.ts`, `interpret.ts`, `ocr.ts` (com fixtures de HAR/PNG).

### Longo prazo
9. Separar knowledge base em repo/submodule próprio.
10. Aprovação humana opcional antes do commit (toggle).
11. Generalizar para outros projetos além do CND.

---

## Veja também
- [[02 - Stack, Estrutura e Build]] — onde mexer.
- [[14 - Operação e Agendamento]] — riscos operacionais do agendamento.
- [[Glossário]]
