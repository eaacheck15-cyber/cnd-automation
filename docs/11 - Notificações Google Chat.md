# 11 - Notificações Google Chat

← Voltar para [[CND Automation — Documentação Técnica|Home]] · tool: `notify_google_chat` (`src/tools/notify.ts`)

A cada tarefa encerrada (sucesso no PASSO 12 ou falha no PASSO 11), a skill envia um **card** a um Google Chat Space via webhook. Dá visibilidade do que o pipeline fez sem ninguém precisar abrir o Redmine.

---

## Configuração

- Webhook em `GOOGLE_CHAT_WEBHOOK_URL` (gerar em **Configurações do Space → Apps e integrações → Adicionar webhooks**).
- **Contém token** — tratar como senha, nunca commitar valor real.
- Se a env estiver **vazia**, a tool retorna `{ sent: false, reason: "GOOGLE_CHAT_WEBHOOK_URL not configured" }` **sem erro** — o pipeline segue normalmente.

---

## Layout do card

Título fixo: `{ícone} {LABEL} — CND #{task_id} — {class_name}`, subtítulo com o timestamp atual (formato BR `dd/mm/aaaa hh:mm:ss`).

| Status | Ícone | Label | Campos |
|--------|-------|-------|--------|
| `SUCESSO` | 🟢 | `SUCESSO` | Tipo, Esfera, Início, Duração |
| `ERRO` | 🔴 | `FALHA` | Tipo, Motivo, Reatribuído para, Início, Duração |

> Observação: o `status` de entrada é `"SUCESSO"`/`"ERRO"`, mas o **label exibido** para erro é **"FALHA"** (commit `e3ae1c0`).

---

## Parâmetros

```ts
notify_google_chat({
  task_id: number,            // ID numérico (ex.: 2338858)
  class_name: string,         // ex.: "CertificateCajati"
  status: "SUCESSO" | "ERRO",
  inicio: string,             // ISO 8601 anotado no PASSO 2
  duracao_segundos?: number,  // (agora - inicio)
  tipo?: "NOVA IMPLEMENTAÇÃO" | "MANUTENÇÃO",
  esfera?: string,            // só SUCESSO — "Federal" | "Estadual SP" | "Municipal SP"
  motivo?: string,            // só ERRO — descrição humana (mesma da nota do Redmine)
  reatribuido_para?: string,  // só ERRO — default "Analista de Negócio Web/Imobiliário"
}) → { sent: boolean, reason?: string }
```

- `inicio` é o timestamp ISO anotado no **PASSO 2** da skill (`Get-Date -Format "o"` ou `new Date().toISOString()`).
- `duracao_segundos` = diferença entre "agora" e `inicio`. O card formata como `HH:MM:SS`.

---

## Exemplo

**Sucesso**
```
🟢 SUCESSO — CND #2338858 — CertificateCajati
27/05/2026 07:14:03
Tipo: NOVA IMPLEMENTAÇÃO
Esfera: Municipal SP
Início: 27/05/2026 07:12:40
Duração: 00:01:23
```

**Falha**
```
🔴 FALHA — CND #2338901 — CertificateIguaracu
27/05/2026 07:20:11
Tipo: MANUTENÇÃO
Motivo: Captcha detectado na página de emissão — não foi possível automatizar.
Reatribuído para: Analista de Negócio Web/Imobiliário
Início: 27/05/2026 07:18:55
Duração: 00:01:16
```

---

## Veja também
- [[05 - Skill auto — Orquestrador]] — PASSOS 11 e 12 chamam esta tool.
- [[10 - Integração Redmine]] — o motivo do card é o mesmo da nota do Redmine.
