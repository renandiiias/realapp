const express = require("express");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { z } = require("zod");
const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const PORT = Number(process.env.PORT || 3340);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "http://68.183.49.208").replace(/\/+$/, "");
const SITE_PUBLISH_ROOT = process.env.SITE_PUBLISH_ROOT || path.resolve(__dirname, "../storage/public");
const BOLT_VENDOR_PATH = path.resolve(__dirname, "../vendor/bolt_diy");
const ZAI_BASE_URL = String(process.env.ZAI_BASE_URL || process.env.EXPO_PUBLIC_ZAI_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/+$/, "");
const ZAI_API_KEY = String(process.env.ZAI_API_KEY || process.env.EXPO_PUBLIC_ZAI_API_KEY || "").trim();
const ZAI_MODEL = String(process.env.ZAI_MODEL || process.env.EXPO_PUBLIC_ZAI_MODEL || "glm-4.5-air").trim();
const ZAI_TIMEOUT_MS = Number(process.env.ZAI_TIMEOUT_MS || 30000);

const app = express();
app.use(express.json({ limit: "2mb" }));
const codeGenerationFailureCounter = new Map();

function logSite(level, event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...meta }));
}

const builderBlockSchema = z.object({
  id: z.string().min(2).max(80),
  label: z.string().min(2).max(80),
  title: z.string().min(2).max(220),
  body: z.string().max(4000).default(""),
  buttonText: z.string().max(80).optional(),
  enabled: z.boolean().default(true),
  origin: z.enum(["default", "custom"]).default("default"),
});

const builderSpecSchema = z.object({
  businessName: z.string().max(180).default(""),
  segment: z.string().max(180).default(""),
  city: z.string().max(120).default(""),
  audience: z.string().max(220).default(""),
  offerSummary: z.string().max(1200).default(""),
  mainDifferential: z.string().max(500).default(""),
  templateId: z.string().max(80).default("clean"),
  paletteId: z.string().max(80).default("forest"),
  headline: z.string().max(220).default(""),
  subheadline: z.string().max(500).default(""),
  ctaLabel: z.string().max(80).default("Falar no WhatsApp"),
  whatsappNumber: z.string().max(32).default(""),
  heroImageUrl: z.string().max(1000).default(""),
  customHtml: z.string().max(180000).optional().default(""),
  customCss: z.string().max(50000).optional().default(""),
  customJs: z.string().max(50000).optional().default(""),
  blocks: z.array(builderBlockSchema).min(3).max(18),
});

const autobuildSchema = z.object({
  prompt: z.string().min(4).max(2000),
  context: z
    .object({
      businessName: z.string().max(180).optional(),
      segment: z.string().max(180).optional(),
      city: z.string().max(120).optional(),
      audience: z.string().max(220).optional(),
      offerSummary: z.string().max(1200).optional(),
      mainDifferential: z.string().max(500).optional(),
      whatsappNumber: z.string().max(32).optional(),
    })
    .optional(),
  currentBuilder: builderSpecSchema.optional(),
  forceRegenerate: z.boolean().optional(),
});

const codeBundleSchema = z.object({
  html: z.string().min(40).max(250000),
  css: z.string().max(120000).optional().default(""),
  js: z.string().max(120000).optional().default(""),
});

const codeGenerateSchema = z.object({
  prompt: z.string().min(4).max(3000),
  previous: codeBundleSchema.partial().optional(),
  context: z.record(z.any()).optional(),
});

const publishSchema = z.object({
  orderId: z.string().min(6).max(120),
  customerId: z.string().max(120).optional(),
  slug: z.string().max(120).optional(),
  builderSpec: builderSpecSchema,
});

const publishCodeSchema = z.object({
  orderId: z.string().min(6).max(120),
  customerId: z.string().max(120).optional(),
  slug: z.string().max(120).optional(),
  code: codeBundleSchema,
});

function hasBoltVendor() {
  return existsSync(BOLT_VENDOR_PATH);
}

function slugify(input, fallback = "site") {
  const value = String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return value || fallback;
}

function cleanPhone(raw) {
  return String(raw || "").replace(/[^\d]/g, "").slice(0, 14);
}

function safeText(input, fallback = "") {
  const value = String(input || "").trim();
  return value || fallback;
}

function summarizePrompt(prompt, max = 160) {
  const text = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.slice(0, max);
}

