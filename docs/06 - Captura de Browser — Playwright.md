# 06 - Captura de Browser — Playwright

← Voltar para [[CND Automation — Documentação Técnica|Home]] · tool: `pipeline_browser_capture` (`src/tools/browser.ts`)

O objetivo da captura **não** é "usar o site" — é **gravar o tráfego HTTP** do portal num HAR para que a classe PHP consiga replicar as requisições depois. O browser é só o meio para navegar e disparar esse tráfego.

---

## Como o browser é iniciado

`chromium.launchPersistentContext(BROWSER_PROFILE_DIR, …)` — contexto **persistente** (obrigatório para carregar extensão *unpacked*). Características:

- **Profile persistente** em `browser-profile/` (gitignored), compartilhado com o [[07 - Fallback AHK — OCR + AutoHotkey|fallback AHK]]. Acumula cookies/histórico/fingerprint ao longo dos runs — melhora o score em proteções tipo Cloudflare. A **Client Key da CapMonster** também fica salva aqui.
- **Extensão CapMonster** carregada via `--load-extension` de `resources/capmonster/` (resolve captcha durante a gravação). Ver [[12 - Captcha — CapMonster e Solver PHP]].
- **HAR `mode="full"` + `content="embed"`** — bodies HTML/JSON/PDF inline (exigência do PHP downstream `loadHiddenFieldsFromString`).
- **Stealth básico** via `addInitScript`: `navigator.webdriver=false`, plugins/idiomas fake, `--disable-blink-features=AutomationControlled`, user-agent Chrome 120, locale `pt-BR`, viewport 1920×1080, `slowMo: 300`.
- **Bloqueio de assets pesados**: `image`/`stylesheet`/`font`/`media` são abortados via `page.route` — **exceto** hosts de captcha (whitelist: recaptcha, gstatic, hcaptcha, `challenges.cloudflare.com`), que precisam de imagens/CSS/fontes para o solver classificar os tiles.
- `headless: false` está **hardcoded** (o portal precisa de browser visível para a CapMonster). A env `BROWSER_HEADLESS` existe no config mas não é usada por este caminho. Ver [[17 - Limitações, Riscos e Roadmap]].

---

## `nav_steps` — dirigindo a navegação

A skill monta `nav_steps` a partir da seção **"Instrução Emissão No site"** da tarefa: **cada linha vira 1 step**, na mesma ordem.

### Actions baseadas em texto (preferenciais)
Mapeiam direto para os textos entre aspas na instrução — não exigem inspecionar HTML.

| Action | Campos | Exemplo de instrução |
|--------|--------|----------------------|
| `click_text` | `text` | `Clicar em "buscar"` → `{action:"click_text", text:"buscar"}` |
| `fill_field` | `label`, `value` | `Digitar o CNPJ "..."` → `{action:"fill_field", label:"CNPJ", value:"46201083002474"}` |
| `select_text` | `label`, `value` | `Natureza "Mobiliário (Empresas)"` → `{action:"select_text", label:"Natureza", value:"Mobiliário (Empresas)"}` |

Resolução interna: `click_text` tenta locators por *role* (button/link/menuitem), depois `input[value]`, `a:has-text`, `getByText`. `fill_field` tenta `getByLabel`, placeholder, name/id, e por fim XPath de input vizinho ao texto (forms legados GeneXus/ASP). `select_text` casa a *option* por texto visível, com fallback por value.

### Actions baseadas em seletor (fallback)
`goto` (url), `fill` (selector,value), `click` (selector), `select` (selector,value), `wait` (ms), e para iframes `frame_fill` / `frame_click` (selector + `frame_url` por substring — ex.: `frame_url:"/iframe/municipal"` ou `recaptcha/api2/anchor`; polling 6×1s).

### Múltiplas abas / popups
`page_index` direciona o step: `0` (default) é a aba principal, `1+` são popups abertos via `window.open`/`target="_blank"`. Todas as requisições caem no **mesmo HAR**. O output `popup_pages` confirma quantos foram detectados.

### Digitação realista
`fill_field`/`fill` limpam o campo e digitam **caractere a caractere** com delay (~80ms) — passa por máscaras JS e parece humano.

---

## Captura de PDF (dupla estratégia)

1. **Inline** via `page.on('response')`: Content-Type `pdf`/`octet-stream` + status 200 → valida magic bytes `%PDF-`.
2. **Download** via `page.on('download')`: Content-Disposition attachment → salva e valida magic bytes; se não for PDF de verdade, apaga.

Salvo em `WORK_DIR/har/{task_id}.pdf` e devolvido em `pdf_path`. Como a certidão sai depois do último step, **presença de `pdf_path` ≈ fluxo completou**. (Mas a falha real só é constatada no [[09 - Geração e Teste do Código PHP|pipeline_test]].)

---

## Resiliência e diagnóstico

- **Auto-retry interno por step**: cada step roda 2x (pausa de 1.5s entre elas). Mantém o erro original em caso de falha — limite de 2 tentativas por controle de custo.
- **`failed_step`** + **`failure_reason`**: índice e mensagem do step que falhou.
- **`diagnostics`** (snapshot textual no momento da falha — alternativa ao screenshot):
  - `current_url`, `page_title` — detecta redirect inesperado (login, manutenção, captcha bloqueando).
  - `visible_elements` — até 60 botões/links/inputs/selects visíveis com `text`/`label`/`name`/`id`/`type`. Comparar com a instrução para achar o nome real do elemento.
  - `dom_snippet` — body HTML truncado em 8 KB.

> Na falha, a skill usa `diagnostics.visible_elements` para corrigir **só o step que falhou** (não refaz o `nav_steps` inteiro). Limite: 2 tentativas, depois cai no [[07 - Fallback AHK — OCR + AutoHotkey|AHK]].

---

## Output

```ts
{ har_path, pdf_path?, popup_pages?, failed_step?, failure_reason?, diagnostics? }
```
`har_path` **sempre** vem preenchido, mesmo em falha — os steps que rodaram já estão capturados (HAR parcial é útil, ver [[05 - Skill auto — Orquestrador]]).

---

## Sinais de detecção de bot (para decidir o fallback)

- `page_title` contém "Um momento"/"Just a moment"/"Verifying" → Cloudflare challenge interativo (a tool AHK auto-estende a espera de 15s→45s).
- `dom_snippet` referencia `cdn-cgi/challenge-platform` → Cloudflare.
- `visible_elements` quase vazio + DOM trivial (`<flt-*>`, `main.dart.js`, canvas) → **Flutter Web canvas-rendered**. Aqui a tool **não** auto-estende: coloque `wait` ≥ **15000ms** entre o `goto` e o primeiro campo (o Flutter precisa pintar o canvas + carregar fontes antes da OCR achar os campos).

---

## Veja também
- [[07 - Fallback AHK — OCR + AutoHotkey]] — quando e como cai no Chrome real.
- [[08 - Extração e Interpretação de HAR]] — o que acontece com o HAR depois.
- [[12 - Captcha — CapMonster e Solver PHP]] — as duas camadas de captcha.
