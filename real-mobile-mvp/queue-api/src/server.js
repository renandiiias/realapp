const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { z } = require("zod");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3334);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || "real-auth-api";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "real-mobile-app";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const OPS_API_KEY = process.env.OPS_API_KEY;
const WORKER_API_KEY = process.env.WORKER_API_KEY;
const WORKER_LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS || 120);
const ASSET_STORAGE_DIR = process.env.ASSET_STORAGE_DIR || path.resolve(__dirname, "../storage/order-assets");
const DEBUG_LOG_DIR = process.env.DEBUG_LOG_DIR || path.resolve(__dirname, "../storage/logs");
const DEBUG_EVENTS_FILE = path.join(DEBUG_LOG_DIR, "client-events.jsonl");
const INCIDENT_REPORT_DIR = path.join(DEBUG_LOG_DIR, "incidents");
const ADS_DASHBOARD_CACHE_TTL_SECONDS = Number(process.env.ADS_DASHBOARD_CACHE_TTL_SECONDS || 300);
const META_ACCESS_TOKEN = (process.env.META_ACCESS_TOKEN || "").trim();
const META_AD_ACCOUNT_ID = (process.env.META_AD_ACCOUNT_ID || "").trim().replace(/^act_/, "");
const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "v21.0").trim();
const META_API_BASE = "https://graph.facebook.com";
const SITE_BUILDER_API_BASE_URL = (process.env.SITE_BUILDER_API_BASE_URL || "http://localhost:3340").replace(/\/+$/, "");

if (!DATABASE_URL) throw new Error("DATABASE_URL é obrigatória");
if (!JWT_SECRET || JWT_SECRET.length < 24) throw new Error("JWT_SECRET inválida");
if (!OPS_API_KEY || !WORKER_API_KEY) throw new Error("OPS_API_KEY e WORKER_API_KEY são obrigatórias");

const pool = new Pool({ connectionString: DATABASE_URL });
const app = express();
const incidentStateByFingerprint = new Map();

app.use(helmet());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    methods: ["GET", "POST", "PATCH"],
  }),
);
app.use(express.json({ limit: "25mb" }));

function log(level, message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }));
}

const SENSITIVE_KEY_RE = /(token|authorization|password|cookie|secret|api[_-]?key)/i;
const SENSITIVE_VALUE_PATTERNS = [/bearer\s+[a-z0-9._-]+/gi, /sk-[a-z0-9]{12,}/gi];

function redactValue(value, keyHint = "") {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SENSITIVE_KEY_RE.test(keyHint)) return "***";
    let out = value;
    for (const pattern of SENSITIVE_VALUE_PATTERNS) {
      out = out.replace(pattern, "***");
    }
    return out.slice(0, 2000);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, keyHint));
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactValue(item, key);
    }
    return out;
  }
  return String(value).slice(0, 300);
}

async function ensureDebugLogDirs() {
  await fs.mkdir(DEBUG_LOG_DIR, { recursive: true });
  await fs.mkdir(INCIDENT_REPORT_DIR, { recursive: true });
}

function sanitizeFingerprint(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function computeFingerprint({ stage, event, meta }) {
  const errorType = String(meta?.error_type || meta?.errorType || meta?.name || "unknown_error").slice(0, 120);
  const message = String(meta?.error || meta?.message || event || "no_message").slice(0, 320);
  const stack = String(meta?.stack || "").split("\n").slice(0, 6).join("|").slice(0, 600);
  const context = String(meta?.context || stage || "").slice(0, 180);
  return `${errorType}::${message}::${stack}::${context}`;
}

function summarizeImpact(level) {
  if (level >= 3) return "Crítico: falha recorrente com correlação por trace_id necessária.";
  if (level >= 2) return "Alto: erro recorrente afeta fluxo do usuário e exige investigação imediata.";
  if (level >= 1) return "Moderado: recorrência detectada, monitoramento ampliado.";
  return "Baixo: ocorrência isolada.";
}

async function writeIncidentReport({ fingerprint, level, frequency, event }) {
  const ts = new Date().toISOString();
  const safeFingerprint = sanitizeFingerprint(fingerprint) || "unknown";
  const fileName = `incident-${safeFingerprint}-${ts.replace(/[:.]/g, "-")}.md`;
  const fullPath = path.join(INCIDENT_REPORT_DIR, fileName);
  const body = [
    `# Incident ${safeFingerprint}`,
    "",
    `- horário: ${ts}`,
    `- fingerprint: ${fingerprint}`,
    `- frequência: ${frequency} ocorrências em 15 minutos`,
    `- impacto: ${summarizeImpact(level)}`,
    "- hipótese: regressão funcional ou instabilidade intermitente no fluxo de entregas/serviços.",
    `- tentativas feitas: escalonamento automático para L${level}, coleta de logs detalhados e redacted.`,
    "- próximos passos: validar stack/trace_id, reproduzir em ambiente controlado, aplicar correção e monitorar 30 minutos.",
    "- status: aberto",
    "",
    "## Último evento",
    "```json",
    JSON.stringify(event, null, 2),
    "```",
    "",
  ].join("\n");
  await fs.writeFile(fullPath, body, "utf8");
  return fullPath;
}

async function handleIncidentEscalation({ fingerprint, baseEvent, now }) {
  const nowMs = now.getTime();
  const bucket = incidentStateByFingerprint.get(fingerprint) || {
    level: 0,
    timestamps: [],
    lastAtMs: 0,
  };

  if (bucket.lastAtMs > 0 && nowMs - bucket.lastAtMs > 30 * 60 * 1000) {
    bucket.level = 0;
    bucket.timestamps = [];
  }

  bucket.lastAtMs = nowMs;
  bucket.timestamps = bucket.timestamps.filter((tsMs) => nowMs - tsMs <= 15 * 60 * 1000);
  bucket.timestamps.push(nowMs);

  const frequency = bucket.timestamps.length;
  const nextLevel = frequency >= 8 ? 3 : frequency >= 5 ? 2 : frequency >= 3 ? 1 : 0;
  bucket.level = nextLevel;
  incidentStateByFingerprint.set(fingerprint, bucket);

  const escalationEvent = {
    ...baseEvent,
    incident: {
      fingerprint,
      frequency_15m: frequency,
      level: `L${nextLevel}`,
      trace_id: baseEvent.trace_id,
      run_id: baseEvent.trace_id,
    },
  };

  let incidentReportPath = null;
  if (nextLevel >= 2) {
    incidentReportPath = await writeIncidentReport({
      fingerprint,
      level: nextLevel,
      frequency,
      event: escalationEvent,
    });
  }

  return {
    level: nextLevel,
    frequency,
    incidentReportPath,
    escalationEvent,
  };
}

const createOrderSchema = z.object({
  type: z.enum(["ads", "site", "content", "video_editor"]),
  title: z.string().min(2).max(180),
  summary: z.string().min(2).max(500),
  payload: z.record(z.any()).default({}),
});

const updateOrderSchema = z.object({
  title: z.string().min(2).max(180).optional(),
  summary: z.string().min(2).max(500).optional(),
  payload: z.record(z.any()).optional(),
  priority: z.number().int().optional(),
  status: z.literal("draft").optional(),
});

const infoSchema = z.object({
  message: z.string().min(2).max(2000),
});

const approvalSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  feedback: z.string().max(2000).optional(),
});

const opsStatusSchema = z.object({
  status: z.enum(["draft", "waiting_payment", "queued", "in_progress", "needs_approval", "needs_info", "blocked", "done", "failed"]),
  message: z.string().max(1000).optional(),
});

const completeSchema = z.object({
  status: z.enum(["done", "needs_approval", "needs_info", "failed", "blocked", "queued", "in_progress"]),
  message: z.string().max(1000).optional(),
});

const eventSchema = z.object({
  actor: z.enum(["client", "codex", "ops"]).optional(),
  message: z.string().min(2).max(2000),
  statusSnapshot: z.enum(["draft", "waiting_payment", "queued", "in_progress", "needs_approval", "needs_info", "blocked", "done", "failed"]).optional(),
});