function promptFailureKey(prompt) {
  const base = summarizePrompt(prompt, 80).toLowerCase();
  return base || "empty_prompt";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPromptDrivenBlocks(prompt, ctaLabel, offerSummary, mainDifferential) {
  const text = String(prompt || "").trim();
  const parts = text
    .split(/[\n.;!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 8)
    .slice(0, 8);

  const dynamic = parts.map((item, index) => ({
    id: `custom-${index + 1}`,
    label: index === 0 ? "Oferta" : `Seção ${index + 1}`,
    title: item.slice(0, 84),
    body: index === 0 ? `${offerSummary}. ${mainDifferential}.` : item,
    buttonText: index === parts.length - 1 ? ctaLabel : undefined,
    enabled: true,
    origin: "custom",
  }));

  if (dynamic.length >= 3) return dynamic;

  return [
    {
      id: "benefits",
      label: "Benefícios",
      title: "O que você ganha",
      body: "Atendimento rápido; Processo claro; Resultado consistente",
      enabled: true,
      origin: "default",
    },
    {
      id: "proof",
      label: "Prova",
      title: "Depoimentos e confiança",
      body: `Clientes destacam ${mainDifferential.toLowerCase()} e retorno rápido no primeiro contato.`,
      enabled: true,
      origin: "default",
    },
    {
      id: "offer",
      label: "Oferta",
      title: "Oferta principal",
      body: offerSummary,
      enabled: true,
      origin: "default",
    },
  ];
}

function paletteTokens(paletteId) {
  if (paletteId === "sunset") {
    return { bg: "#180f0d", text: "#f7efe8", card: "#2b1a15", accent: "#d0613a", muted: "#d7b5a8" };
  }
  if (paletteId === "midnight") {
    return { bg: "#091423", text: "#eef5ff", card: "#16263f", accent: "#8ed1fc", muted: "#b7cbe6" };
  }
  return { bg: "#0b1110", text: "#f4f6f0", card: "#13201d", accent: "#35e214", muted: "#b8c9bf" };
}

function buildFreestyleCss(paletteId) {
  const tokens = paletteTokens(paletteId);
  return `
    :root{--bg:${tokens.bg};--text:${tokens.text};--card:${tokens.card};--accent:${tokens.accent};--muted:${tokens.muted}}
    *{box-sizing:border-box}
    body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;background:radial-gradient(1200px 700px at 10% -10%,rgba(255,255,255,.09),transparent),var(--bg);color:var(--text)}
    .wrap{max-width:1100px;margin:0 auto;padding:22px 14px 56px}
    .hero{padding:26px;border-radius:20px;background:linear-gradient(130deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.1)}
    .kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
    h1{margin:0 0 10px;font-size:clamp(1.8rem,4vw,3rem);line-height:1.1}
    .lead{margin:0 0 14px;color:var(--muted);font-size:1.02rem;line-height:1.55}
    .btn{display:inline-flex;padding:12px 18px;border-radius:999px;background:var(--accent);color:#081108;font-weight:700;text-decoration:none}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:14px}
    .card{padding:16px;border-radius:16px;background:var(--card);border:1px solid rgba(255,255,255,.09)}
    .card h2{margin:0 0 8px;font-size:1.05rem}
    .card p{margin:0;color:var(--muted);line-height:1.5;white-space:pre-wrap}
  `;
}

function buildFreestyleHtml(builderSpec, mode) {
  const business = escapeHtml(builderSpec.businessName || "Sua empresa");
  const segment = escapeHtml(builderSpec.segment || "Negócio local");
  const city = escapeHtml(builderSpec.city || "");
  const subtitle = escapeHtml(builderSpec.subheadline || "");
  const cta = escapeHtml(builderSpec.ctaLabel || "Falar no WhatsApp");
  const phone = cleanPhone(builderSpec.whatsappNumber || "");
  const ctaHref = phone ? `https://wa.me/${phone}` : "#";
  const cards = (Array.isArray(builderSpec.blocks) ? builderSpec.blocks : [])
    .filter((block) => block && block.enabled)
    .map(
      (block) => `<article class="card"><h2>${escapeHtml(block.title || block.label)}</h2><p>${escapeHtml(block.body || "")}</p></article>`,
    )
    .join("\n");

  return `
  <main class="wrap">
    <section class="hero">
      <div class="kicker">${mode === "preview" ? "Preview" : "Publicado"} · ${segment}${city ? ` · ${city}` : ""}</div>
      <h1>${escapeHtml(builderSpec.headline || business)}</h1>
      <p class="lead">${subtitle}</p>
      <a class="btn" href="${escapeHtml(ctaHref)}">${cta}</a>
    </section>
    <section class="grid">${cards}</section>
  </main>`;
}

function inferBaseSpec(prompt, context = {}, currentBuilder = null) {
  const promptSummary = summarizePrompt(prompt, 220);
  const businessName = safeText(context.businessName, safeText(currentBuilder?.businessName, "Sua empresa"));
  const segment = safeText(context.segment, safeText(currentBuilder?.segment, promptSummary || "Projeto sob medida"));
  const city = safeText(context.city, safeText(currentBuilder?.city, ""));
  const audience = safeText(context.audience, safeText(currentBuilder?.audience, "clientes ideais"));
  const offerSummary = safeText(
    context.offerSummary,
    safeText(currentBuilder?.offerSummary, promptSummary || "Oferta criada com base no prompt do usuário."),
  );
  const mainDifferential = safeText(
    context.mainDifferential,
    safeText(currentBuilder?.mainDifferential, "Atendimento rápido e direto"),
  );

  const objective = city ? `${segment} em ${city}` : segment;

  const headline = safeText(
    currentBuilder?.headline,
    `${businessName}: ${promptSummary ? promptSummary.slice(0, 64) : `mais vendas${city ? ` em ${city}` : ""}`}`,
  );

  const subheadline = safeText(
    currentBuilder?.subheadline,
    promptSummary
      ? `Site gerado por IA a partir do pedido: ${promptSummary}`
      : `Página criada para ${audience}, com foco em conversão no WhatsApp para ${objective}.`,
  );

  const ctaLabel = safeText(currentBuilder?.ctaLabel, "Falar no WhatsApp");

  const blocks = [
    {
      id: "hero",
      label: "Hero",
      title: headline,
      body: subheadline,
      buttonText: ctaLabel,
      enabled: true,
      origin: "default",
    },
    ...buildPromptDrivenBlocks(prompt, ctaLabel, `${offerSummary}. Diferencial: ${mainDifferential}.`, mainDifferential),
    {
      id: "cta",
      label: "CTA final",
      title: "Fale com nosso time agora",
      body: "Clique no botão e comece seu atendimento no WhatsApp.",
      buttonText: ctaLabel,
      enabled: true,
      origin: "default",
    },
  ].slice(0, 18);

  const fromCurrent = Array.isArray(currentBuilder?.blocks)
    ? currentBuilder.blocks.map((item) => {
        if (!item || typeof item !== "object") return null;
        return {
          id: safeText(item.id, `custom_${Date.now()}`),
          label: safeText(item.label, "Bloco"),
          title: safeText(item.title, "Bloco"),
          body: safeText(item.body, ""),
          buttonText: safeText(item.buttonText, "") || undefined,
          enabled: Boolean(item.enabled),
          origin: item.origin === "custom" ? "custom" : "default",
        };
      }).filter(Boolean)
    : [];

  const mergedBlocks = fromCurrent.length >= 3 ? fromCurrent : blocks;

  const inferred = {
    businessName,
    segment,
    city,
    audience,
    offerSummary,
    mainDifferential,
    templateId: safeText(currentBuilder?.templateId, "clean"),
    paletteId: safeText(currentBuilder?.paletteId, "forest"),
    headline,
    subheadline,
    ctaLabel,
    whatsappNumber: cleanPhone(context.whatsappNumber || currentBuilder?.whatsappNumber || ""),
    heroImageUrl: safeText(currentBuilder?.heroImageUrl, ""),
    customHtml: safeText(currentBuilder?.customHtml, ""),
    customCss: safeText(currentBuilder?.customCss, ""),
    customJs: safeText(currentBuilder?.customJs, ""),
    blocks: mergedBlocks,
  };

  if (!inferred.customHtml) {
    inferred.customHtml = buildFreestyleHtml(inferred, "final");
  }
  if (!inferred.customCss) {
    inferred.customCss = buildFreestyleCss(inferred.paletteId);
  }
  return inferred;
}

function safeJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractFirstJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const codeFence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFence && codeFence[1]) {
    const fromFence = safeJson(codeFence[1]);
    if (fromFence && typeof fromFence === "object") return fromFence;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = text.slice(start, end + 1);
    const parsed = safeJson(sliced);
    if (parsed && typeof parsed === "object") return parsed;
  }
  const parsed = safeJson(text);
  if (parsed && typeof parsed === "object") return parsed;
  return null;
}

