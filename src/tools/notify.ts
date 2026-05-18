import { GOOGLE_CHAT_WEBHOOK_URL } from "../config.js";

type Status = "SUCESSO" | "ERRO" | "AVISO" | "INICIADO";

const STATUS_ICON: Record<Status, string> = {
  SUCESSO: "🟢",
  ERRO: "🔴",
  AVISO: "🟡",
  INICIADO: "🔵",
};

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

export async function notifyGoogleChat(input: {
  nome_job: string;
  status: Status;
  detalhes: string;
  inicio: string;
  duracao_segundos?: number;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!GOOGLE_CHAT_WEBHOOK_URL) {
    return { sent: false, reason: "GOOGLE_CHAT_WEBHOOK_URL not configured" };
  }

  const icone = STATUS_ICON[input.status] ?? "⚪";
  const inicio = new Date(input.inicio);
  const agora = new Date();

  const linhas = [
    `<b>Status:</b> ${input.status}<br/>`,
    `<b>Início:</b> ${formatBR(inicio)}<br/>`,
    input.duracao_segundos !== undefined
      ? `<b>Duração:</b> ${formatDuration(input.duracao_segundos)}<br/>`
      : "",
    "<br/>",
    `<b>Detalhes:</b><br/>${input.detalhes}`,
  ];

  const payload = {
    cards: [
      {
        header: {
          title: `${icone} ${input.nome_job}`,
          subtitle: `Enviado em ${formatBR(agora)}`,
          imageStyle: "AVATAR",
        },
        sections: [
          {
            widgets: [
              {
                textParagraph: {
                  text: linhas.join(""),
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
