---
description: Executa o pipeline CND de forma totalmente autônoma — busca tarefas no Redmine, processa cada uma pelo pipeline completo e commita. Use com /loop para rodar continuamente sem intervenção.
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep, WebFetch, mcp__cnd-pipeline__*
---

## Pipeline CND — Modo Autônomo

Você está operando em modo autônomo. Execute cada passo na ordem abaixo, sem pedir confirmação.

---

### PASSO 1 — Verificar pausa

Verifique se o arquivo `c:\Workspace\cnd-automation\STOP` existe usando Bash:
```
Test-Path c:\Workspace\cnd-automation\STOP
```

- Se **True** → exiba "⏸ Pipeline pausado. Delete o arquivo STOP para retomar." e **encerre o ciclo**.
- Se **False** → continue.

---

### PASSO 2 — Buscar próxima tarefa

Chame `redmine_next_task`.

- Se `task: null` → exiba "📭 Fila de tarefas vazia." e **encerre o ciclo**.
- Se `auto_refreshed: true` → informe quantas tarefas foram carregadas do Redmine.
- Se retornou uma tarefa → anote `id`, `subject` e `description` e continue.

---

### PASSO 3 — Extrair dados da tarefa

A partir de `subject` e `description`, extraia:

| Campo | Como extrair |
|-------|-------------|
| `task_id` | Campo `id` do Redmine (número) |
| `type` | "Federal", "State" ou "Municipal" — leia do subject/description |
| `state` | Sigla UF (ex: "SP", "MG") — obrigatório se type for State ou Municipal |
| `class_name` | PascalCase sem espaços. Ex: "CND Municipal São Paulo SP" → "CertificateSaoPauloSP" |
| `task_description` | Use o campo `description` completo da tarefa |

Se não conseguir determinar `type` ou `class_name`, marque como falha e vá para o PASSO 9.

---

### PASSO 4 — Discovery

Chame `pipeline_discover` com `task_id` e `task_description`.

Salve o resultado: `url`, `inputs`, `expected_flow`, `complexity`.

---

### PASSO 5 — Captura do browser

Antes de chamar `pipeline_browser_capture`:
1. Use `WebFetch` para carregar a URL do portal.
2. Analise o HTML — identifique seletores exatos dos campos (CNPJ, inscrição, carnê, etc.) e do botão de submit.
3. Monte o array `nav_steps` com ações precisas (goto, fill, click).

Então chame `pipeline_browser_capture` com `nav_steps` preenchido.

Se falhar, tente novamente com `nav_steps` ajustado (até 2 tentativas).

---

### PASSO 6 — Extração do HAR

Chame `pipeline_extract_har` com o `har_path` retornado no passo anterior.

Salve o array de `flow`.

---

### PASSO 7 — Interpretação do fluxo

Chame `pipeline_interpret_flow` com o `flow` do passo anterior.

Salve `flow_type` e `steps`.

---

### PASSO 8 — Geração de código

Chame `pipeline_generate_code` com `interpretation`, `task_description`, `class_name`, `type` e `state`.

Com base no resultado (exemplos, base_class, blocks_memory, instructions):
- **Escreva a classe PHP completa** seguindo as instruções retornadas.
- Chame `pipeline_test` com `class_name`, `type`, `state` e o `php_code` gerado.

Se o teste falhar:
- Leia o `artisan_output` para entender o erro.
- Corrija o código PHP e chame `pipeline_test` novamente.
- Repita até 3 tentativas no total. Na terceira falha, vá para PASSO 9.

Se o teste passar → continue para PASSO 9 (sucesso).

---

### PASSO 9 — Commit ou registro de falha

**Se sucesso:**
- Chame `pipeline_commit` com `task_id`, `class_name`, `type` e `state`.
- Exiba: "✅ #{task_id} — {class_name} implementado e commitado."

**Se falha:**
- Exiba: "❌ #{task_id} — {class_name} falhou após tentativas. Pulando para próxima tarefa."
- Registre o erro mas **não interrompa o loop**.

---

### PASSO 10 — Próximo ciclo

Exiba um resumo da tarefa concluída e aguarde o próximo ciclo do `/loop`.