function normalizeBlocks(input, fallbackBlocks, fallbackCta) {
  const rawBlocks = Array.isArray(input) ? input : [];
  const parsed = rawBlocks
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const id = safeText(item.id, `custom_${index + 1}`);
      const label = safeText(item.label, id);
      const title = safeText(item.title, label);
      const body = safeText(item.body, "");
      return {
        id: slugify(id, `block-${index + 1}`),
        label: label.slice(0, 80),
        title: title.slice(0, 220),
        body: body.slice(0, 4000),
        buttonText: safeText(item.buttonText, "").slice(0, 80) || undefined,
        enabled: item.enabled === false ? false : true,
        origin: item.origin === "custom" ? "custom" : "default",
      };
    })
    .filter(Boolean);

  if (parsed.length >= 3) {
    const seen = new Set();
    return parsed
      .map((block, index) => {
        let id = block.id || `block-${index + 1}`;
        while (seen.has(id)) id = `${id}-${index + 1}`;
        seen.add(id);
        return { ...block, id };
      })
      .slice(0, 18);
  }

  return (Array.isArray(fallbackBlocks) ? fallbackBlocks : []).map((item, index) => ({
    ...item,
    id: item.id || `block-${index + 1}`,
    buttonText: item.buttonText || (item.id === "hero" || item.id === "cta" ? fallbackCta : undefined),
    enabled: item.enabled !== false,
  }));
}

function coerceBuilderSpec(candidate, fallback) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const merged = {
    ...fallback,
    ...source,
    businessName: safeText(source.businessName, fallback.businessName),
    segment: safeText(source.segment, fallback.segment),
    city: safeText(source.city, fallback.city),
    audience: safeText(source.audience, fallback.audience),
    offerSummary: safeText(source.offerSummary, fallback.offerSummary),
    mainDifferential: safeText(source.mainDifferential, fallback.mainDifferential),
    templateId: safeText(source.templateId, fallback.templateId),
    paletteId: safeText(source.paletteId, fallback.paletteId),
    headline: safeText(source.headline, fallback.headline),
    subheadline: safeText(source.subheadline, fallback.subheadline),
    ctaLabel: safeText(source.ctaLabel, fallback.ctaLabel),
    whatsappNumber: cleanPhone(source.whatsappNumber || fallback.whatsappNumber),
    heroImageUrl: safeText(source.heroImageUrl, fallback.heroImageUrl),
    customHtml: safeText(source.customHtml, fallback.customHtml || ""),
    customCss: safeText(source.customCss, fallback.customCss || ""),
    customJs: safeText(source.customJs, fallback.customJs || ""),
    blocks: normalizeBlocks(source.blocks, fallback.blocks, safeText(source.ctaLabel, fallback.ctaLabel)),
  };
  return merged;
}

