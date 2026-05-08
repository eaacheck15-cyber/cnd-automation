---
description: Executa o pipeline CND de forma totalmente autônoma — busca tarefas no Redmine, processa cada uma pelo pipeline completo e commita. Use com /loop para rodar continuamente sem intervenção.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, WebFetch, mcp__cnd-pipeline__*
---

## Pipeline CND — Modo Autônomo

Você está operando em modo autônomo. Execute cada passo na ordem abaixo, sem pedir confirmação.

---

### PASSO 1 — Verificar pausa

Verifique se o arquivo `c:\Workspace\cnd-automation\STOP` existe:
```powershell
Test-Path c:\Workspace\cnd-automation\STOP
```
- **True** → exiba "⏸ Pipeline pausado. Delete o arquivo STOP para retomar." e **encerre o ciclo**.
- **False** → continue.

---

### PASSO 2 — Buscar próxima tarefa

Chame `redmine_next_task`.

- `task: null` → "📭 Fila vazia." e **encerre o ciclo**.
- `auto_refreshed: true` → informe quantas tarefas foram carregadas.
- Tarefa retornada → anote `id`, `subject` e `description` e continue.

---

### PASSO 3 — Detectar tipo de operação

Leia o início do `subject`:

| Subject começa com | Operação |
|--------------------|----------|
| `Implementar`      | **NOVA IMPLEMENTAÇÃO** — classe inexistente, criar do zero |
| `Revisar`          | **MANUTENÇÃO** — classe existente, corrigir problema |

Extraia também:
- **`type`**: subject contém "Federal" → `Federal`; "Estadual" → `State`; "Municipal" → `Municipal`
- **`state`**: sigla UF no subject (ex: "de Cajati - SP" → `SP`). Obrigatório para State e Municipal.
- **`url`**: campo `URL:` ou `URL Site:` na description
- **`cnpj`**: campo `CNPJ:` na description
- **`inputs_adicionais`**: seção `Campos Adicionais Para a Certidão` ou `Dados para Emissão`
- **`instrucoes`**: seção `Instrução Emissão No site`
- **`expectativas`**: seção `Expectativas`

---

### PASSO 3A — NOVA IMPLEMENTAÇÃO: definir class_name

Gere o `class_name` em PascalCase a partir da cidade/órgão no subject:
- "Implementar Captura Certidão Municipal de Cajati - SP" → `CertificateCajati`
- "Implementar Captura Certidão Federal - Receita Federal" → `CertificateReceitaFederal`
- "Implementar Captura Certidão Estadual de Minas Gerais - SEFAZ" → `CertificateSefazMG`

Remova acentos, espaços e caracteres especiais. Prefixo sempre `Certificate`.

---

### PASSO 3B — MANUTENÇÃO: extrair class_name e ler código existente

Extraia o `class_name` do campo `Certidão:` na description:
- `Certidão: CertificateIguaracu` → `class_name = "CertificateIguaracu"`

Localize e leia o arquivo PHP existente no projeto CND:
```powershell
Get-ChildItem -Path C:\Workspace\cnd -Recurse -Filter "{class_name}.php" | Select-Object -ExpandProperty FullName
```

Leia o arquivo com a ferramenta Read. Esse código será a base para as correções.

---

### PASSO 4 — Marcar tarefa como Em Desenvolvimento

Chame `redmine_update_task`:
- `issue_id`: id da tarefa
- `status_id`: `"57"` (Em Desenv.)
- `notes`: `"Tarefa iniciada pelo pipeline automático."`

---

### PASSO 5 — Consultar knowledge base

Antes de iniciar qualquer análise, verifique se existe conhecimento acumulado sobre esta certidão ou sua base.

#### 5.1 — Verificar arquivo específico da certidão

```powershell
$path = "C:\Workspace\cnd\.claude\patterns\{federal|state}\{class_name}.md"
if (Test-Path $path) { Get-Content $path }
```

Se existir: leia e anote fluxo, parâmetros críticos e armadilhas. Isso guiará a implementação/correção.

#### 5.2 — Verificar base (somente MANUTENÇÃO)

Para tarefas de manutenção, você já sabe qual base a classe estende (lida no PASSO 3B). Verifique:

```powershell
$path = "C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md"
if (Test-Path $path) { Get-Content $path }
```

Se existir: leia e anote armadilhas e padrões conhecidos da base.

> Se nenhum arquivo existir, continue normalmente — a knowledge base será criada ao final desta tarefa.

---

### PASSO 6 — Discovery

Chame `pipeline_discover` com `task_id` e `task_description` (description completa da tarefa).

Salve: `url`, `inputs`, `expected_flow`, `complexity`.

---

### PASSO 7 — Captura do browser

O objetivo é capturar o tráfego HTTP do portal para que o código PHP possa replicar as requisições. O browser é apenas o meio para navegar e disparar esse tráfego.

Monte `nav_steps` seguindo as `instrucoes` da tarefa: navegue pelo fluxo de emissão usando o CNPJ e inputs adicionais fornecidos, até obter a certidão. Não se preocupe com seletores específicos — o objetivo é concluir o fluxo para gerar o HAR.

Chame `pipeline_browser_capture` com `nav_steps` preenchido.

Se falhar, ajuste a navegação e tente novamente (até 2 tentativas).

---

### PASSO 8 — Extração do HAR

Chame `pipeline_extract_har` com o `har_path` retornado no passo anterior.

Salve o array `flow`.

