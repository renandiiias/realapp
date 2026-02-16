export type RayXData = {
  knowledgeLevel: "iniciante" | "intermediario" | "avancado";
  mainGoal: "leads" | "visibilidade";
  monthlyBudget: "ate_200" | "500_1000" | "1000_5000";
  marketSegment: string;
};

export type CompanyProfile = {
  companyName: string;
  instagram: string;
  website: string;
  googleBusinessLink: string;
  whatsappBusiness: string;
  targetAudience: string;
  city: string;
  offerSummary: string;
  mainDifferential: string;
  primarySalesChannel: string;
  competitorsReferences: string;
  adMonthlyInvestment: number;
  adPrepaidBalance: number;
};

export type ReadinessFieldKey =
  | "knowledgeLevel"
  | "mainGoal"
  | "monthlyBudget"
  | "marketSegment"
  | "companyName"
  | "instagram"
  | "website"
  | "googleBusinessLink"
  | "whatsappBusiness"
  | "targetAudience"
  | "city"
  | "offerSummary"
  | "mainDifferential"
  | "primarySalesChannel"
  | "competitorsReferences";

type ReadinessInput = {
  rayX: Partial<RayXData> | null;
  companyProfile: Partial<CompanyProfile> | null;
};

export type ProfileReadiness = {
  profileMinimumComplete: boolean;
  profileProductionComplete: boolean;
  missingForMinimum: ReadinessFieldKey[];
  missingForProduction: ReadinessFieldKey[];
};

export const PROFILE_FIELD_LABELS: Record<ReadinessFieldKey, string> = {
  knowledgeLevel: "Nível em marketing",
  mainGoal: "Meta principal",
  monthlyBudget: "Investimento mensal",
  marketSegment: "Segmento",
  companyName: "Nome da empresa",
  instagram: "Instagram",
  website: "Site",
  googleBusinessLink: "Ficha do Google",
  whatsappBusiness: "WhatsApp",
  targetAudience: "Público-alvo",
  city: "Cidade",
  offerSummary: "Resumo da oferta",
  mainDifferential: "Diferencial principal",
  primarySalesChannel: "Canal principal de vendas",
  competitorsReferences: "Referências de concorrentes",
};

const minimumFields: ReadinessFieldKey[] = [
  "companyName",
  "marketSegment",
  "city",
  "mainGoal",
  "monthlyBudget",
  "targetAudience",
  "whatsappBusiness",
  "instagram",
];

const productionFields: ReadinessFieldKey[] = [
  "knowledgeLevel",
  "mainGoal",
  "monthlyBudget",
  "marketSegment",
  "companyName",
  "instagram",
  "website",
  "googleBusinessLink",
  "whatsappBusiness",
  "targetAudience",
  "city",
  "offerSummary",
  "mainDifferential",
  "primarySalesChannel",
  "competitorsReferences",
];

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length >= 2;
}

function isValidGoal(value: unknown): value is RayXData["mainGoal"] {
  return value === "leads" || value === "visibilidade";
}

function isValidBudget(value: unknown): value is RayXData["monthlyBudget"] {
  return value === "ate_200" || value === "500_1000" || value === "1000_5000";
}

function isValidKnowledgeLevel(value: unknown): value is RayXData["knowledgeLevel"] {
  return value === "iniciante" || value === "intermediario" || value === "avancado";
}

function hasField(
  field: ReadinessFieldKey,
  rayX: Partial<RayXData>,
  companyProfile: Partial<CompanyProfile>,
): boolean {
  switch (field) {
    case "knowledgeLevel":
      return isValidKnowledgeLevel(rayX.knowledgeLevel);
    case "mainGoal":
      return isValidGoal(rayX.mainGoal);
    case "monthlyBudget":
      return isValidBudget(rayX.monthlyBudget);
    case "marketSegment":
      return hasText(rayX.marketSegment);
    case "companyName":
      return hasText(companyProfile.companyName);
    case "instagram":
      return hasText(companyProfile.instagram);
    case "website":
      return hasText(companyProfile.website);
    case "googleBusinessLink":
      return hasText(companyProfile.googleBusinessLink);
    case "whatsappBusiness":
      return hasText(companyProfile.whatsappBusiness);
    case "targetAudience":
      return hasText(companyProfile.targetAudience);
    case "city":
      return hasText(companyProfile.city);
    case "offerSummary":
      return hasText(companyProfile.offerSummary);
    case "mainDifferential":
      return hasText(companyProfile.mainDifferential);
    case "primarySalesChannel":
      return hasText(companyProfile.primarySalesChannel);
    case "competitorsReferences":
      return hasText(companyProfile.competitorsReferences);
    default:
      return false;
  }
}

export function computeProfileReadiness({ rayX, companyProfile }: ReadinessInput): ProfileReadiness {
  const safeRayX = rayX ?? {};
  const safeCompanyProfile = companyProfile ?? {};

  const missingForMinimum = minimumFields.filter((field) => !hasField(field, safeRayX, safeCompanyProfile));
  const missingForProduction = productionFields.filter((field) => !hasField(field, safeRayX, safeCompanyProfile));

  return {
    profileMinimumComplete: missingForMinimum.length === 0,
    profileProductionComplete: missingForProduction.length === 0,
    missingForMinimum,
    missingForProduction,
  };
}