function composeDocument(codeBundle) {
  const html = safeText(codeBundle?.html, "");
  const css = safeText(codeBundle?.css, "");
  const js = safeText(codeBundle?.js, "");
  if (!html) return "";
  if (/<html[\s>]/i.test(html)) {
    let merged = html;
    if (css) {
      if (/<\/head>/i.test(merged)) merged = merged.replace(/<\/head>/i, `<style>${css}</style></head>`);
      else merged = `<style>${css}</style>${merged}`;
    }
    if (js) {
      if (/<\/body>/i.test(merged)) merged = merged.replace(/<\/body>/i, `<script>${js}</script></body>`);
      else merged = `${merged}<script>${js}</script>`;
    }
    return merged;
  }
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Preview</title>
  ${css ? `<style>${css}</style>` : ""}
</head>
<body>
${html}
${js ? `<script>${js}</script>` : ""}
</body>
</html>`;
}

function inferPromptProfile(prompt) {
  const raw = String(prompt || "").trim();
  const lower = raw.toLowerCase();
  const isClinic = /(clinica|clínica|dentista|odont|est[eé]tica|fisioterapia|sa[uú]de)/i.test(lower);
  const isRestaurant = /(restaurante|pizzaria|hamburg|caf[eé]|bar|delivery)/i.test(lower);
  const wantsBlue = /\bazul\b/i.test(lower);
  const wantsPink = /\brosa\b/i.test(lower);

  if (isClinic) {
    return {
      business: "Clínica",
      heroTitle: "Cuidado humano com excelência clínica",
      heroSubtitle: "Atendimento acolhedor, tecnologia moderna e acompanhamento completo para seus pacientes.",
      cta: "Agendar Consulta",
      palette: { bg: "#f4f8ff", panel: "#ffffff", primary: "#2b6fff", accent: "#1f4fd6", text: "#0f1b34", muted: "#486080" },
      sections: [
        { title: "Especialidades", body: "Clínica geral, prevenção, estética e acompanhamento contínuo com equipe experiente." },
        { title: "Estrutura", body: "Ambiente moderno, equipamentos atualizados e protocolos de segurança em todas as etapas." },
        { title: "Depoimentos", body: "Pacientes destacam clareza no atendimento, pontualidade e resultados consistentes." },
        { title: "Como funciona", body: "1) Triagem inicial  2) Plano personalizado  3) Retorno com orientação prática." },
      ],
    };
  }

  if (isRestaurant) {
    return {
      business: "Restaurante",
      heroTitle: "Sabores marcantes com entrega rápida",
      heroSubtitle: "Cardápio completo, ingredientes frescos e experiência deliciosa do pedido ao último prato.",
      cta: "Ver Cardápio",
      palette: { bg: "#fff8f2", panel: "#ffffff", primary: "#ff7a18", accent: "#df5c00", text: "#2f1808", muted: "#6b4a34" },
      sections: [
        { title: "Pratos destaque", body: "Combos da casa, pratos executivos e opções premium para almoço e jantar." },
        { title: "Entrega", body: "Pedido simples, rastreio em tempo real e embalagem pensada para chegar impecável." },
        { title: "Avaliações", body: "Clientes elogiam sabor, porções generosas e atendimento rápido no WhatsApp." },
        { title: "Reservas", body: "Agende mesas e eventos em poucos cliques com confirmação imediata." },
      ],
    };
  }

  const neutralPrimary = wantsPink ? "#ff4fa3" : wantsBlue ? "#2b6fff" : "#24c268";
  const neutralAccent = wantsPink ? "#e2358e" : wantsBlue ? "#1f4fd6" : "#179852";
  return {
    business: "Sua empresa",
    heroTitle: "Landing page premium para converter mais",
    heroSubtitle: "Design moderno, conteúdo objetivo e chamadas claras para transformar visitas em contatos.",
    cta: "Falar no WhatsApp",
    palette: { bg: "#0b1016", panel: "#111a24", primary: neutralPrimary, accent: neutralAccent, text: "#f1f5ff", muted: "#b9c5d9" },
    sections: [
      { title: "Oferta principal", body: "Proposta de valor clara, com foco no resultado que o cliente realmente busca." },
      { title: "Benefícios", body: "Processo simples, execução rápida e qualidade consistente do início ao fim." },
      { title: "Prova social", body: "Depoimentos e casos que reforçam confiança e reduzem fricção na decisão." },
      { title: "Próximo passo", body: "CTA direto para contato e diagnóstico rápido para iniciar hoje mesmo." },
    ],
  };
}

function fallbackCodeBundle(prompt) {
  const text = summarizePrompt(prompt, 180) || "Site sob medida";
  const profile = inferPromptProfile(prompt);
  const sectionsHtml = profile.sections
    .map((section) => `<article class="card"><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.body)}</p></article>`)
    .join("\n");

  return {
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(profile.business)} • ${escapeHtml(text)}</title>
  <style>
    body {
      background: ${profile.palette.bg};
      color: ${profile.palette.text};
      font-family: Inter, Arial, sans-serif;
      margin: 0;
      line-height: 1.45;
    }
    .shell {
      max-width: 1040px;
      margin: 0 auto;
      padding: 20px 14px 54px;
    }
    .hero {
      padding: 26px;
      border-radius: 20px;
      background: linear-gradient(140deg, ${profile.palette.panel}, ${profile.palette.bg});
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 16px 44px rgba(0,0,0,0.18);
    }
    .eyebrow {
      display: inline-block;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: ${profile.palette.muted};
      margin-bottom: 10px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 5vw, 3rem);
      line-height: 1.1;
    }
    .lead {
      margin: 0 0 16px;
      color: ${profile.palette.muted};
      font-size: 1.05rem;
      max-width: 70ch;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      border: 0;
      border-radius: 999px;
      padding: 12px 20px;
      font-weight: 700;
      background: ${profile.palette.primary};
      color: #fff;
      text-decoration: none;
      cursor: pointer;
    }
    .grid {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(auto-fit,minmax(220px,1fr));
      gap: 12px;
    }
    .card {
      border-radius: 16px;
      padding: 16px;
      background: ${profile.palette.panel};
      border: 1px solid rgba(255,255,255,0.08);
    }
    .card h3 {
      margin: 0 0 8px;
      font-size: 1.06rem;
    }
    .card p {
      margin: 0;
      color: ${profile.palette.muted};
    }
    .footer {
      margin-top: 16px;
      color: ${profile.palette.muted};
      font-size: .9rem;
      text-align: center;
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <span class="eyebrow">${escapeHtml(profile.business)} • preview</span>
      <h1>${escapeHtml(profile.heroTitle)}</h1>
      <p class="lead">${escapeHtml(profile.heroSubtitle)} Pedido: ${escapeHtml(text)}</p>
      <a class="cta" href="#">${escapeHtml(profile.cta)}</a>
    </section>
    <section class="grid">${sectionsHtml}</section>
    <p class="footer">Site gerado automaticamente com foco em conversão e usabilidade.</p>
  </main>
</body>
</html>`,
    css: "",
    js: "",
  };
}

function coerceCodeBundle(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const nested = source.code && typeof source.code === "object" ? source.code : null;
  const htmlSource = nested ? nested.html : source.html;
  const cssSource = nested ? nested.css : source.css;
  const jsSource = nested ? nested.js : source.js;
  let html = safeText(htmlSource, "");
  let css = typeof cssSource === "string" ? cssSource : "";
  let js = typeof jsSource === "string" ? jsSource : "";

  // Some providers return JSON-double-encoded payload inside html.
  if (html.startsWith("{") && html.includes("\"html\"")) {
    const reparsed = extractFirstJsonObject(html);
    if (reparsed && typeof reparsed === "object") {
      const inner = coerceCodeBundle(reparsed);
      if (inner.html) {
        html = inner.html;
        css = inner.css || css;
        js = inner.js || js;
      }
    } else {
      const htmlMatch = html.match(/"html"\s*:\s*"([\s\S]*?)"\s*,\s*"css"\s*:/i);
      const cssMatch = html.match(/"css"\s*:\s*"([\s\S]*?)"\s*,\s*"js"\s*:/i);
      const jsMatch = html.match(/"js"\s*:\s*"([\s\S]*?)"\s*}\s*$/i);
      const htmlOnlyMatch = html.match(/"html"\s*:\s*"([\s\S]*?)"\s*}\s*$/i);
      const encodedHtml = htmlMatch?.[1] || htmlOnlyMatch?.[1] || "";
      if (htmlMatch?.[1]) {
        try {
          html = JSON.parse(`"${encodedHtml}"`);
          if (cssMatch?.[1]) css = JSON.parse(`"${cssMatch[1]}"`);
          if (jsMatch?.[1]) js = JSON.parse(`"${jsMatch[1]}"`);
        } catch {
          // keep original values when salvage parse fails
        }
      } else if (encodedHtml) {
        try {
          html = JSON.parse(`"${encodedHtml}"`);
        } catch {
          // keep original values when salvage parse fails
        }
      }
    }
  }

  // Last-resort salvage when html comes wrapped/escaped inside a JSON string.
  if (html.startsWith("{") && /<html[\s>]|<!doctype html/i.test(html)) {
    let decoded = html;
    if (decoded.includes("\\n") || decoded.includes('\\"')) {
      decoded = decoded.replace(/\\n/g, "\n").replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
    }
    const start = decoded.search(/<!doctype html|<html[\s>]/i);
    const lower = decoded.toLowerCase();
    const end = lower.lastIndexOf("</html>");
    if (start >= 0) {
      html = end > start ? decoded.slice(start, end + 7) : decoded.slice(start);
    }
  }
  return { html, css, js };
}