const deliverableTypeSchema = z.enum(["creative", "copy", "audience_summary", "campaign_plan", "wireframe", "url_preview", "calendar", "posts", "reels_script"]);
const deliverableStatusSchema = z.enum(["draft", "submitted", "approved", "changes_requested", "published"]);

const deliverablesSchema = z.object({
  deliverables: z.array(
    z.object({
      id: z.string().uuid().optional(),
      type: deliverableTypeSchema,
      status: deliverableStatusSchema,
      content: z.any().optional(),
      assetUrls: z.array(z.string().url()).optional(),
    }),
  ),
});

const entitlementSchema = z.object({
  planActive: z.boolean(),
});

const claimSchema = z.object({
  workerId: z.string().min(2).max(120).optional(),
  leaseSeconds: z.number().int().min(30).max(900).optional(),
});

const heartbeatSchema = z.object({
  workerId: z.string().min(2).max(120),
  lastError: z.string().max(1000).optional(),
  claimed: z.boolean().optional(),
});

const orderAssetKindSchema = z.enum(["image", "video"]);

const uploadAssetSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(3).max(120),
  base64Data: z.string().min(32),
  kind: orderAssetKindSchema.optional(),
  sizeBytes: z.number().int().positive().max(30 * 1024 * 1024).optional(),
});

const adsPublicationSchema = z.object({
  metaCampaignId: z.string().min(2).max(120).optional(),
  metaAdsetId: z.string().min(2).max(120).optional(),
  metaAdId: z.string().min(2).max(120).optional(),
  metaCreativeId: z.string().min(2).max(120).optional(),
  status: z.string().min(2).max(60),
  rawResponse: z.any().optional(),
});

const siteAutobuildSchema = z.object({
  prompt: z.string().min(4).max(2000),
  context: z.record(z.any()).optional(),
  currentBuilder: z.record(z.any()).optional(),
  forceRegenerate: z.boolean().optional(),
});

const liveSiteGenerateSchema = z.object({
  prompt: z.string().min(4).max(3000),
  previous: z
    .object({
      slug: z.string().max(120).optional(),
      code: z
        .object({
          html: z.string().max(250000).optional(),
          css: z.string().max(120000).optional(),
          js: z.string().max(120000).optional(),
        })
        .optional(),
    })
    .optional(),
});

const liveSitePublishSchema = z.object({
  slug: z.string().min(2).max(120),
  code: z
    .object({
      html: z.string().max(250000).optional(),
      css: z.string().max(120000).optional(),
      js: z.string().max(120000).optional(),
    })
    .refine((value) => typeof value?.html === "string" && value.html.trim().length > 0, {
      message: "code.html é obrigatório",
    }),
});

const sitePublicationSchema = z.object({
  stage: z.enum(["draft", "building", "preview_ready", "awaiting_approval", "publishing", "published", "failed"]),
  slug: z.string().max(120).optional(),
  previewUrl: z.string().url().optional(),
  publicUrl: z.string().url().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  lastError: z.string().max(2000).optional(),
  metadata: z.any().optional(),
});

const debugClientEventSchema = z.object({
  trace_id: z.string().min(4).max(180),
  stage: z.string().min(2).max(120),
  event: z.string().min(2).max(160),
  level: z.enum(["info", "warn", "error"]).optional(),
  ts_utc: z.string().datetime().optional(),
  fingerprint: z.string().max(1000).optional(),
  meta: z.record(z.any()).optional(),
});

function parseBearerToken(req) {
  const authHeader = req.header("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim();
}

function authClient(req, res, next) {
  if (req.path.startsWith("/ops")) return next();
  const token = parseBearerToken(req);
  if (!token) return res.status(401).json({ error: "Token ausente." });

  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido." });
  }
}

function authOpsWorker(req, _res, next) {
  const key = req.header("x-api-key") || "";
  if (key && key === OPS_API_KEY) {
    req.role = "ops";
  } else if (key && key === WORKER_API_KEY) {
    req.role = "worker";
  } else {
    req.role = null;
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(401).json({ error: "Não autorizado." });
    }
    return next();
  };
}

function isApprovalType(type) {
  return type === "creative" || type === "copy";
}

async function appendEvent(client, { orderId, actor, message, statusSnapshot }) {
  await client.query(
    `insert into order_events (id, order_id, actor, message, status_snapshot)
     values ($1, $2, $3, $4, $5)`,
    [randomUUID(), orderId, actor, message, statusSnapshot ?? null],
  );
}

function mapOrder(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    summary: row.summary,
    payload: row.payload || {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    ts: row.ts.toISOString(),
    actor: row.actor,
    message: row.message,
    statusSnapshot: row.status_snapshot || undefined,
  };
}

