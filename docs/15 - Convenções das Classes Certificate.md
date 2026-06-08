# 15 - Convenções das Classes Certificate

← Voltar para [[CND Automation — Documentação Técnica|Home]] · fonte: `CLAUDE.md` (regras de time) · gerado no [[09 - Geração e Teste do Código PHP|PASSO 9A]]

Toda classe PHP gerada deve seguir o padrão do restante do projeto CND (ex.: `CertificateTRF4ProcessosDistribuidos`). Não é "qualquer PHP que funcione" — o time revisa por padrão, e classe fora do padrão volta no review.

---

## Orquestração, não script

- **`startIssuance()` só orquestra** — chama métodos privados com nomes que descrevem a etapa (`initSession`, `solveCaptcha`, `requestCnd`, `getUrlPdf`, etc.). **Nunca** tem `$this->http->...` direto e **nunca chama `issuePDF()` direto** (a classe-base invoca o `issuePDF()` depois do `startIssuance()`).
  - Mesmo quando o fluxo é trivial (1 GET que já devolve o PDF), `startIssuance()` deve chamar ao menos um método privado de inicialização — ex.: `initSession()` com um GET na home — para manter o padrão.
- **`issuePDF()` também é orquestração**, **mas** pode ter um `$this->http->...` direto quando for só a request final que baixa o PDF:
  ```php
  $response = $this->http->get($this->urlPdf);
  if (stringIsPdf($response->body)) $this->downloadPDF($response->body);
  ```
  Lógica de várias etapas dentro dele continua proibida.
- Dentro de cada método privado, **bom senso**: 2–3 requests da mesma etapa lógica (GET pra carregar form + POST do form na mesma sessão) podem ficar juntas; etapas distintas viram um método por request.
- Payloads de POST → métodos `getParams*()` privados. Headers → `requestHeaders*()`. Parsing/extração → métodos próprios (`loadHiddenFields`, `getPossibleErrors`, `fixHtml`, …).
- **Nome canônico:** quando o site não entrega PDF e montamos o HTML para `generatePDF`, o método chama-se **`fixHtml`** (~140 ocorrências no projeto). **Não** inventar `buildHtml`/`renderHtml`/etc.

---

## Ordem dos membros (sempre, de cima pra baixo)

Agrupa configuração no topo e comportamento embaixo — diff de review previsível:

1. **URLs** — propriedades `$url*` (`$urlInit`, `$urlCaptcha`, `$urlPdf`…).
2. **Headers** — métodos `requestHeaders*()` privados (array de headers HTTP).
3. **Payloads** — métodos `getParams*()` privados (body de POSTs).
4. **Funções gerais** — `startIssuance()`, métodos privados de etapa, helpers (`loadHiddenFields`, `getPossibleErrors`, `fixHtml`) e `processIssuance()` **por último**.

> Sintoma de classe fora do padrão: o "header" de URLs aparecendo **embaixo** dos métodos. Sempre que isso acontecer, **reordenar antes** de chamar `pipeline_test`.

---

## Classificação regular/irregular e PDF

- **Sempre que houver PDF, baixar e salvar** (`downloadPDF`/`generatePDF`) — arquivado em qualquer caso (regular ou irregular).
- **Caminho padrão:** `processIssuance()` é onde se atribui `$this->situation`, `$this->expirationDate` e `$this->protocolNumber`, lendo o PDF/dados capturados. (Mapeia para o bloco `VALIDACAO` da [[08 - Extração e Interpretação de HAR|interpretação]].)
- **`protocolNumber` ausente:** quando nem o PDF nem a tarefa indicam onde extrair o número (alguns órgãos não emitem), atribuir `$this->protocolNumber = "S/N"` (commit `a4c2cc7`). Não inventar regex, não deixar vazio.
- **Exceção `saveCertificateRegular`/`saveCertificateIrregular` dentro de um fetch:** só quando a própria resposta do site **já certifica a situação sem gerar PDF** (ex.: TRF4 retorna "Nenhum processo com movimentação foi localizado" no HTML). O helper salva o texto como "certidão" e curto-circuita. Não é o padrão.

---

## Registro em `config/certificates.php`

- Três seções: `FEDERAL`, `ESTADUAL`, `MUNICIPAL`. A Municipal é subdividida por UF (`// AC`, `// AL`, `// PR`, `// SP`…).
- Inserir **na esfera certa**, **na UF certa** (Municipal), em **ordem alfabética** (case-insensitive) dentro do bloco.
- **Nunca** deixar a entrada solta no fim do arquivo — sintoma de append automático que precisa ser realocado. (O `pipeline_test` insere antes do `];`, então quase sempre é preciso mover.)

Entradas geradas por tipo:
```php
// Federal
'CertificateX' => Federal\CertificateX::class,
// State
'CertificateX' => State\CertificateX::class,
// Municipal (exige UF)
'CertificateX' => Municipal\SP\CertificateX::class,
```

---

## Veja também
- [[09 - Geração e Teste do Código PHP]] — onde estas regras são aplicadas.
- [[16 - Knowledge Base e Memória de Time]] — onde as armadilhas por classe/base são registradas.