function looksLikeLowQualityOutput(prompt, codeBundle) {
  const promptText = String(prompt || "").toLowerCase();
  const merged = `${codeBundle?.html || ""}\n${codeBundle?.css || ""}\n${codeBundle?.js || ""}`;
  const lower = merged.toLowerCase();
  if (!merged.trim()) return true;
  if (!/<html[\s>]|<!doctype html/i.test(merged)) return true;
  if (!/<body[\s>]/i.test(merged)) return true;
  if (/{{|}}|<\?php|TODO:/i.test(merged)) return true;
  if (/sua empresa|site gerado por ia|lorem ipsum/.test(lower) && !/sua empresa|site gerado|lorem ipsum/.test(promptText)) {
    return true;
  }
  return false;
}

function detectThemeHints(prompt) {
  const text = String(prompt || "").toLowerCase();
  const hints = [];
  if (/\bazul\b/.test(text)) hints.push("azul");
  if (/\brosa\b/.test(text)) hints.push("rosa");
  if (/\bverde\b/.test(text)) hints.push("verde");
  if (/\bminimal\b|\bclean\b|\bclean\b|\bmoderno\b/.test(text)) hints.push("estilo");
  return hints;
}

function qualityMissingSignals(prompt, codeBundle) {
  const html = String(codeBundle?.html || "");
  const css = String(codeBundle?.css || "");
  const js = String(codeBundle?.js || "");
  const merged = `${html}\n${css}\n${js}`.toLowerCase();
  const missing = [];

  // 1) Visual moderno (heurístico)
  const hasModernVisual =
    /gradient|backdrop-filter|box-shadow|border-radius|glass|clamp\(|linear-gradient|radial-gradient/.test(merged);
  if (!hasModernVisual) missing.push("visual moderno");

  // 2) Fotos fortes na primeira seção/hero
  const firstChunk = html.slice(0, 4500).toLowerCase();
  const hasPhotoNearTop =
    /<img[\s\S]*?(hero|banner|topo|principal)|<img[\s\S]*?src=|background-image\s*:|url\((https?:)?\/\//.test(firstChunk);
  if (!hasPhotoNearTop) missing.push("foto forte na primeira seção");

  // 3) Efeitos visuais/animações
  const hasEffects = /@keyframes|animation:|transition:|transform:|parallax|hover/.test(merged);
  if (!hasEffects) missing.push("efeitos visuais/animações");

  // 4) WhatsApp flutuante
  const hasWhatsAppLink = /wa\.me|whatsapp/.test(merged);
  const hasFloating = /position\s*:\s*fixed/.test(merged);
  if (!(hasWhatsAppLink && hasFloating)) missing.push("botão flutuante de WhatsApp");

  // 5) Aderência mínima ao estilo/tema pedido (heurística leve)
  const themeHints = detectThemeHints(prompt);
  if (themeHints.length > 0) {
    const matches = themeHints.some((hint) => merged.includes(hint));
    if (!matches) missing.push("aderência ao tema/estilo pedido");
  }

  return missing;
}

async function generateCodeBundleWithZai({ prompt, previous, context }) {
  if (!ZAI_API_KEY) {
    throw new Error("zai_api_key_missing");
  }

  const systemPrompt = [
    "You are a principal frontend engineer focused on production-ready marketing websites.",
    "Return only strict JSON with keys: html, css, js. Never markdown.",
    "The html key MUST contain a full complete HTML document.",
    "Follow the user prompt exactly. Do not force fixed templates, fixed section counts, or predefined categories.",
    "Use the same language as the user prompt.",
    "Prioritize quality: modern visual style, polished typography, responsive layout and smooth visual effects/animations.",
    "The first visible section should include strong imagery/photos relevant to the prompt.",
    "Include a floating WhatsApp contact button in the interface.",
    "If the prompt asks a specific theme (color/style/layout), respect it strictly.",
    "Avoid generic placeholders unless the user explicitly asked for them.",
    "Output static, secure browser-safe code with responsive design.",
    "Keep the output concise enough to fit response limits. Prefer reusable CSS classes and avoid verbose repetitive markup.",
  ].join("\n");

  const attempts = [{ temperature: 0.45 }, { temperature: 0.25 }];

  let lastError = null;
  let lastMissingSignals = [];
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const attemptLabel = `attempt_${index + 1}`;
    const strictHint =
      index === 0
        ? ""
        : `CRITICAL: return valid JSON only and satisfy all quality requirements. Missing in previous attempt: ${lastMissingSignals.join(
            ", ",
          ) || "quality requirements"}.`;
    logSite("info", "code_generate_attempt", {
      attemptLabel,
      attempt: index + 1,
      customerId: context?.customerId || null,
      traceId: context?.traceId || null,
      model: ZAI_MODEL,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(8000, ZAI_TIMEOUT_MS));
    try {
      const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ZAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: ZAI_MODEL,
          thinking: { type: "disabled" },
          temperature: attempt.temperature,
          max_tokens: 3600,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                prompt: String(prompt || "").slice(0, 1800),
                previous: previous || null,
                context: context || {},
                strict: strictHint,
              }),
            },
          ],
        }),
        signal: controller.signal,
      });

      const raw = await response.text();
      const parsed = safeJson(raw);
      if (!response.ok) {
        throw new Error(`zai_http_${response.status}:${raw || "unknown"}`);
      }
      const message = parsed?.choices?.[0]?.message || {};
      const content = typeof message.content === "string" ? message.content : "";
      const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
      let modelPayload = extractFirstJsonObject(content) || extractFirstJsonObject(reasoning);
      if (!modelPayload && /<html[\s>]|<!doctype html/i.test(content)) {
        modelPayload = { html: content, css: "", js: "" };
      }
      if (!modelPayload || typeof modelPayload !== "object") {
        throw new Error("zai_invalid_json_output");
      }
      const coerced = coerceCodeBundle(modelPayload);
      const valid = codeBundleSchema.safeParse(coerced);
      if (!valid.success) {
        throw new Error("zai_invalid_code_schema");
      }
      if (looksLikeLowQualityOutput(prompt, valid.data)) {
        throw new Error("zai_low_quality_output");
      }
      const missingSignals = qualityMissingSignals(prompt, valid.data);
      if (missingSignals.length > 0) {
        lastMissingSignals = missingSignals;
        throw new Error(`zai_quality_requirements_missing:${missingSignals.join(",")}`);
      }
      return { code: valid.data, retryCount: index };
    } catch (error) {
      logSite("warn", "code_generate_attempt_failed", {
        attemptLabel,
        attempt: index + 1,
        customerId: context?.customerId || null,
        traceId: context?.traceId || null,
        error: String(error),
      });
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("code_generation_failed");
}