function mapDeliverable(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    status: row.status,
    content: row.content || {},
    assetUrls: Array.isArray(row.asset_urls) ? row.asset_urls : [],
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapApproval(row) {
  return {
    deliverableId: row.deliverable_id,
    status: row.status,
    feedback: row.feedback || "",
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapOrderAsset(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    kind: row.kind,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at.toISOString(),
  };
}

function mapAdsPublication(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    customerId: row.customer_id,
    metaCampaignId: row.meta_campaign_id || null,
    metaAdsetId: row.meta_adset_id || null,
    metaAdId: row.meta_ad_id || null,
    metaCreativeId: row.meta_creative_id || null,
    status: row.status || "unknown",
    rawResponse: row.raw_response || {},
    lastSyncAt: row.last_sync_at ? row.last_sync_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

function mapSitePublication(row) {
  if (!row) return null;
  return {
    orderId: row.order_id,
    customerId: row.customer_id,
    stage: row.stage || "draft",
    slug: row.slug || null,
    previewUrl: row.preview_url || null,
    publicUrl: row.public_url || null,
    retries: Number(row.retries || 0),
    lastError: row.last_error || null,
    metadata: row.metadata || {},
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

function safeJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function createSiteBuilderHttpError(status, data, raw) {
  const safeStatus = Number(status) || 500;
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : { raw };
  const message = typeof payload.error === "string" ? payload.error : raw || "site_builder_unavailable";
  const error = new Error(`site_builder_http_${safeStatus}:${message}`);
  error.status = safeStatus;
  error.payload = payload;
  error.raw = raw;
  return error;
}

async function siteBuilderApi(apiPath, payload) {
  const response = await fetch(`${SITE_BUILDER_API_BASE_URL}${apiPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });
  const raw = await response.text();
  const data = safeJson(raw);
  if (!response.ok) {
    throw createSiteBuilderHttpError(response.status, data, raw);
  }
  return data;
}

function safeBaseName(input) {
  const raw = String(input || "").trim() || "asset.bin";
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "asset.bin";
}

function toLiveSiteSlug(customerId, input) {
  const base = String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const customerPart = String(customerId || "").slice(0, 8).toLowerCase();
  if (base) {
    if (customerPart && base.endsWith(`-${customerPart}`)) return base;
    return customerPart ? `${base}-${customerPart}`.slice(0, 64) : base;
  }
  return `site-${customerPart}-${Date.now().toString(36)}`;
}

function normalizeMimeType(mimeType, fileName) {
  const normalized = String(mimeType || "").trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  if (normalized.startsWith("video/")) return normalized;
  const ext = path.extname(String(fileName || "").toLowerCase());
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "image/jpeg";
  if ([".mp4", ".mov", ".m4v", ".webm"].includes(ext)) return "video/mp4";
  return normalized || "application/octet-stream";
}

function mimeToAssetKind(mimeType) {
  const lower = String(mimeType || "").toLowerCase();
  if (lower.startsWith("video/")) return "video";
  return "image";
}

function extractLeadActions(actions) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const type = String(item.action_type || "");
    const value = Number(item.value || 0);
    if (!Number.isFinite(value)) return acc;
    if (
      type === "lead" ||
      type === "onsite_conversion.lead_grouped" ||
      type === "offsite_conversion.fb_pixel_lead" ||
      type === "onsite_web_lead"
    ) {
      return acc + value;
    }
    return acc;
  }, 0);
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function toIsoDateUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeMetaStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function mapCreativeStatus(status) {
  const normalized = normalizeMetaStatus(status);
  if (normalized === "PAUSED" || normalized === "CAMPAIGN_PAUSED" || normalized === "ADSET_PAUSED") return "paused";
  if (normalized === "LEARNING" || normalized === "IN_PROCESS") return "learning";
  if (normalized === "ACTIVE") return "active";
  return "ended";
}

function isActiveStatus(status) {
  return normalizeMetaStatus(status) === "ACTIVE";
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
}

function toDailySeriesRow(input) {
  const date = String(input?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    spend: toFiniteNumber(input.spend),
    leads: toFiniteNumber(input.leads),
  };
}

function buildZeroDailySeries(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const list = [];
  for (let day = 1; day <= today; day += 1) {
    list.push({
      date: toIsoDateUTC(new Date(Date.UTC(year, month, day))),
      spend: 0,
      leads: 0,
    });
  }
  return list;
}

function withDashboardDefaults(snapshot, { stale = false } = {}) {
  const now = new Date();
  const input = snapshot && typeof snapshot === "object" ? snapshot : {};
  const parsedDaily = Array.isArray(input.dailySeries) ? input.dailySeries.map(toDailySeriesRow).filter(Boolean) : [];
  const normalizedDaily = parsedDaily.length > 0 ? parsedDaily : buildZeroDailySeries(now);

  return {
    source: "remote",
    scope: "customer_campaigns",
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now.toISOString(),
    monthlySpend: toFiniteNumber(input.monthlySpend),
    monthlyLeads: toFiniteNumber(input.monthlyLeads),
    cpl: typeof input.cpl === "number" && Number.isFinite(input.cpl) ? input.cpl : null,
    previousMonthSpend: toFiniteNumber(input.previousMonthSpend),
    previousMonthLeads: toFiniteNumber(input.previousMonthLeads),
    previousMonthCpl: typeof input.previousMonthCpl === "number" && Number.isFinite(input.previousMonthCpl) ? input.previousMonthCpl : null,
    activeCampaigns: toFiniteNumber(input.activeCampaigns),
    activeCreatives: toFiniteNumber(input.activeCreatives),
    creativesRunning: Array.isArray(input.creativesRunning)
      ? input.creativesRunning
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            id: String(item.id || randomUUID()),
            name: String(item.name || "Criativo"),
            campaignName: String(item.campaignName || "Campanha"),
            adSetName: String(item.adSetName || ""),
            status: mapCreativeStatus(item.status),
            spend: toFiniteNumber(item.spend),
            leads: toFiniteNumber(item.leads),
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
          }))
      : [],
    dailySeries: normalizedDaily,
    stale: Boolean(stale || input.stale),
  };
}

function buildDashboardFromPublications(publications, { stale = false } = {}) {
  const nowIso = new Date().toISOString();
  const campaignIds = uniqueNonEmpty(publications.map((row) => row.meta_campaign_id));
  const adIds = uniqueNonEmpty(publications.map((row) => row.meta_ad_id));

  const campaignStatusMap = new Map();
  const adStatusMap = new Map();
  for (const row of publications) {
    const campaignId = String(row.meta_campaign_id || "").trim();
    const adId = String(row.meta_ad_id || "").trim();
    const status = normalizeMetaStatus(row.status);
    if (campaignId && !campaignStatusMap.has(campaignId)) campaignStatusMap.set(campaignId, status);
    if (adId && !adStatusMap.has(adId)) adStatusMap.set(adId, status);
  }

  const activeCampaigns = campaignIds.filter((id) => isActiveStatus(campaignStatusMap.get(id))).length;
  const activeCreatives = adIds.filter((id) => isActiveStatus(adStatusMap.get(id))).length;

  const creativesRunning = publications
    .filter((row) => String(row.meta_ad_id || "").trim())
    .slice(0, 20)
    .map((row, index) => ({
      id: String(row.meta_ad_id || `publication-${index + 1}`),
      name: row.title ? `${String(row.title).slice(0, 52)} • Criativo` : `Criativo ${index + 1}`,
      campaignName: row.title ? String(row.title).slice(0, 52) : "Campanha",
      status: mapCreativeStatus(row.status),
      spend: 0,
      leads: 0,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : nowIso,
    }));

  return withDashboardDefaults(
    {
      updatedAt: nowIso,
      monthlySpend: 0,
      monthlyLeads: 0,
      cpl: null,
      previousMonthSpend: 0,
      previousMonthLeads: 0,
      previousMonthCpl: null,
      activeCampaigns,
      activeCreatives,
      creativesRunning,
      dailySeries: buildZeroDailySeries(),
    },
    { stale },
  );
}

async function fetchInsightsByCampaignIds(campaignIds, { datePreset, timeIncrement } = {}) {
  if (!campaignIds.length) return [];
  const fields = "campaign_id,campaign_name,adset_name,ad_id,ad_name,spend,actions,date_start";
  const settled = await Promise.allSettled(
    campaignIds.map((campaignId) =>
      metaGet(`${campaignId}/insights`, {
        date_preset: datePreset,
        level: "ad",
        fields,
        limit: "500",
        ...(timeIncrement ? { time_increment: String(timeIncrement) } : {}),
      }),
    ),
  );

  const rows = [];
  let successCount = 0;
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    successCount += 1;
    if (Array.isArray(item.value?.data)) rows.push(...item.value.data);
  }
  if (successCount === 0) {
    throw new Error(`meta_insights_${datePreset}_failed`);
  }
  return rows;
}

async function fetchMetaStatuses(ids, { fields = "id,effective_status" } = {}) {
  const uniqueIds = uniqueNonEmpty(ids);
  if (!uniqueIds.length) return { statuses: new Map(), successCount: 0 };

  const settled = await Promise.allSettled(uniqueIds.map((id) => metaGet(id, { fields })));
  const statuses = new Map();
  let successCount = 0;

  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    const row = item.value || {};
    const id = String(row.id || "").trim();
    if (!id) continue;
    statuses.set(id, normalizeMetaStatus(row.effective_status));
    successCount += 1;
  }

  return { statuses, successCount };
}

function aggregateTotals(rows) {
  let spend = 0;
  let leads = 0;
  for (const row of rows) {
    spend += toFiniteNumber(row?.spend);
    leads += extractLeadActions(row?.actions);
  }
  return {
    spend,
    leads,
    cpl: leads > 0 ? spend / leads : null,
  };
}

function buildDailySeriesFromInsights(rows) {
  const base = buildZeroDailySeries();
  const byDate = new Map(base.map((item) => [item.date, { ...item }]));

  for (const row of rows) {
    const date = String(row?.date_start || "").trim();
    if (!byDate.has(date)) continue;
    const prev = byDate.get(date);
    byDate.set(date, {
      date,
      spend: prev.spend + toFiniteNumber(row?.spend),
      leads: prev.leads + extractLeadActions(row?.actions),
    });
  }

  return base.map((item) => byDate.get(item.date) || item);
}

function buildCreativeMetricsMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row?.ad_id || "").trim();
    if (!id) continue;
    const prev = map.get(id) || {
      id,
      name: String(row?.ad_name || "Criativo"),
      campaignName: String(row?.campaign_name || "Campanha"),
      adSetName: String(row?.adset_name || ""),
      spend: 0,
      leads: 0,
    };
    prev.spend += toFiniteNumber(row?.spend);
    prev.leads += extractLeadActions(row?.actions);
    if (!prev.name && row?.ad_name) prev.name = String(row.ad_name);
    if (!prev.campaignName && row?.campaign_name) prev.campaignName = String(row.campaign_name);
    if (!prev.adSetName && row?.adset_name) prev.adSetName = String(row.adset_name);
    map.set(id, prev);
  }
  return map;
}

function statusFromMaps(id, liveMap, savedMap) {
  const live = liveMap.get(id);
  if (live) return live;
  const saved = savedMap.get(id);
  if (saved) return saved;
  return "";
}

async function buildDashboardSnapshotForCustomer(client, customerId) {
  const publications = await client.query(
    `select ap.order_id, ap.meta_campaign_id, ap.meta_ad_id, ap.status, ap.updated_at, o.title
     from ads_publications ap
     join orders o on o.id = ap.order_id
     where ap.customer_id = $1
     order by ap.updated_at desc`,
    [customerId],
  );

  const rows = publications.rows;
  if (!rows.length) {
    return buildDashboardFromPublications([], { stale: false });
  }

  const campaignIds = uniqueNonEmpty(rows.map((row) => row.meta_campaign_id));
  const publicationAdIds = uniqueNonEmpty(rows.map((row) => row.meta_ad_id));

  if (!isMetaConfigured() || !campaignIds.length) {
    return buildDashboardFromPublications(rows, { stale: false });
  }

  const thisMonthRows = await fetchInsightsByCampaignIds(campaignIds, { datePreset: "this_month" });
  const lastMonthRows = await fetchInsightsByCampaignIds(campaignIds, { datePreset: "last_month" });
  const dailyRows = await fetchInsightsByCampaignIds(campaignIds, { datePreset: "this_month", timeIncrement: 1 });

  const thisMonthTotals = aggregateTotals(thisMonthRows);
  const previousMonthTotals = aggregateTotals(lastMonthRows);
  const dailySeries = buildDailySeriesFromInsights(dailyRows);
  const metricsByAdId = buildCreativeMetricsMap(thisMonthRows);
  const metricsAdIds = Array.from(metricsByAdId.keys());

  const { statuses: liveCampaignStatusMap } = await fetchMetaStatuses(campaignIds, { fields: "id,effective_status" });
  const adIdsForStatus = uniqueNonEmpty([...publicationAdIds, ...metricsAdIds]);
  const { statuses: liveAdStatusMap } = await fetchMetaStatuses(adIdsForStatus, { fields: "id,effective_status" });

  const savedCampaignStatusMap = new Map();
  const savedAdStatusMap = new Map();
  for (const row of rows) {
    const campaignId = String(row.meta_campaign_id || "").trim();
    const adId = String(row.meta_ad_id || "").trim();
    const status = normalizeMetaStatus(row.status);
    if (campaignId && !savedCampaignStatusMap.has(campaignId)) savedCampaignStatusMap.set(campaignId, status);
    if (adId && !savedAdStatusMap.has(adId)) savedAdStatusMap.set(adId, status);
  }

  const activeCampaigns = campaignIds.filter((id) => isActiveStatus(statusFromMaps(id, liveCampaignStatusMap, savedCampaignStatusMap))).length;
  const activeCreatives = adIdsForStatus.filter((id) => isActiveStatus(statusFromMaps(id, liveAdStatusMap, savedAdStatusMap))).length;

  const publicationTitleByAdId = new Map(
    rows
      .filter((row) => String(row.meta_ad_id || "").trim())
      .map((row) => [String(row.meta_ad_id).trim(), String(row.title || "").trim()]),
  );

  const creativesRunning = adIdsForStatus
    .map((adId, index) => {
      const metrics = metricsByAdId.get(adId);
      const statusRaw = statusFromMaps(adId, liveAdStatusMap, savedAdStatusMap);
      const status = mapCreativeStatus(statusRaw || "ACTIVE");
      if (status === "ended") return null;
      const titleFallback = publicationTitleByAdId.get(adId);
      return {
        id: adId,
        name: metrics?.name || (titleFallback ? `${titleFallback.slice(0, 52)} • Criativo` : `Criativo ${index + 1}`),
        campaignName: metrics?.campaignName || titleFallback || "Campanha",
        adSetName: metrics?.adSetName || "",
        status,
        spend: toFiniteNumber(metrics?.spend),
        leads: toFiniteNumber(metrics?.leads),
        updatedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(0, 20);

  return withDashboardDefaults(
    {
      updatedAt: new Date().toISOString(),
      monthlySpend: thisMonthTotals.spend,
      monthlyLeads: thisMonthTotals.leads,
      cpl: thisMonthTotals.cpl,
      previousMonthSpend: previousMonthTotals.spend,
      previousMonthLeads: previousMonthTotals.leads,
      previousMonthCpl: previousMonthTotals.cpl,
      activeCampaigns,
      activeCreatives,
      creativesRunning,
      dailySeries,
    },
    { stale: false },
  );
}

function isMetaConfigured() {
  return Boolean(META_ACCESS_TOKEN && /^\d+$/.test(META_AD_ACCOUNT_ID));
}

async function ensureAssetStorageDir() {
  await fs.mkdir(ASSET_STORAGE_DIR, { recursive: true });
}

async function metaGet(apiPath, params = {}) {
  const url = new URL(`${META_API_BASE}/${META_GRAPH_VERSION}/${String(apiPath).replace(/^\/+/, "")}`);
  const query = { ...params, access_token: META_ACCESS_TOKEN };
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { method: "GET" });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    const error = new Error(`meta_http_${response.status}`);
    error.meta = payload;
    throw error;
  }
  return payload;
}

async function getOrderDetail(client, orderId) {
  const orderRes = await client.query(`select * from orders where id = $1`, [orderId]);
  if (orderRes.rowCount === 0) return null;

  const [eventsRes, deliverablesRes, approvalsRes, assetsRes, publicationRes, sitePublicationRes] = await Promise.all([
    client.query(`select * from order_events where order_id = $1 order by ts asc`, [orderId]),
    client.query(`select * from deliverables where order_id = $1 order by updated_at desc`, [orderId]),
    client.query(
      `select a.* from approvals a
       join deliverables d on d.id = a.deliverable_id
       where d.order_id = $1
       order by a.updated_at desc`,
      [orderId],
    ),
    client.query(`select * from order_assets where order_id = $1 order by created_at desc`, [orderId]),
    client.query(`select * from ads_publications where order_id = $1`, [orderId]),
    client.query(`select * from site_publications where order_id = $1`, [orderId]),
  ]);

  return {
    ...mapOrder(orderRes.rows[0]),
    events: eventsRes.rows.map(mapEvent),
    deliverables: deliverablesRes.rows.map(mapDeliverable),
    approvals: approvalsRes.rows.map(mapApproval),
    assets: assetsRes.rows.map(mapOrderAsset),
    adsPublication: publicationRes.rowCount > 0 ? mapAdsPublication(publicationRes.rows[0]) : null,
    sitePublication: sitePublicationRes.rowCount > 0 ? mapSitePublication(sitePublicationRes.rows[0]) : null,
  };
}

async function getPlanActive(client, customerId) {
  const res = await client.query(`select plan_active from entitlements where customer_id = $1`, [customerId]);
  if (res.rowCount === 0) return false;
  return Boolean(res.rows[0].plan_active);
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("select 1");
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    return res.json({ ready: true });
  } catch {
    return res.status(500).json({ ready: false });
  }
});

app.post("/v1/debug/client-events", async (req, res) => {
  const parsed = debugClientEventSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const now = new Date();
  const tsUtc = parsed.data.ts_utc || now.toISOString();
  const level = parsed.data.level || "info";
  const safeMeta = redactValue(parsed.data.meta || {}, "meta");
  const fingerprint = parsed.data.fingerprint || computeFingerprint({ stage: parsed.data.stage, event: parsed.data.event, meta: safeMeta });

  const eventRow = {
    ts_utc: tsUtc,
    received_at_utc: now.toISOString(),
    source: "mobile_app",
    trace_id: parsed.data.trace_id,
    stage: parsed.data.stage,
    event: parsed.data.event,
    level,
    fingerprint,
    meta: safeMeta,
  };

  try {
    await ensureDebugLogDirs();
    await fs.appendFile(DEBUG_EVENTS_FILE, `${JSON.stringify(eventRow)}\n`, "utf8");

    let escalation = null;
    if (level === "error") {
      escalation = await handleIncidentEscalation({
        fingerprint,
        baseEvent: eventRow,
        now,
      });
      await fs.appendFile(DEBUG_EVENTS_FILE, `${JSON.stringify(escalation.escalationEvent)}\n`, "utf8");
    }

    return res.status(202).json({
      ok: true,
      level: escalation ? `L${escalation.level}` : "L0",
      frequency_15m: escalation?.frequency || (level === "error" ? 1 : 0),
      incident_report: escalation?.incidentReportPath || null,
    });
  } catch (error) {
    log("error", "debug_client_events_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ error: "Falha ao persistir logs." });
  }
});

app.use("/v1", authClient);

app.get("/v1/entitlements/me", async (req, res) => {
  const customerId = req.user.id;
  const client = await pool.connect();
  try {
    const planActive = await getPlanActive(client, customerId);
    return res.json({ planActive });
  } finally {
    client.release();
  }
});

app.post("/v1/entitlements/me", async (req, res) => {
  const parsed = entitlementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const customerId = req.user.id;
  const client = await pool.connect();
  try {
    await client.query(
      `insert into entitlements (customer_id, plan_active)
       values ($1, $2)
       on conflict (customer_id)
       do update set plan_active = excluded.plan_active`,
      [customerId, parsed.data.planActive],
    );
    return res.json({ planActive: parsed.data.planActive });
  } finally {
    client.release();
  }
});

app.post("/v1/site/autobuild", async (req, res) => {
  const parsed = siteAutobuildSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  try {
    const result = await siteBuilderApi("/v1/autobuild", {
      ...parsed.data,
      context: {
        ...(parsed.data.context || {}),
        customerId: req.user.id,
      },
    });
    return res.json(result);
  } catch (error) {
    log("error", "site_autobuild_failed", { customerId: req.user.id, error: String(error) });
    return res.status(502).json({ error: "Falha ao gerar estrutura automática do site." });
  }
});

app.post("/v1/site/live/generate", async (req, res) => {
  const parsed = liveSiteGenerateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    log("warn", "site_live_generate_invalid_payload", { issues: parsed.error.flatten() });
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const traceId = randomUUID().slice(0, 8);
  try {
    const { prompt, previous } = parsed.data;
    log("info", "site_live_generate_start", {
      traceId,
      customerId: req.user.id,
      promptLength: prompt.length,
      hasPreviousCode: Boolean(previous?.code?.html),
      previousSlug: previous?.slug || null,
    });

    const generation = await siteBuilderApi("/v1/code/generate", {
      prompt,
      previous: previous?.code || undefined,
      context: { customerId: req.user.id, traceId },
    });
    const code = generation?.code;
    if (!code || typeof code !== "object" || typeof code.html !== "string" || !code.html.trim()) {
      log("error", "site_live_generate_invalid_code_response", {
        traceId,
        customerId: req.user.id,
        generationKeys: generation && typeof generation === "object" ? Object.keys(generation) : [],
      });
      return res.status(502).json({ error: "Resposta inválida do gerador de código." });
    }

    const slug = toLiveSiteSlug(req.user.id, previous?.slug || prompt || "site");
    log("info", "site_live_generate_publish_preview_start", {
      traceId,
      customerId: req.user.id,
      slug,
      htmlLength: code.html.length,
      cssLength: typeof code.css === "string" ? code.css.length : 0,
      jsLength: typeof code.js === "string" ? code.js.length : 0,
    });
    const preview = await siteBuilderApi("/v1/publish/preview-code", {
      orderId: `live-${req.user.id}-${Date.now()}`,
      customerId: req.user.id,
      slug,
      code,
    });

    log("info", "site_live_generate_success", {
      traceId,
      customerId: req.user.id,
      slug: String(preview.slug || slug),
      previewUrl: String(preview.url || ""),
      retryCount: generation?.meta?.retryCount ?? null,
      engine: generation?.meta?.engine || null,
    });

    return res.json({
      slug: String(preview.slug || slug),
      previewUrl: String(preview.url || ""),
      publicUrl: null,
      code,
      meta: generation?.meta || {},
    });
  } catch (error) {
    const upstream = error && typeof error === "object" ? error : null;
    const upstreamPayload = upstream && typeof upstream.payload === "object" && upstream.payload ? upstream.payload : null;
    if (upstreamPayload?.error === "code_generation_failed") {
      const retryCount = Number.isFinite(Number(upstreamPayload.retryCount)) ? Number(upstreamPayload.retryCount) : 2;
      const detail = String(upstreamPayload.detail || "");
      let message = "Falha ao gerar site com IA. Tente novamente.";
      if (/zai_api_key_missing/i.test(detail)) {
        message = "ZAI_API_KEY não configurada no servidor.";
      } else if (/zai_http_401/i.test(detail)) {
        message = "Chave da IA inválida ou expirada no servidor.";
      } else if (/zai_http_429/i.test(detail)) {
        message = "Limite da IA atingido no momento. Tente novamente em instantes.";
      } else if (typeof upstreamPayload.message === "string" && upstreamPayload.message.trim()) {
        message = upstreamPayload.message;
      }
      log("warn", "site_live_generate_failed_typed", {
        traceId,
        customerId: req.user.id,
        retryCount,
        failuresForPrompt: upstreamPayload.failuresForPrompt,
        detail: upstreamPayload.detail || null,
      });
      return res.status(502).json({
        error: "code_generation_failed",
        message,
        retryCount,
      });
    }

    log("error", "site_live_generate_failed", { traceId, customerId: req.user.id, error: String(error) });
    return res.status(502).json({ error: "Falha ao gerar preview do site." });
  }
});

app.post("/v1/site/live/publish", async (req, res) => {
  const parsed = liveSitePublishSchema.safeParse(req.body || {});
  if (!parsed.success) {
    log("warn", "site_live_publish_invalid_payload", { issues: parsed.error.flatten() });
    return res.status(400).json({ error: "Dados inválidos." });
  }

  const traceId = randomUUID().slice(0, 8);
  try {
    const { slug, code } = parsed.data;
    const normalizedSlug = toLiveSiteSlug(req.user.id, slug);
    log("info", "site_live_publish_start", {
      traceId,
      customerId: req.user.id,
      slugRequested: slug,
      slugNormalized: normalizedSlug,
      htmlLength: code.html.length,
      cssLength: typeof code.css === "string" ? code.css.length : 0,
      jsLength: typeof code.js === "string" ? code.js.length : 0,
    });
    const published = await siteBuilderApi("/v1/publish/final-code", {
      orderId: `live-${req.user.id}-${Date.now()}`,
      customerId: req.user.id,
      slug: normalizedSlug,
      code,
    });

    log("info", "site_live_publish_success", {
      traceId,
      customerId: req.user.id,
      slug: String(published.slug || normalizedSlug),
      publicUrl: String(published.url || ""),
    });
    return res.json({
      slug: String(published.slug || slug),
      publicUrl: String(published.url || ""),
      stage: "published",
    });
  } catch (error) {
    log("error", "site_live_publish_failed", { traceId, customerId: req.user.id, error: String(error) });
    return res.status(502).json({ error: "Falha ao publicar site final." });
  }
});

app.post("/v1/orders", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const { type, title, summary, payload } = parsed.data;
  const customerId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const orderId = randomUUID();
    const result = await client.query(
      `insert into orders (id, customer_id, type, status, title, summary, payload)
       values ($1, $2, $3, 'draft', $4, $5, $6)
       returning *`,
      [orderId, customerId, type, title, summary, payload],
    );

    await appendEvent(client, {
      orderId,
      actor: "client",
      message: "Pedido criado.",
      statusSnapshot: "draft",
    });

    await client.query("commit");
    const order = mapOrder(result.rows[0]);
    log("info", "order_created", { orderId, customerId, type, status: "draft" });
    return res.status(201).json(order);
  } catch (error) {
    await client.query("rollback");
    log("error", "order_create_failed", { error: String(error) });
    return res.status(500).json({ error: "Falha ao criar pedido." });
  } finally {
    client.release();
  }
});

app.patch("/v1/orders/:id", async (req, res) => {
  const parsed = updateOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const current = await client.query(
      `select * from orders where id = $1 and customer_id = $2 for update`,
      [orderId, customerId],
    );

    if (current.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    if (current.rows[0].status !== "draft") {
      await client.query("rollback");
      return res.status(409).json({ error: "Só é possível editar pedido em rascunho." });
    }

    const payload = parsed.data.payload ?? current.rows[0].payload;
    const title = parsed.data.title ?? current.rows[0].title;
    const summary = parsed.data.summary ?? current.rows[0].summary;
    const priority = parsed.data.priority ?? current.rows[0].priority;

    const updated = await client.query(
      `update orders
       set title = $1, summary = $2, payload = $3, priority = $4
       where id = $5
       returning *`,
      [title, summary, payload, priority, orderId],
    );

    await appendEvent(client, {
      orderId,
      actor: "client",
      message: "Rascunho atualizado.",
      statusSnapshot: "draft",
    });

    await client.query("commit");
    return res.json(mapOrder(updated.rows[0]));
  } catch (error) {
    await client.query("rollback");
    log("error", "order_update_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao atualizar pedido." });
  } finally {
    client.release();
  }
});

app.get("/v1/orders", async (req, res) => {
  const customerId = req.user.id;
  try {
    const result = await pool.query(
      `select * from orders where customer_id = $1 order by updated_at desc`,
      [customerId],
    );
    return res.json(result.rows.map(mapOrder));
  } catch (error) {
    log("error", "order_list_failed", { customerId, error: String(error) });
    return res.status(500).json({ error: "Falha ao listar pedidos." });
  }
});

app.get("/v1/orders/:id", async (req, res) => {
  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    const owns = await client.query(`select 1 from orders where id = $1 and customer_id = $2`, [orderId, customerId]);
    if (owns.rowCount === 0) return res.status(404).json({ error: "Pedido não encontrado." });

    const detail = await getOrderDetail(client, orderId);
    if (!detail) return res.status(404).json({ error: "Pedido não encontrado." });
    return res.json(detail);
  } catch (error) {
    log("error", "order_detail_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao buscar pedido." });
  } finally {
    client.release();
  }
});

app.post("/v1/orders/:id/assets", async (req, res) => {
  const parsed = uploadAssetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(`select * from orders where id = $1 and customer_id = $2 for update`, [orderId, customerId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    if (order.rows[0].status !== "draft") {
      await client.query("rollback");
      return res.status(409).json({ error: "Só é possível enviar assets em pedido de rascunho." });
    }

    const fileName = safeBaseName(parsed.data.fileName);
    const mimeType = normalizeMimeType(parsed.data.mimeType, fileName);
    const inferredKind = mimeToAssetKind(mimeType);
    const kind = parsed.data.kind || inferredKind;
    if (kind !== inferredKind) {
      await client.query("rollback");
      return res.status(400).json({ error: "Tipo de arquivo incompatível com o mimeType." });
    }

    let buffer;
    try {
      buffer = Buffer.from(parsed.data.base64Data, "base64");
    } catch {
      await client.query("rollback");
      return res.status(400).json({ error: "Arquivo em base64 inválido." });
    }
    if (!buffer || buffer.length === 0) {
      await client.query("rollback");
      return res.status(400).json({ error: "Arquivo vazio." });
    }
    if (buffer.length > 30 * 1024 * 1024) {
      await client.query("rollback");
      return res.status(413).json({ error: "Arquivo acima de 30MB." });
    }

    await ensureAssetStorageDir();
    const extension = path.extname(fileName) || (kind === "video" ? ".mp4" : ".jpg");
    const assetId = randomUUID();
    const safeStorageName = `${assetId}${extension}`;
    const storagePath = path.join(ASSET_STORAGE_DIR, safeStorageName);
    await fs.writeFile(storagePath, buffer);

    const inserted = await client.query(
      `insert into order_assets (id, order_id, kind, original_file_name, storage_path, mime_type, size_bytes)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [assetId, orderId, kind, fileName, storagePath, mimeType, buffer.length],
    );

    await appendEvent(client, {
      orderId,
      actor: "client",
      message: `Asset de anúncio enviado (${kind}).`,
      statusSnapshot: "draft",
    });

    await client.query("commit");
    return res.status(201).json(mapOrderAsset(inserted.rows[0]));
  } catch (error) {
    await client.query("rollback");
    log("error", "order_asset_upload_failed", { orderId, customerId, error: String(error) });
    return res.status(500).json({ error: "Falha ao enviar asset." });
  } finally {
    client.release();
  }
});

app.get("/v1/orders/:id/assets", async (req, res) => {
  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();
  try {
    const owns = await client.query(`select 1 from orders where id = $1 and customer_id = $2`, [orderId, customerId]);
    if (owns.rowCount === 0) return res.status(404).json({ error: "Pedido não encontrado." });
    const result = await client.query(`select * from order_assets where order_id = $1 order by created_at desc`, [orderId]);
    return res.json(result.rows.map(mapOrderAsset));
  } catch {
    return res.status(500).json({ error: "Falha ao listar assets." });
  } finally {
    client.release();
  }
});

app.get("/v1/ads/dashboard", async (req, res) => {
  const customerId = req.user.id;
  const client = await pool.connect();
  try {
    const cached = await client.query(
      `select snapshot, updated_at
       from ads_dashboard_snapshots
       where customer_id = $1`,
      [customerId],
    );
    const cachedSnapshot =
      cached.rowCount > 0 ? withDashboardDefaults(cached.rows[0].snapshot || {}, { stale: false }) : null;

    if (cached.rowCount > 0) {
      const updatedAt = cached.rows[0].updated_at ? cached.rows[0].updated_at.getTime() : 0;
      if (Date.now() - updatedAt <= ADS_DASHBOARD_CACHE_TTL_SECONDS * 1000) {
        return res.json(cachedSnapshot);
      }
    }

    let snapshot = null;
    try {
      snapshot = withDashboardDefaults(await buildDashboardSnapshotForCustomer(client, customerId), { stale: false });
    } catch (refreshError) {
      log("warn", "ads_dashboard_refresh_failed", { customerId, error: String(refreshError) });
      if (cachedSnapshot) {
        return res.json(withDashboardDefaults(cachedSnapshot, { stale: true }));
      }

      try {
        const fallbackPublications = await client.query(
          `select ap.order_id, ap.meta_campaign_id, ap.meta_ad_id, ap.status, ap.updated_at, o.title
           from ads_publications ap
           join orders o on o.id = ap.order_id
           where ap.customer_id = $1
           order by ap.updated_at desc`,
          [customerId],
        );
        snapshot = buildDashboardFromPublications(fallbackPublications.rows, { stale: true });
      } catch (fallbackError) {
        log("error", "ads_dashboard_fallback_failed", { customerId, error: String(fallbackError) });
        snapshot = withDashboardDefaults({}, { stale: true });
      }
    }

    await client.query(
      `insert into ads_dashboard_snapshots (customer_id, snapshot)
       values ($1, $2::jsonb)
       on conflict (customer_id)
       do update set snapshot = excluded.snapshot, updated_at = now()`,
      [customerId, JSON.stringify(snapshot)],
    );
    return res.json(snapshot);
  } catch (error) {
    log("error", "ads_dashboard_failed", { customerId, error: String(error) });
    return res.json(withDashboardDefaults({}, { stale: true }));
  } finally {
    client.release();
  }
});

app.post("/v1/orders/:id/submit", async (req, res) => {
  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(
      `select * from orders where id = $1 and customer_id = $2 for update`,
      [orderId, customerId],
    );

    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    const planActive = await getPlanActive(client, customerId);
    const nextStatus = planActive ? "queued" : "waiting_payment";

    await client.query(`update orders set status = $1 where id = $2`, [nextStatus, orderId]);
    await appendEvent(client, {
      orderId,
      actor: "client",
      message: planActive
        ? "Pedido enviado e pronto para execução."
        : "Pedido enviado. Aguarda ativação do plano para entrar na fila.",
      statusSnapshot: nextStatus,
    });

    await client.query("commit");
    return res.json({ orderId, status: nextStatus });
  } catch (error) {
    await client.query("rollback");
    log("error", "order_submit_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao enviar pedido." });
  } finally {
    client.release();
  }
});

app.post("/v1/orders/:id/info", async (req, res) => {
  const parsed = infoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(
      `select * from orders where id = $1 and customer_id = $2 for update`,
      [orderId, customerId],
    );
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    const mergedPayload = {
      ...(order.rows[0].payload || {}),
      info_response: parsed.data.message,
    };

    await client.query(
      `update orders set payload = $1, status = 'queued' where id = $2`,
      [mergedPayload, orderId],
    );

    await appendEvent(client, {
      orderId,
      actor: "client",
      message: "Cliente respondeu pendências.",
      statusSnapshot: "queued",
    });

    await client.query("commit");

    const detail = await getOrderDetail(client, orderId);
    return res.json(detail);
  } catch (error) {
    await client.query("rollback");
    log("error", "order_info_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao enviar informação." });
  } finally {
    client.release();
  }
});

