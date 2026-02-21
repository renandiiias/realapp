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

function fallbackCodeBundle(prompt) {
  const text = summarizePrompt(prompt, 180) || "Site sob medida";
  return {
    html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(text)}</title>
  <style>
    body {
      background: #0066cc;
      color: #ffffff;
      font-family: Arial, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    h1 { font-size: clamp(2rem, 6vw, 3rem); margin: 0 0 12px; }
    p { font-size: 1.1rem; opacity: .92; margin: 0 0 18px; }
    button {
      background: #003366;
      color: #fff;
      border: 2px solid #fff;
      border-radius: 10px;
      padding: 10px 18px;
      font-weight: 700;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Site criado por IA</h1>
  <p>${escapeHtml(text)}</p>
  <button>Fale com a gente</button>
</body>
</html>`,
    css: "",
    js: "",
  };
}

function coerceCodeBundle(candidate, fallback) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const html = safeText(source.html, fallback.html);
  const css = safeText(source.css, fallback.css || "");
  const js = safeText(source.js, fallback.js || "");
  return { html, css, js };
}

async function generateCodeBundleWithZai({ prompt, previous, context }) {
  if (!ZAI_API_KEY) return null;

  const systemPrompt = [
    "You are a senior frontend engineer.",
    "Return only strict JSON with keys: html, css, js.",
    "html can be a complete HTML document or a body fragment.",
    "Do not use markdown, do not explain, output only JSON.",
    "Follow the user prompt exactly and make visual changes obvious.",
    "Keep code static and safe for direct browser rendering.",
  ].join("\n");

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
        temperature: 0.45,
        max_tokens: 3200,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify({
              prompt: String(prompt || "").slice(0, 1800),
              previous: previous || null,
              context: context || {},
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
    const coerced = coerceCodeBundle(modelPayload, fallbackCodeBundle(prompt));
    const valid = codeBundleSchema.safeParse(coerced);
    if (!valid.success) {
      throw new Error("zai_invalid_code_schema");
    }
    return valid.data;
  } finally {
    clearTimeout(timeout);
  }
}

function codeToBuilderSpec(prompt, codeBundle, currentBuilder = null) {
  const base = inferBaseSpec(prompt, {}, currentBuilder);
  const finalCode = coerceCodeBundle(codeBundle, fallbackCodeBundle(prompt));
  const mergedHtml = composeDocument(finalCode);
  return {
    ...base,
    customHtml: mergedHtml,
    customCss: "",
    customJs: "",
    blocks: normalizeBlocks(
      [
        {
          id: "preview",
          label: "Preview",
          title: summarizePrompt(prompt, 72) || "Preview gerado",
          body: "Código livre gerado por IA.",
          enabled: true,
          origin: "custom",
        },
        {
          id: "edicao",
          label: "Edição",
          title: "Refine por prompt",
          body: "Envie ajustes e a IA reescreve o HTML/CSS/JS.",
          enabled: true,
          origin: "custom",
        },
        {
          id: "deploy",
          label: "Deploy",
          title: "Pronto para publicar",
          body: "Quando aprovar o preview, publique no link final.",
          enabled: true,
          origin: "custom",
        },
      ],
      base.blocks,
      base.ctaLabel,
    ),
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

app.get("/health", async (_req, res) => {
  return res.json({
    ok: true,
    engine: "bolt-diy-adapter-v1",
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
    return res.status(400).json({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  try {
    const { prompt, previous, context } = parsed.data;
    let code = fallbackCodeBundle(prompt);
    let engine = "fallback-code";

    try {
      const aiCode = await generateCodeBundleWithZai({ prompt, previous: previous || null, context: context || {} });
      if (aiCode) {
        code = aiCode;
        engine = `zai-${ZAI_MODEL}`;
      }
    } catch (zaiError) {
      console.error("code_generate_zai_failed", String(zaiError));
    }

    const builderSpec = codeToBuilderSpec(prompt, code, null);
    const validSpec = builderSpecSchema.safeParse(builderSpec);
    if (!validSpec.success) {
      return res.status(500).json({ error: "code_generate_invalid_spec", issues: validSpec.error.flatten() });
    }

    return res.json({
      code,
      builderSpec: validSpec.data,
      meta: {
        engine,
        generatedAt: new Date().toISOString(),
        aiEnabled: Boolean(ZAI_API_KEY),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: "code_generate_failed", message: String(error) });
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