function codeToBuilderSpec(prompt, codeBundle, currentBuilder = null) {
  const _unused = currentBuilder;
  void _unused;
  const summary = summarizePrompt(prompt, 120) || "Site gerado por IA";
  const finalCode = coerceCodeBundle(codeBundle);
  const mergedHtml = composeDocument(finalCode);
  const compatibilityBlocks = [
    {
      id: "legacy-hero",
      label: "Legacy Hero",
      title: summary,
      body: "Compatibilidade temporária do payload legado.",
      enabled: true,
      origin: "default",
    },
    {
      id: "legacy-main",
      label: "Legacy Main",
      title: "Conteúdo principal",
      body: "Renderização oficial no V3 usa code { html, css, js }.",
      enabled: true,
      origin: "default",
    },
    {
      id: "legacy-cta",
      label: "Legacy CTA",
      title: "Ação",
      body: "Fluxo legado preservado temporariamente para não quebrar integrações.",
      enabled: true,
      origin: "default",
    },
  ];

  return {
    businessName: "",
    segment: "",
    city: "",
    audience: "",
    offerSummary: summary,
    mainDifferential: "",
    templateId: "legacy",
    paletteId: "legacy",
    headline: summary,
    subheadline: "Payload legado de compatibilidade (deprecated).",
    ctaLabel: "Falar no WhatsApp",
    whatsappNumber: "",
    heroImageUrl: "",
    customHtml: mergedHtml,
    customCss: "",
    customJs: "",
    blocks: compatibilityBlocks,
  };
}

async function generateBuilderSpecWithZai({ prompt, context, currentBuilder, fallbackSpec }) {
  if (!ZAI_API_KEY) return null;

  const systemPrompt = [
    "You generate high-converting landing page specs for a no-code mobile builder.",
    "Return only strict JSON, no markdown.",
    "Respect this schema keys exactly:",
    '{"businessName":"","segment":"","city":"","audience":"","offerSummary":"","mainDifferential":"","templateId":"","paletteId":"","headline":"","subheadline":"","ctaLabel":"","whatsappNumber":"","heroImageUrl":"","customHtml":"","customCss":"","customJs":"","blocks":[{"id":"","label":"","title":"","body":"","buttonText":"","enabled":true,"origin":"default"}]}',
    "blocks must contain between 3 and 18 items.",
    "Prefer origin=custom when inventing new sections.",
    "If you provide customHtml/customCss/customJs, keep it static-only, responsive and production-ready.",
    "Never include explanations, only JSON.",
  ].join("\n");

  const slimCurrentBuilder = currentBuilder && typeof currentBuilder === "object"
    ? {
        businessName: safeText(currentBuilder.businessName, ""),
        segment: safeText(currentBuilder.segment, ""),
        city: safeText(currentBuilder.city, ""),
        audience: safeText(currentBuilder.audience, ""),
        offerSummary: safeText(currentBuilder.offerSummary, ""),
        mainDifferential: safeText(currentBuilder.mainDifferential, ""),
        templateId: safeText(currentBuilder.templateId, ""),
        paletteId: safeText(currentBuilder.paletteId, ""),
        headline: safeText(currentBuilder.headline, ""),
        subheadline: safeText(currentBuilder.subheadline, ""),
        ctaLabel: safeText(currentBuilder.ctaLabel, ""),
        whatsappNumber: cleanPhone(currentBuilder.whatsappNumber || ""),
        blocks: Array.isArray(currentBuilder.blocks)
          ? currentBuilder.blocks.slice(0, 8).map((item, index) => ({
              id: safeText(item?.id, `b${index + 1}`),
              label: safeText(item?.label, "Bloco"),
              title: safeText(item?.title, "Bloco"),
              body: safeText(item?.body, "").slice(0, 500),
            }))
          : [],
      }
    : null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5000, ZAI_TIMEOUT_MS));

  try {
    const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        temperature: 0.35,
        max_tokens: 2200,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              prompt: String(prompt || "").slice(0, 1200),
              context: context || {},
              currentBuilder: slimCurrentBuilder,
              fallback: fallbackSpec,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    const parsed = safeJson(raw);
    if (!response.ok) {
      throw new Error(`zai_http_${response.status}:${raw || "unknown"}`);
    }
    const content = parsed?.choices?.[0]?.message?.content;
    const modelPayload = extractFirstJsonObject(content) || extractFirstJsonObject(raw);
    if (!modelPayload || typeof modelPayload !== "object") {
      throw new Error("zai_invalid_json_output");
    }
    return coerceBuilderSpec(modelPayload, fallbackSpec);
  } finally {
    clearTimeout(timeout);
  }
}

function renderSections(builderSpec) {
  const blocks = (builderSpec.blocks || []).filter((block) => block.enabled);
  return blocks
    .map((block) => {
      const button = block.buttonText
        ? `<button class=\"btn\">${escapeHtml(block.buttonText)}</button>`
        : "";
      return `
        <section class=\"section\" data-block-id=\"${escapeHtml(block.id)}\">
          <h2>${escapeHtml(block.title)}</h2>
          <p>${escapeHtml(block.body)}</p>
          ${button}
        </section>
      `;
    })
    .join("\n");
}

