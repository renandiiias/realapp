const ZAI_BASE_URL = process.env.EXPO_PUBLIC_ZAI_BASE_URL?.replace(/\/+$/, "") || "https://api.z.ai/api/paas/v4";
const ZAI_API_KEY = process.env.EXPO_PUBLIC_ZAI_API_KEY;
const ZAI_MODEL = process.env.EXPO_PUBLIC_ZAI_MODEL || "glm-4.5-air";

type BudgetOption = "ate_500" | "500_1500" | "1500_5000" | "5000_mais";
type StyleOption = "antes_depois" | "problema_solucao" | "prova_social";

export type AdsConversationDataLike = {
  objective: string;
  offer: string;
  budget: string;
  audience: string;
  region: string;
  destinationWhatsApp: string;
  style: string;
};

export type AdsBusinessBriefInput = {
  brief: string;
  currentData: AdsConversationDataLike;
  companyContext?: {
    companyName?: string;
    offerSummary?: string;
    mainDifferential?: string;
    primarySalesChannel?: string;
    marketSegment?: string;
  };
};

export type AdsBusinessBriefPrefill = Partial<AdsConversationDataLike>;

type RawZaiPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

function normalizeBudget(raw: unknown): BudgetOption | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "ate_500" || value === "500_1500" || value === "1500_5000" || value === "5000_mais") return value;
  if (/5000|5\.000|5k/.test(value)) return "5000_mais";
  if (/1500|1\.500|2\.000|3\.000|4\.000/.test(value)) return "1500_5000";
  if (/500|1000|1\.000/.test(value)) return "500_1500";
  return undefined;
}

function normalizeStyle(raw: unknown): StyleOption | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "antes_depois" || value === "problema_solucao" || value === "prova_social") return value;
  if (value.includes("antes") || value.includes("depois")) return "antes_depois";
  if (value.includes("problema") || value.includes("solu")) return "problema_solucao";
  if (value.includes("prova") || value.includes("depoimento")) return "prova_social";
  return undefined;
}

function normalizeString(raw: unknown): string | undefined {
  const value = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return undefined;
  return value.slice(0, 220);
}

function parsePrefill(raw: string): AdsBusinessBriefPrefill {
  try {
    const parsed = JSON.parse(extractJson(raw)) as Partial<Record<keyof AdsConversationDataLike, unknown>>;
    return {
      objective: normalizeString(parsed.objective),
      offer: normalizeString(parsed.offer),
      budget: normalizeBudget(parsed.budget),
      audience: normalizeString(parsed.audience),
      region: normalizeString(parsed.region),
      destinationWhatsApp: normalizeString(parsed.destinationWhatsApp),
      style: normalizeStyle(parsed.style),
    };
  } catch {
    return {};
  }
}

function heuristicPrefill(brief: string): AdsBusinessBriefPrefill {
  const oneLine = brief.replace(/\s+/g, " ").trim();
  const matchPhone = oneLine.match(/(\+?\d[\d\s().-]{8,}\d)/);
  return {
    objective: oneLine ? `Gerar mais conversas no WhatsApp para ${oneLine.slice(0, 65)}` : undefined,
    destinationWhatsApp: matchPhone ? matchPhone[1].replace(/\s+/g, "") : undefined,
  };
}

async function callZai(input: AdsBusinessBriefInput): Promise<AdsBusinessBriefPrefill | null> {
  if (!ZAI_API_KEY) return null;

  const context = input.companyContext ?? {};
  const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      temperature: 0.1,
      max_tokens: 380,
      messages: [
        {
          role: "system",
          content:
            "Você recebe uma descrição de negócio para campanha de WhatsApp. Responda SOMENTE JSON com estes campos opcionais: objective, offer, budget, audience, region, destinationWhatsApp, style. Regras: budget deve ser um dos códigos [ate_500,500_1500,1500_5000,5000_mais]; style deve ser um dos códigos [antes_depois,problema_solucao,prova_social]. Se não souber um campo, omita."
        },
        {
          role: "user",
          content: [
            `Brief do cliente: ${input.brief}`,
            `Dados já preenchidos: ${JSON.stringify(input.currentData)}`,
            `Contexto da empresa: ${JSON.stringify(context)}`,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as RawZaiPayload;
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return null;
  return parsePrefill(content);
}

export async function analyzeAdsBusinessBrief(input: AdsBusinessBriefInput): Promise<AdsBusinessBriefPrefill> {
  const fromZai = await callZai(input);
  if (fromZai) return fromZai;
  return heuristicPrefill(input.brief);
}