---

### PASSO 9 — Interpretação do fluxo

Chame `pipeline_interpret_flow` com o `flow` extraído.

Salve `flow_type` e `steps`.

---

### PASSO 10A — NOVA IMPLEMENTAÇÃO: gerar classe PHP

Chame `pipeline_generate_code` com `interpretation`, `task_description`, `class_name`, `type` e `state`.

Com base no resultado (exemplos, base_class, blocks_memory, instructions), **escreva a classe PHP completa** seguindo as instruções retornadas.

Chame `pipeline_test` com `class_name`, `type`, `state`, `php_code`, `cnpj` e `nome` (se disponível na tarefa).

---

### PASSO 10B — MANUTENÇÃO: corrigir classe PHP existente

Você já tem:
- O código PHP atual (lido no PASSO 3B)
- A interpretação do fluxo HTTP atual do site (PASSO 9)
- O problema descrito na seção `expectativas`

Compare o fluxo HTTP atual com o que o código PHP está replicando. Identifique o que diverge:
- Endpoints diferentes ou renomeados?
- Parâmetros novos, removidos ou com valores diferentes?
- Headers ou cookies necessários que o código não está enviando?
- Lógica de validação do resultado incorreta (ex: regex errada, campo de status mudou)?

Aplique as correções mínimas necessárias no código existente.

Chame `pipeline_test` com `class_name`, `type`, `state`, `php_code`, `cnpj` e `nome` (se disponível na tarefa).

---

### PASSO 11 — Retry em caso de falha no teste

Se o teste falhar:
- Analise o `artisan_output`, identifique a causa raiz e corrija o código.
- Chame `pipeline_test` novamente.
- Repita até **3 tentativas** no total.
- Se todas falharem → vá para PASSO 12 (falha).

Se passar → vá para PASSO 13 (sucesso).

---

### PASSO 12 — Registrar falha no Redmine

Traduza o erro para uma descrição objetiva e humana. Exemplos:
- "Captcha detectado na página de emissão — não foi possível automatizar."
- "Parâmetro `inscricaoMunicipal` não encontrado no retorno da API."
- "Portal bloqueou a requisição via automação (possível detecção de bot)."
- "Endpoint de emissão retornou estrutura de resposta diferente do esperado."
- "Certidão retorna status de falha mesmo para empresa regular no site."

Chame `redmine_update_task`:
- `issue_id`: id da tarefa
- `status_id`: `"56"` (Ag. Desenv.)
- `notes`: descrição humana do erro

Exiba: `❌ #{task_id} — {class_name} — {motivo}`

**Encerre o ciclo.**

---

### PASSO 13 — Commit e encerramento com sucesso

Chame `pipeline_commit` com `task_id`, `task_subject` (subject completo da tarefa), `class_name`, `type` e `state`.

Chame `redmine_update_task`:
- `issue_id`: id da tarefa
- `status_id`: `"84"` (Ag. Review)
- `notes`:
```
Alterações realizadas:
> {implementação: "Implementação da classe {ClassName} para emissão automática de certidão."
   manutenção: "Correção da classe {ClassName} — {descrição curta do que foi corrigido}."}

Projetos e Arquivos Modificados:
> cnd — {caminho relativo do arquivo PHP}
> cnd — config/certificates.php
```

Exiba: `✅ #{task_id} — {class_name} — commitado e atualizado no Redmine.`

---

### PASSO 14 — Atualizar knowledge base

Objetivo: registrar o que funcionou para evitar redescobrir em tarefas futuras.

#### 14.1 — Identificar classe base

Leia o arquivo PHP da classe para encontrar qual base ela estende:
```php
class CertificateX extends CertificateServlet  // → CertificateServlet
```

#### 14.2 — Atualizar "Última execução bem-sucedida" na base

Localize o arquivo correspondente em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md`.

Se existir, atualize a linha `Última execução bem-sucedida`:
```
## Última execução bem-sucedida
- {AAAA-MM-DD} | Tarefa #{task_id} | {class_name}
```

Se o arquivo da base não existir, crie-o em `C:\Workspace\cnd\.claude\patterns\bases\{BaseClass}.md` com o padrão observado nesta execução.

#### 14.3 — Criar ou atualizar arquivo da certidão

Verifique se existe `C:\Workspace\cnd\.claude\patterns\{federal|state}\{class_name}.md`.

- **Se não existe**: crie com as informações desta execução.
- **Se existe**: atualize apenas o que mudou (novos parâmetros, armadilhas descobertas, data).

Conteúdo do arquivo:

```markdown
# {class_name}

**Base:** {BaseClass}
**Localização:** `app/Certificates/{type}/{class_name}.php`

## Fluxo PHP

{passos resumidos do fluxo identificado no PASSO 8 — apenas o que é específico desta certidão}

## Parâmetros críticos

{parâmetros não óbvios ou específicos deste portal, extraídos do código gerado}

## Armadilhas conhecidas

{problemas encontrados durante os retries ou observações do fluxo — omitir se nenhum}

## Última execução bem-sucedida

- {AAAA-MM-DD} | Tarefa #{task_id}
```

#### 14.4 — Commit dos knowledge files

Se algum arquivo de knowledge foi criado ou modificado, commite apenas esses arquivos:
```powershell
git -C C:\Workspace\cnd add .claude/patterns/
git -C C:\Workspace\cnd commit -m "docs: atualiza knowledge base — {class_name} #{task_id}"
```