function renderHtml(builderSpec, mode) {
  const customHtml = safeText(builderSpec.customHtml, "");
  if (customHtml) {
    const modeAdjustedHtml =
      mode === "preview" ? customHtml.replace(/\bPublicado\b/g, "Preview") : customHtml.replace(/\bPreview\b/g, "Publicado");
    const customCss = safeText(builderSpec.customCss, "");
    const customJs = safeText(builderSpec.customJs, "");
    if (/<html[\s>]/i.test(modeAdjustedHtml)) {
      return modeAdjustedHtml;
    }
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(builderSpec.businessName || builderSpec.headline || "Site")}</title>
  ${customCss ? `<style>${customCss}</style>` : ""}
</head>
<body>
${modeAdjustedHtml}
${customJs ? `<script>${customJs}</script>` : ""}
</body>
</html>`;
  }

  const title = escapeHtml(builderSpec.businessName || builderSpec.headline || "Site");
  const subtitle = escapeHtml(builderSpec.subheadline || "");
  const cta = escapeHtml(builderSpec.ctaLabel || "Falar no WhatsApp");
  const whatsappNumber = cleanPhone(builderSpec.whatsappNumber || "");
  const whatsappHref = whatsappNumber ? `https://wa.me/${whatsappNumber}` : "#";
  const sections = renderSections(builderSpec);

  return `<!doctype html>
<html lang=\"pt-BR\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>${title}</title>
  <style>
    :root { --bg: #0d1218; --panel: #121922; --text: #e8edf5; --muted: #a7b1c2; --accent: #35e214; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); }
    .shell { max-width: 980px; margin: 0 auto; padding: 20px 14px 48px; }
    .hero { background: linear-gradient(145deg, #1a2432 0%, #0f1620 100%); border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 22px; }
    h1 { margin: 0 0 10px; font-size: clamp(1.6rem, 4vw, 2.5rem); line-height: 1.15; }
    .hero p { margin: 0 0 14px; color: var(--muted); }
    .badge { display:inline-flex; margin-bottom: 12px; background: rgba(53,226,20,.16); color: #c6ffc2; padding: 4px 10px; border-radius: 999px; font-size: 12px; }
    .btn { border: 0; border-radius: 999px; padding: 10px 16px; background: var(--accent); color: #071306; font-weight: 700; cursor: pointer; }
    .sections { display: grid; gap: 12px; margin-top: 14px; }
    .section { background: var(--panel); border: 1px solid rgba(255,255,255,.07); border-radius: 16px; padding: 14px; }
    .section h2 { margin: 0 0 8px; font-size: 1.05rem; }
    .section p { margin: 0; color: var(--muted); white-space: pre-wrap; }
  </style>
</head>
<body>
  <main class=\"shell\">
    <section class=\"hero\">
      <span class=\"badge\">${mode === "preview" ? "Preview" : "Publicado"}</span>
      <h1>${title}</h1>
      <p>${subtitle}</p>
      <a href=\"${escapeHtml(whatsappHref)}\"><button class=\"btn\">${cta}</button></a>
    </section>
    <section class=\"sections\">${sections}</section>
  </main>
</body>
</html>`;
}

async function writeSiteBundle(targetDir, metadata, html) {
  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(targetDir, "index.html"), html, "utf8"),
    fs.writeFile(path.join(targetDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8"),
  ]);
}

async function publishPreview(payload, slug) {
  const dir = path.join(SITE_PUBLISH_ROOT, "sites-preview", slug);
  const html = renderHtml(payload.builderSpec, "preview");
  const metadata = {
    mode: "preview",
    slug,
    orderId: payload.orderId,
    updatedAt: new Date().toISOString(),
    source: "bolt-diy-adapter-v1",
  };
  await writeSiteBundle(dir, metadata, html);

  return {
    stage: "preview_ready",
    slug,
    url: `${PUBLIC_BASE_URL}/sites-preview/${encodeURIComponent(slug)}`,
  };
}

