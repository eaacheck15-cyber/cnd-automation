# 08 - Extração e Interpretação de HAR

← Voltar para [[CND Automation — Documentação Técnica|Home]] · tools: `pipeline_extract_har` (`src/tools/extract.ts`), `pipeline_interpret_flow` (`src/tools/interpret.ts`)

Duas etapas puramente determinísticas (sem rede, sem LLM) que transformam o HAR bruto da [[06 - Captura de Browser — Playwright|captura]] num fluxo classificado que orienta a [[09 - Geração e Teste do Código PHP|geração do PHP]].

---

## `pipeline_extract_har` — filtragem

Lê o `.har`, percorre `log.entries` e mantém só o que importa:

- **Só `GET`/`POST`** (outros métodos descartados).
- **Remove assets** por extensão: `css js png jpg jpeg gif svg woff woff2 ico map`.
- **Headers**: mantém só `content-type`, `origin`, `referer`, `cookie`.
- **Payload**: usa `postData.text`; se ausente, reconstrói de `postData.params` como query-string `name=value&…`.
- **Cookies** e **query string** são extraídos por entrada.

Saída: array cronológico de `FlowStep` numerados.

```ts
interface FlowStep {
  step: number; method: string; url: string;
  query: string | null;
  headers: Record<string,string>;   // só os 4 permitidos
  cookies: Record<string,string>;
  payload: string | null;
  status: number | null;
}
```

> O HAR gerado pelo [[07 - Fallback AHK — OCR + AutoHotkey|fallback AHK]] tem o mesmo formato `log.entries`, então passa por aqui sem ajuste.

---

## `pipeline_interpret_flow` — classificação

Recebe o `flow[]` e devolve `{ flow_type, steps: { type, step }[] }`. Aceita `artisan_feedback?` opcional para refinar numa retentativa (atualmente não usado pelo `/auto`, que ajusta o PHP diretamente).

### FlowType global

| FlowType | Critério |
|----------|----------|
| `LOGIN_CERT` | URL com `sso.acesso.gov.br`/`certificado.sso.acesso.gov.br`, ou `client_id` + `authorization`/`oauth` |
| `LOGIN_FORM` | payload com `usuario`/`senha`/`password` |
| `PROTOCOLO` | mesma `método:url` aparece 2+ vezes (polling) |
| `CAPTCHA` | `cf-turnstile`/`hcaptcha` na URL, ou `cf-turnstile-response`/`h-captcha-response` no payload |
| `HIBRIDO` | 2+ critérios acima combinados |
| `DIRETO` | nenhum dos acima |

### Tipos de bloco (por step)

`INIT` · `AUTH` · `CONSULTA` · `EMISSAO` · `POLLING` · `DOWNLOAD` · `VALIDACAO`

Regras de `classifyStep` (em ordem de prioridade):

1. **POLLING** — `método:url` repetida (a partir da 2ª ocorrência).
2. **INIT** — primeiro `GET` sem payload (inicialização de sessão).
3. **AUTH** — `sso.acesso.gov.br`, `/oauth`, `/login`, `/auth`, `client_id`, ou `usuario`/`senha`/`password` na URL/payload.
4. **DOWNLOAD** — URL com `/download`, `/pdf`, termina em `.pdf`, casa `certid(ão|...)`, ou `content-type: application/pdf`.
5. **CONSULTA** — `POST` com `cnpj`/`cpf`/`cgc`/`inscricao`/`registration` no payload.
6. **EMISSAO** — qualquer outro `POST`.
7. **INIT** — GET restante após o primeiro INIT (tokens, páginas intermediárias).

Ao final, um bloco **`VALIDACAO`** é sempre anexado como último passo lógico — mapeia para o `processIssuance()` no PHP (sem step HTTP correspondente), onde se atribui `situation`/`expirationDate`/`protocolNumber`. Ver [[15 - Convenções das Classes Certificate]].

---

## Por que isso importa

A `base_class` é detectada por URL na [[09 - Geração e Teste do Código PHP|geração]], mas o `flow_type` + os blocos dão ao Claude o **esqueleto** do fluxo: onde tem login, onde tem polling de protocolo, onde baixa o PDF. Isso guia quais métodos privados a classe precisa (`solveCaptcha`, `requestCnd`, `getUrlPdf`, etc.).

---

## Veja também
- [[06 - Captura de Browser — Playwright]] — origem do HAR.
- [[09 - Geração e Teste do Código PHP]] — consumo da interpretação.
- [[Glossário]] — definição de cada bloco e FlowType.