app.post("/v1/approvals/:deliverableId", async (req, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const deliverableId = req.params.deliverableId;
  const customerId = req.user.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const found = await client.query(
      `select d.id as deliverable_id, d.type, d.order_id, o.customer_id
       from deliverables d
       join orders o on o.id = d.order_id
       where d.id = $1 and o.customer_id = $2
       for update`,
      [deliverableId, customerId],
    );

    if (found.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Entregável não encontrado." });
    }

    const row = found.rows[0];
    const feedback = parsed.data.feedback || "";
    await client.query(
      `insert into approvals (deliverable_id, status, feedback)
       values ($1, $2, $3)
       on conflict (deliverable_id)
       do update set status = excluded.status, feedback = excluded.feedback, updated_at = now()`,
      [deliverableId, parsed.data.status, feedback],
    );

    await client.query(`update deliverables set status = $1 where id = $2`, [parsed.data.status, deliverableId]);

    const approvals = await client.query(
      `select a.status
       from approvals a
       join deliverables d on d.id = a.deliverable_id
       where d.order_id = $1 and d.type in ('creative', 'copy')`,
      [row.order_id],
    );

    const hasChanges = approvals.rows.some((r) => r.status === "changes_requested");
    const allApproved = approvals.rowCount > 0 && approvals.rows.every((r) => r.status === "approved");
    const nextStatus = hasChanges || allApproved ? "queued" : "needs_approval";

    await client.query(`update orders set status = $1 where id = $2`, [nextStatus, row.order_id]);

    await appendEvent(client, {
      orderId: row.order_id,
      actor: "client",
      message: parsed.data.status === "approved" ? `Cliente aprovou ${row.type}.` : `Cliente pediu ajustes em ${row.type}.`,
      statusSnapshot: nextStatus,
    });

    await client.query("commit");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    log("error", "approval_failed", { deliverableId, error: String(error) });
    return res.status(500).json({ error: "Falha ao registrar aprovação." });
  } finally {
    client.release();
  }
});