async function publishFinal(payload, slug) {
  const tmpRoot = path.join(SITE_PUBLISH_ROOT, ".tmp");
  const targetDir = path.join(SITE_PUBLISH_ROOT, "sites", slug);
  const tmpDir = path.join(tmpRoot, `${slug}-${Date.now()}`);

  const html = renderHtml(payload.builderSpec, "final");
  const metadata = {
    mode: "final",
    slug,
    orderId: payload.orderId,
    updatedAt: new Date().toISOString(),
    source: "bolt-diy-adapter-v1",
  };

  await fs.mkdir(tmpRoot, { recursive: true });
  await writeSiteBundle(tmpDir, metadata, html);

  const backupDir = `${targetDir}.__old`;
  let hadPriorBuild = false;

  try {
    await fs.rename(targetDir, backupDir);
    hadPriorBuild = true;
  } catch {
    // no prior stable build
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  try {
    await fs.rename(tmpDir, targetDir);
  } catch (error) {
    if (hadPriorBuild) {
      try {
        await fs.rename(backupDir, targetDir);
      } catch {
        // best effort rollback
      }
    }
    throw error;
  }

  try {
    await fs.rm(backupDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }

  return {
    stage: "published",
    slug,
    url: `${PUBLIC_BASE_URL}/sites/${encodeURIComponent(slug)}`,
  };
}

async function publishPreviewCode(payload, slug) {
  const dir = path.join(SITE_PUBLISH_ROOT, "sites-preview", slug);
  const html = composeDocument(payload.code);
  if (!html) throw new Error("code_bundle_empty_html");

  const metadata = {
    mode: "preview",
    slug,
    orderId: payload.orderId,
    updatedAt: new Date().toISOString(),
    source: "site-builder-v3-raw",
  };
  await writeSiteBundle(dir, metadata, html);

  return {
    stage: "preview_ready",
    slug,
    url: `${PUBLIC_BASE_URL}/sites-preview/${encodeURIComponent(slug)}`,
  };
}

async function publishFinalCode(payload, slug) {
  const tmpRoot = path.join(SITE_PUBLISH_ROOT, ".tmp");
  const targetDir = path.join(SITE_PUBLISH_ROOT, "sites", slug);
  const tmpDir = path.join(tmpRoot, `${slug}-${Date.now()}`);
  const html = composeDocument(payload.code);
  if (!html) throw new Error("code_bundle_empty_html");

  const metadata = {
    mode: "final",
    slug,
    orderId: payload.orderId,
    updatedAt: new Date().toISOString(),
    source: "site-builder-v3-raw",
  };

  await fs.mkdir(tmpRoot, { recursive: true });
  await writeSiteBundle(tmpDir, metadata, html);

  const backupDir = `${targetDir}.__old`;
  let hadPriorBuild = false;

  try {
    await fs.rename(targetDir, backupDir);
    hadPriorBuild = true;
  } catch {
    // no prior stable build
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  try {
    await fs.rename(tmpDir, targetDir);
  } catch (error) {
    if (hadPriorBuild) {
      try {
        await fs.rename(backupDir, targetDir);
      } catch {
        // best effort rollback
      }
    }
    throw error;
  }

  try {
    await fs.rm(backupDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }

  return {
    stage: "published",
    slug,
    url: `${PUBLIC_BASE_URL}/sites/${encodeURIComponent(slug)}`,
  };
}

app.get("/health", async (_req, res) => {
  return res.json({
    ok: true,
    engine: "site-builder-v3-raw",
    vendorPath: BOLT_VENDOR_PATH,
    vendorPresent: hasBoltVendor(),
  });
});

app.post("/v1/autobuild", async (req, res) => {
  const parsed = autobuildSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const { prompt, context, currentBuilder } = parsed.data;
    const fallbackSpec = inferBaseSpec(prompt, context, currentBuilder || null);
    let builderSpecRaw = fallbackSpec;
    let engine = "bolt-diy-adapter-v1";

    try {
      const aiSpec = await generateBuilderSpecWithZai({
        prompt,
        context: context || {},
        currentBuilder: currentBuilder || null,
        fallbackSpec,
      });
      if (aiSpec) {
        builderSpecRaw = aiSpec;
        engine = `zai-${ZAI_MODEL}`;
      }
    } catch (zaiError) {
      console.error("autobuild_zai_failed", String(zaiError));
    }

    const validSpec = builderSpecSchema.safeParse(builderSpecRaw);
    if (!validSpec.success) {
      return res.status(500).json({ error: "autobuild_invalid_spec", issues: validSpec.error.flatten() });
    }

    return res.json({
      builderSpec: validSpec.data,
      meta: {
        engine,
        vendorPresent: hasBoltVendor(),
        generatedAt: new Date().toISOString(),
        aiEnabled: Boolean(ZAI_API_KEY),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "autobuild_failed", message: String(error) });
  }
});

app.post("/v1/code/generate", async (req, res) => {
  const parsed = codeGenerateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    logSite("warn", "code_generate_invalid_payload", {
      issues: parsed.error.flatten(),
    });
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const traceId = String(parsed.data.context?.traceId || `sb-${Date.now().toString(36)}`);
  try {
    const { prompt, previous, context } = parsed.data;
    logSite("info", "code_generate_start", {
      traceId,
      promptLength: prompt.length,
      hasPreviousHtml: Boolean(previous?.html),
      customerId: context?.customerId || null,
    });

    const aiResult = await generateCodeBundleWithZai({ prompt, previous: previous || null, context: context || {} });
    const code = aiResult.code;
    const retryCount = aiResult.retryCount;
    if (!code || typeof code.html !== "string" || !code.html.trim()) {
      throw new Error("code_generate_empty_html");
    }

    codeGenerationFailureCounter.delete(promptFailureKey(prompt));
    logSite("info", "code_generate_success", {
      traceId,
      customerId: context?.customerId || null,
      retryCount,
      htmlLength: code.html.length,
      cssLength: typeof code.css === "string" ? code.css.length : 0,
      jsLength: typeof code.js === "string" ? code.js.length : 0,
    });
    return res.json({
      code,
      meta: {
        engine: `zai-${ZAI_MODEL}`,
        generatedAt: new Date().toISOString(),
        aiEnabled: Boolean(ZAI_API_KEY),
        retryCount,
      },
    });
  } catch (error) {
    const key = promptFailureKey(parsed.data.prompt);
    const failures = (codeGenerationFailureCounter.get(key) || 0) + 1;
    codeGenerationFailureCounter.set(key, failures);
    logSite("error", "code_generate_failed", {
      traceId,
      promptKey: key,
      failuresForPrompt: failures,
      error: String(error),
    });
    return res.status(502).json({
      error: "code_generation_failed",
      message: "Falha ao gerar o site com IA. Tente novamente.",
      retryCount: 2,
      failuresForPrompt: failures,
      detail: String(error),
    });
  }
});

app.post("/v1/publish/preview-code", async (req, res) => {
  const parsed = publishCodeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    logSite("warn", "preview_code_publish_invalid_payload", { issues: parsed.error.flatten() });
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const slug = slugify(parsed.data.slug || parsed.data.orderId, `site-${Date.now()}`);
    logSite("info", "preview_code_publish_start", {
      slug,
      orderId: parsed.data.orderId,
      customerId: parsed.data.customerId || null,
      htmlLength: parsed.data.code.html.length,
    });
    const published = await publishPreviewCode(parsed.data, slug);
    logSite("info", "preview_code_publish_success", {
      slug,
      orderId: parsed.data.orderId,
      url: published.url,
    });
    return res.status(201).json(published);
  } catch (error) {
    logSite("error", "preview_code_publish_failed", { error: String(error) });
    return res.status(500).json({ error: "preview_code_publish_failed", message: String(error) });
  }
});

app.post("/v1/publish/final-code", async (req, res) => {
  const parsed = publishCodeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    logSite("warn", "final_code_publish_invalid_payload", { issues: parsed.error.flatten() });
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const slug = slugify(parsed.data.slug || parsed.data.orderId, `site-${Date.now()}`);
    logSite("info", "final_code_publish_start", {
      slug,
      orderId: parsed.data.orderId,
      customerId: parsed.data.customerId || null,
      htmlLength: parsed.data.code.html.length,
    });
    const published = await publishFinalCode(parsed.data, slug);
    logSite("info", "final_code_publish_success", {
      slug,
      orderId: parsed.data.orderId,
      url: published.url,
    });
    return res.status(201).json(published);
  } catch (error) {
    logSite("error", "final_code_publish_failed", { error: String(error) });
    return res.status(500).json({ error: "final_code_publish_failed", message: String(error) });
  }
});

app.post("/v1/publish/preview", async (req, res) => {
  const parsed = publishSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const slug = slugify(parsed.data.slug || parsed.data.builderSpec.businessName || parsed.data.orderId, `site-${Date.now()}`);
    const published = await publishPreview(parsed.data, slug);
    return res.status(201).json(published);
  } catch (error) {
    return res.status(500).json({ error: "preview_publish_failed", message: String(error) });
  }
});

app.post("/v1/publish/final", async (req, res) => {
  const parsed = publishSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const slug = slugify(parsed.data.slug || parsed.data.builderSpec.businessName || parsed.data.orderId, `site-${Date.now()}`);
    const published = await publishFinal(parsed.data, slug);
    return res.status(201).json(published);
  } catch (error) {
    return res.status(500).json({ error: "final_publish_failed", message: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`site-builder-api listening on http://localhost:${PORT}`);
});
