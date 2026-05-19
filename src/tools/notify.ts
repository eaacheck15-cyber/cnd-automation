import { GOOGLE_CHAT_WEBHOOK_URL } from "../config.js";

export type NotifyStatus = "SUCESSO" | "ERRO";

const STATUS_ICON: Record<NotifyStatus, string> = {
  SUCESSO: "🟢",
  ERRO: "🔴",
};

const DEFAULT_FAILURE_ASSIGNEE = "Analista de Negócio Web/Imobiliário";

function formatBR(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface NotifyInput {
  task_id: number;
  class_name: string;
  status: NotifyStatus;
  inicio: string;
  duracao_segundos?: number;
  tipo?: "NOVA IMPLEMENTAÇÃO" | "MANUTENÇÃO";
  esfera?: string;
  motivo?: string;
  reatribuido_para?: string;
}

export async function notifyGoogleChat(input: NotifyInput): Promise<{ sent: boolean; reason?: string }> {
  if (!GOOGLE_CHAT_WEBHOOK_URL) {
    return { sent: false, reason: "GOOGLE_CHAT_WEBHOOK_URL not configured" };
  }

  const icone = STATUS_ICON[input.status] ?? "⚪";
  const inicio = new Date(input.inicio);
  const agora = new Date();

  const linhas: string[] = [];

  if (input.tipo) linhas.push(`<b>Tipo:</b> ${input.tipo}`);

  if (input.status === "SUCESSO") {
    if (input.esfera) linhas.push(`<b>Esfera:</b> ${input.esfera}`);
  } else {
    if (input.motivo) linhas.push(`<b>Motivo:</b> ${input.motivo}`);
    linhas.push(`<b>Reatribuído para:</b> ${input.reatribuido_para ?? DEFAULT_FAILURE_ASSIGNEE}`);
  }

  linhas.push(`<b>Início:</b> ${formatBR(inicio)}`);
  if (input.duracao_segundos !== undefined) {
    linhas.push(`<b>Duração:</b> ${formatDuration(input.duracao_segundos)}`);
  }

  const payload = {
    cards: [
      {
        header: {
          title: `${icone} CND #${input.task_id} — ${input.class_name}`,
          subtitle: formatBR(agora),
          imageStyle: "AVATAR",
        },
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: linhas.join("<br/>"),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  const response = await fetch(GOOGLE_CHAT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Google Chat webhook error: ${response.status} ${response.statusText}`);
  }

  return { sent: true };
}