app.use("/v1/ops", authOpsWorker);

app.get("/v1/ops/orders", requireRole(["ops", "worker"]), async (req, res) => {
  const { status, customerId } = req.query;
  const filters = [];
  const values = [];

  if (typeof status === "string") {
    values.push(status);
    filters.push(`status = $${values.length}`);
  }
  if (typeof customerId === "string") {
    values.push(customerId);
    filters.push(`customer_id = $${values.length}`);
  }

  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const result = await pool.query(`select * from orders ${where} order by updated_at desc limit 300`, values);
  return res.json(result.rows.map(mapOrder));
});

app.post("/v1/ops/orders/claim", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = claimSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const workerId = parsed.data.workerId || `worker-${process.pid}`;
  const leaseSeconds = parsed.data.leaseSeconds || WORKER_LEASE_SECONDS;

  const client = await pool.connect();
  try {
    await client.query("begin");

    await client.query(
      `update worker_claims
       set released_at = now(), release_reason = 'lease_expired'
       where released_at is null and lease_until < now()`,
    );

    await client.query(
      `update worker_health
       set last_poll_at = now(), last_error = null
       where worker_id = $1`,
      [workerId],
    );
    await client.query(
      `insert into worker_health (worker_id, last_poll_at)
       values ($1, now())
       on conflict (worker_id) do update set last_poll_at = now()`,
      [workerId],
    );

    const candidate = await client.query(
      `select o.id
       from orders o
       where o.status = 'queued'
         and not exists (
           select 1 from worker_claims wc
           where wc.order_id = o.id and wc.released_at is null and wc.lease_until > now()
         )
       order by o.priority desc nulls last, o.created_at asc
       for update skip locked
       limit 1`,
    );

    if (candidate.rowCount === 0) {
      await client.query("commit");
      return res.json({ order: null });
    }

    const orderId = candidate.rows[0].id;
    const attemptRes = await client.query(`select coalesce(max(attempt), 0) + 1 as attempt from worker_claims where order_id = $1`, [orderId]);
    const attempt = Number(attemptRes.rows[0].attempt);

    const claimId = randomUUID();
    await client.query(
      `insert into worker_claims (id, order_id, worker_id, attempt, lease_until)
       values ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval)`,
      [claimId, orderId, workerId, attempt, leaseSeconds],
    );

    await client.query(`update orders set status = 'in_progress' where id = $1`, [orderId]);

    await appendEvent(client, {
      orderId,
      actor: "codex",
      message: `Worker ${workerId} iniciou processamento (tentativa ${attempt}).`,
      statusSnapshot: "in_progress",
    });

    await client.query(
      `insert into worker_health (worker_id, last_claim_at)
       values ($1, now())
       on conflict (worker_id) do update set last_claim_at = now()`,
      [workerId],
    );

    const detail = await getOrderDetail(client, orderId);
    await client.query("commit");

    return res.json({ order: detail, claim: { id: claimId, workerId, attempt, leaseSeconds } });
  } catch (error) {
    await client.query("rollback");
    log("error", "claim_failed", { workerId, error: String(error) });
    return res.status(500).json({ error: "Falha ao fazer claim." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/event", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const actor = parsed.data.actor || (req.role === "ops" ? "ops" : "codex");

  const client = await pool.connect();
  try {
    await client.query("begin");
    const exists = await client.query(`select 1 from orders where id = $1`, [orderId]);
    if (exists.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    await appendEvent(client, {
      orderId,
      actor,
      message: parsed.data.message,
      statusSnapshot: parsed.data.statusSnapshot,
    });

    await client.query("commit");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ error: "Falha ao adicionar evento." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/deliverables", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = deliverablesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    for (const d of parsed.data.deliverables) {
      const deliverableId = d.id || randomUUID();
      const upsert = await client.query(
        `insert into deliverables (id, order_id, type, status, content, asset_urls)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         on conflict (order_id, type)
         do update set status = excluded.status, content = excluded.content, asset_urls = excluded.asset_urls
         returning id, type`,
        [
          deliverableId,
          orderId,
          d.type,
          d.status,
          JSON.stringify(d.content || {}),
          JSON.stringify(d.assetUrls || []),
        ],
      );

      const persisted = upsert.rows[0];
      if (isApprovalType(persisted.type)) {
        await client.query(
          `insert into approvals (deliverable_id, status, feedback)
           values ($1, 'pending', '')
           on conflict (deliverable_id)
           do update set status = 'pending', feedback = '', updated_at = now()`,
          [persisted.id],
        );
      }
    }

    await appendEvent(client, {
      orderId,
      actor: req.role === "ops" ? "ops" : "codex",
      message: `Entregáveis atualizados (${parsed.data.deliverables.length}).`,
    });

    const detail = await getOrderDetail(client, orderId);
    await client.query("commit");
    return res.json(detail);
  } catch (error) {
    await client.query("rollback");
    log("error", "ops_deliverables_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao atualizar entregáveis." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/ads-publication", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = adsPublicationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const order = await client.query(`select id, customer_id from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    const row = order.rows[0];
    await client.query(
      `insert into ads_publications (
        order_id, customer_id, meta_campaign_id, meta_adset_id, meta_ad_id, meta_creative_id, status, raw_response, last_sync_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
      on conflict (order_id)
      do update set
        customer_id = excluded.customer_id,
        meta_campaign_id = excluded.meta_campaign_id,
        meta_adset_id = excluded.meta_adset_id,
        meta_ad_id = excluded.meta_ad_id,
        meta_creative_id = excluded.meta_creative_id,
        status = excluded.status,
        raw_response = excluded.raw_response,
        last_sync_at = now(),
        updated_at = now()`,
      [
        orderId,
        row.customer_id,
        parsed.data.metaCampaignId || null,
        parsed.data.metaAdsetId || null,
        parsed.data.metaAdId || null,
        parsed.data.metaCreativeId || null,
        parsed.data.status,
        JSON.stringify(parsed.data.rawResponse || {}),
      ],
    );

    await appendEvent(client, {
      orderId,
      actor: req.role === "ops" ? "ops" : "codex",
      message: `Publicação Meta atualizada (${parsed.data.status}).`,
    });

    await client.query(`delete from ads_dashboard_snapshots where customer_id = $1`, [row.customer_id]);

    await client.query("commit");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    log("error", "ops_ads_publication_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao salvar publicação de anúncio." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/site-publication", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = sitePublicationSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const order = await client.query(`select id, customer_id from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    const row = order.rows[0];
    await client.query(
      `insert into site_publications (
        order_id, customer_id, stage, slug, preview_url, public_url, retries, last_error, metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      on conflict (order_id)
      do update set
        customer_id = excluded.customer_id,
        stage = excluded.stage,
        slug = excluded.slug,
        preview_url = excluded.preview_url,
        public_url = excluded.public_url,
        retries = excluded.retries,
        last_error = excluded.last_error,
        metadata = excluded.metadata,
        updated_at = now()`,
      [
        orderId,
        row.customer_id,
        parsed.data.stage,
        parsed.data.slug || null,
        parsed.data.previewUrl || null,
        parsed.data.publicUrl || null,
        typeof parsed.data.retries === "number" ? parsed.data.retries : 0,
        parsed.data.lastError || null,
        JSON.stringify(parsed.data.metadata || {}),
      ],
    );

    await appendEvent(client, {
      orderId,
      actor: req.role === "ops" ? "ops" : "codex",
      message: `Publicação de site atualizada (${parsed.data.stage}).`,
    });

    await client.query("commit");
    return res.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    log("error", "ops_site_publication_failed", { orderId, error: String(error) });
    return res.status(500).json({ error: "Falha ao salvar publicação de site." });
  } finally {
    client.release();
  }
});

app.get("/v1/ops/assets/:assetId/content", requireRole(["worker", "ops"]), async (req, res) => {
  const assetId = req.params.assetId;
  const client = await pool.connect();
  try {
    const result = await client.query(`select * from order_assets where id = $1`, [assetId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Asset não encontrado." });
    const row = result.rows[0];
    const content = await fs.readFile(row.storage_path);
    res.setHeader("content-type", row.mime_type || "application/octet-stream");
    res.setHeader("content-length", String(content.length));
    res.setHeader("x-file-name", row.original_file_name || "asset.bin");
    return res.status(200).send(content);
  } catch (error) {
    log("error", "ops_asset_download_failed", { assetId, error: String(error) });
    return res.status(500).json({ error: "Falha ao baixar asset." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/complete", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    await client.query(`update orders set status = $1 where id = $2`, [parsed.data.status, orderId]);
    await client.query(
      `update worker_claims set released_at = now(), release_reason = 'completed'
       where order_id = $1 and released_at is null`,
      [orderId],
    );

    await appendEvent(client, {
      orderId,
      actor: req.role === "ops" ? "ops" : "codex",
      message: parsed.data.message || `Pedido atualizado para ${parsed.data.status}.`,
      statusSnapshot: parsed.data.status,
    });

    await client.query("commit");
    return res.json({ orderId, status: parsed.data.status });
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ error: "Falha ao completar pedido." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/requeue", requireRole(["ops"]), async (req, res) => {
  const orderId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    await client.query(`update orders set status = 'queued' where id = $1`, [orderId]);
    await client.query(
      `update worker_claims set released_at = now(), release_reason = 'requeue'
       where order_id = $1 and released_at is null`,
      [orderId],
    );

    await appendEvent(client, {
      orderId,
      actor: "ops",
      message: "Pedido recolocado na fila.",
      statusSnapshot: "queued",
    });

    await client.query("commit");
    return res.json({ orderId, status: "queued" });
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ error: "Falha ao reprocessar pedido." });
  } finally {
    client.release();
  }
});

app.post("/v1/ops/orders/:id/status", requireRole(["ops"]), async (req, res) => {
  const parsed = opsStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  const orderId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("begin");
    const order = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    if (order.rowCount === 0) {
      await client.query("rollback");
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    await client.query(`update orders set status = $1 where id = $2`, [parsed.data.status, orderId]);
    await appendEvent(client, {
      orderId,
      actor: "ops",
      message: parsed.data.message || `Status forçado para ${parsed.data.status}.`,
      statusSnapshot: parsed.data.status,
    });
    await client.query("commit");
    return res.json({ orderId, status: parsed.data.status });
  } catch (error) {
    await client.query("rollback");
    return res.status(500).json({ error: "Falha ao alterar status." });
  } finally {
    client.release();
  }
});

app.get("/v1/ops/customers", requireRole(["ops"]), async (_req, res) => {
  try {
    const result = await pool.query(
      `select o.customer_id,
              count(*) as orders_count,
              max(o.updated_at) as last_order_at,
              coalesce(e.plan_active, false) as plan_active
       from orders o
       left join entitlements e on e.customer_id = o.customer_id
       group by o.customer_id, e.plan_active
       order by max(o.updated_at) desc`,
    );
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ error: "Falha ao listar clientes." });
  }
});

app.get("/v1/ops/worker-health", requireRole(["ops", "worker"]), async (_req, res) => {
  try {
    const result = await pool.query(`select * from worker_health order by updated_at desc`);
    return res.json(result.rows);
  } catch {
    return res.status(500).json({ error: "Falha ao listar saúde do worker." });
  }
});

app.post("/v1/ops/worker/heartbeat", requireRole(["worker", "ops"]), async (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

  try {
    await pool.query(
      `insert into worker_health (worker_id, last_poll_at, last_claim_at, last_error)
       values ($1, now(), case when $2 then now() else null end, $3)
       on conflict (worker_id)
       do update set
          last_poll_at = now(),
          last_claim_at = case when $2 then now() else worker_health.last_claim_at end,
          last_error = $3,
          updated_at = now()`,
      [parsed.data.workerId, Boolean(parsed.data.claimed), parsed.data.lastError || null],
    );

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Falha ao atualizar heartbeat." });
  }
});

app.get("/v1/ops/metrics", requireRole(["ops", "worker"]), async (_req, res) => {
  try {
    const [queueTime, processingTime, failRate] = await Promise.all([
      pool.query(
        `select avg(extract(epoch from (wc.claimed_at - o.created_at))) as avg_queue_seconds
         from worker_claims wc
         join orders o on o.id = wc.order_id`,
      ),
      pool.query(
        `select avg(extract(epoch from (wc.released_at - wc.claimed_at))) as avg_processing_seconds
         from worker_claims wc
         where wc.released_at is not null`,
      ),
      pool.query(
        `select
           count(*) filter (where status = 'failed')::float / nullif(count(*), 0)::float as failed_ratio
         from orders`,
      ),
    ]);

    return res.json({
      avgQueueSeconds: Number(queueTime.rows[0].avg_queue_seconds || 0),
      avgProcessingSeconds: Number(processingTime.rows[0].avg_processing_seconds || 0),
      failedRatio: Number(failRate.rows[0].failed_ratio || 0),
    });
  } catch {
    return res.status(500).json({ error: "Falha ao calcular métricas." });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

void ensureAssetStorageDir().catch((error) => {
  log("error", "asset_storage_prepare_failed", { error: String(error), dir: ASSET_STORAGE_DIR });
});

app.listen(PORT, () => {
  log("info", "queue_api_started", { port: PORT });
});
