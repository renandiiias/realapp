require("dotenv").config();

const QUEUE_API_BASE_URL = (process.env.QUEUE_API_BASE_URL || "http://localhost:3334").replace(/\/+$/, "");
const WORKER_API_KEY = process.env.WORKER_API_KEY;
const WORKER_ID = process.env.WORKER_ID || `codex-worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const CLAIM_LEASE_SECONDS = Number(process.env.CLAIM_LEASE_SECONDS || 120);
const VIDEO_EDITOR_API_BASE_URL = (process.env.VIDEO_EDITOR_API_BASE_URL || "").replace(/\/+$/, "");
const VIDEO_EDITOR_PUBLIC_BASE_URL = (process.env.VIDEO_EDITOR_PUBLIC_BASE_URL || VIDEO_EDITOR_API_BASE_URL).replace(/\/+$/, "");
const SITE_BUILDER_API_BASE_URL = (process.env.SITE_BUILDER_API_BASE_URL || "http://localhost:3340").replace(/\/+$/, "");

const REAL_ADS_ENABLED = String(process.env.REAL_ADS_ENABLED || "false").toLowerCase() === "true";
const META_ACCESS_TOKEN = (process.env.META_ACCESS_TOKEN || "").trim();
const META_AD_ACCOUNT_ID = (process.env.META_AD_ACCOUNT_ID || "").trim().replace(/^act_/, "");
const META_GRAPH_VERSION = (process.env.META_GRAPH_VERSION || "v21.0").trim();
const META_API_BASE = "https://graph.facebook.com";

if (!WORKER_API_KEY) {
  throw new Error("WORKER_API_KEY é obrigatória.");
}

function log(level, message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, workerId: WORKER_ID, message, ...meta }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${QUEUE_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": WORKER_API_KEY,
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  const data = safeJson(raw);
  if (!res.ok) {
    throw new Error(`http_${res.status}:${data.error || raw || "unknown"}`);
  }
  return data;
}

async function videoApi(path, init = {}) {
  if (!VIDEO_EDITOR_API_BASE_URL) {
    throw new Error("video_editor_api_not_configured");
  }
  const res = await fetch(`${VIDEO_EDITOR_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  const data = safeJson(raw);
  if (!res.ok) {
    throw new Error(`video_http_${res.status}:${data.detail || data.error || raw || "unknown"}`);
  }
  return data;
}

async function siteApi(path, init = {}) {
  if (!SITE_BUILDER_API_BASE_URL) {
    throw new Error("site_builder_api_not_configured");
  }
  const res = await fetch(`${SITE_BUILDER_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  const data = safeJson(raw);
  if (!res.ok) {
    throw new Error(`site_builder_http_${res.status}:${data.error || raw || "unknown"}`);
  }
  return data;
}

function buildVideoOutputUrl(outputPath) {
  if (!VIDEO_EDITOR_PUBLIC_BASE_URL || !outputPath) return null;
  const name = String(outputPath).split(/[\\/]/).pop();
  if (!name) return null;
  return `${VIDEO_EDITOR_PUBLIC_BASE_URL}/media/storage/output/${encodeURIComponent(name)}`;
}

async function waitVideoJob(jobId, timeoutMs = 5 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await videoApi(`/jobs/${jobId}`, { method: "GET" });
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(`video_job_failed:${job.error || "unknown"}`);
    await sleep(1500);
  }
  throw new Error("video_job_timeout");
}

function missingInfo(order) {
  const p = order.payload || {};
  if (order.type === "ads") {
    if (!p.objective) return "Qual é o objetivo da campanha?";
    if (!p.offer) return "Qual é a oferta?";
    if (!p.budget) return "Qual é o investimento?";
    if (!p.region) return "Qual é a região da campanha?";
    if (!p.destinationWhatsApp) return "Qual WhatsApp deve receber as mensagens?";
    if (!Array.isArray(p.mediaAssetIds) || p.mediaAssetIds.length === 0) return "Envie a mídia do anúncio (imagem ou vídeo).";
    return null;
  }
  if (order.type === "site") {
    if (!p.objective) return "Qual é o objetivo do site?";
    if (!p.cta) return "Qual é o CTA principal?";
    return null;
  }
  if (order.type === "content") {
    if (!p.platforms) return "Quais plataformas devem ser usadas?";
    if (!p.frequency) return "Qual frequência de postagem?";
    return null;
  }
  if (order.type === "video_editor") {
    if (!VIDEO_EDITOR_API_BASE_URL) return "Backend de vídeo não configurado no worker.";
    if (!p.backendInputPath) return "Faltou o arquivo enviado (backendInputPath).";
    return null;
  }
  return null;
}

async function heartbeat(lastError, claimed) {
  try {
    await api("/v1/ops/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({ workerId: WORKER_ID, lastError: lastError || undefined, claimed: Boolean(claimed) }),
    });
  } catch (error) {
    log("warn", "heartbeat_failed", { error: String(error) });
  }
}

function inferMonthlyBudget(payload) {
  const budget = String(payload?.budget || "").toLowerCase();
  if (budget === "ate_500") return 500;
  if (budget === "500_1500") return 1000;
  if (budget === "1500_5000") return 3000;
  if (budget === "5000_mais") return 6000;
  const values = Array.from(budget.matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => Number(String(m[0]).replace(".", "").replace(",", ".")));
  if (!values.length) return 1200;
  const avg = values.reduce((acc, n) => acc + n, 0) / values.length;
  if (budget.includes("/dia") || budget.includes(" dia") || budget.includes("diario") || budget.includes("diário")) {
    return avg * 30;
  }
  return avg;
}

function toDailyBudgetCents(payload) {
  const monthly = inferMonthlyBudget(payload);
  const daily = monthly / 30;
  return Math.max(500, Math.round(daily * 100));
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

function cleanTargeting(targeting) {
  const drop = new Set([
    "flexible_spec",
    "interests",
    "behaviors",
    "life_events",
    "industries",
    "income",
    "family_statuses",
    "work_employers",
    "work_positions",
    "education_schools",
    "education_majors",
    "education_statuses",
    "fields_of_study",
    "relationship_statuses",
    "user_adclusters",
  ]);
  const out = { ...(targeting || {}) };
  for (const key of Object.keys(out)) {
    if (drop.has(key)) delete out[key];
  }
  return out;
}

function getPrimaryText(order) {
  const objective = String(order.payload?.objective || "").trim();
  const offer = String(order.payload?.offer || "").trim();
  return [objective, offer, "Chame no WhatsApp para atendimento."].filter(Boolean).join(". ");
}

function sanitizeNamePart(value, fallback = "Cliente") {
  const raw = String(value || "")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return fallback;
  return raw.slice(0, 70);
}

function objectiveLabel(value) {
  const key = String(value || "").toLowerCase().trim();
  if (!key) return "Trafego WhatsApp";
  const mapped = {
    whatsapp_messages: "Mensagens WhatsApp",
    messages: "Mensagens",
    leads: "Leads",
    conversions: "Conversoes",
    traffic: "Trafego",
    awareness: "Reconhecimento",
  };
  return mapped[key] || sanitizeNamePart(value, "Trafego WhatsApp");
}

function buildMetaNames(order) {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const orderSuffix = String(order.id || "").slice(0, 8);
  const customerName = sanitizeNamePart(
    order.payload?.customerName || order.payload?.companyName || `Cliente ${String(order.customerId || "").slice(0, 6)}`,
  );
  const objective = objectiveLabel(order.payload?.objective);
  const offer = sanitizeNamePart(order.payload?.offer || "Criativo", "Criativo");

  return {
    campaignName: `${customerName} | Real | ${objective} | ${dateLabel}`,
    adsetName: `${customerName} | Publico | ${objective} | ${orderSuffix}`,
    adName: `${customerName} | ${offer} | ${dateLabel}`,
    creativeName: `${customerName} | Criativo | ${objective} | ${orderSuffix}`,
  };
}

function normalizeMetaVersion(v) {
  const value = String(v || "v21.0").trim();
  if (!value) return "v21.0";
  return value.startsWith("v") ? value : `v${value}`;
}

async function metaGet(apiPath, params = {}) {
  const version = normalizeMetaVersion(META_GRAPH_VERSION);
  const url = new URL(`${META_API_BASE}/${version}/${String(apiPath).replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries({ ...params, access_token: META_ACCESS_TOKEN })) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { method: "GET" });
  const raw = await response.text();
  const payload = safeJson(raw);
  if (!response.ok) {
    throw new Error(`meta_http_${response.status}:${raw || "unknown"}`);
  }
  return payload;
}

async function metaPost(apiPath, data = {}, formData = null) {
  const version = normalizeMetaVersion(META_GRAPH_VERSION);
  const url = new URL(`${META_API_BASE}/${version}/${String(apiPath).replace(/^\/+/, "")}`);
  const body = formData || new URLSearchParams();
  if (formData) {
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined || value === null) continue;
      body.append(key, String(value));
    }
    body.append("access_token", META_ACCESS_TOKEN);
  } else {
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined || value === null) continue;
      body.set(key, String(value));
    }
    body.set("access_token", META_ACCESS_TOKEN);
  }

  const response = await fetch(url, {
    method: "POST",
    body,
  });
  const raw = await response.text();
  const payload = safeJson(raw);
  if (!response.ok) {
    throw new Error(`meta_http_${response.status}:${raw || "unknown"}`);
  }
  return payload;
}

function creativeSupportsMedia(creative, kind) {
  const hasAssetFeed = creative?.asset_feed_spec && typeof creative.asset_feed_spec === "object";
  const hasObjectSpec = creative?.object_story_spec && typeof creative.object_story_spec === "object";

  if (kind === "image") {
    if (hasAssetFeed) return true;
    return Boolean(creative?.object_story_spec?.link_data && typeof creative.object_story_spec.link_data === "object");
  }
  if (kind === "video") {
    if (hasAssetFeed) return true;
    return Boolean(creative?.object_story_spec?.video_data && typeof creative.object_story_spec.video_data === "object");
  }
  return false;
}

async function fetchTemplate(preferredMediaKind) {
  const adsetsPayload = await metaGet(`act_${META_AD_ACCOUNT_ID}/adsets`, {
    fields: "id,name,effective_status,destination_type,campaign_id,targeting",
    limit: "100",
  });
  const adsets = Array.isArray(adsetsPayload.data) ? adsetsPayload.data : [];
  const candidates = adsets.filter((item) => {
    const destinationType = String(item.destination_type || "").toUpperCase();
    const status = String(item.effective_status || "").toUpperCase();
    return destinationType === "WHATSAPP" && ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED"].includes(status);
  });
  if (!candidates.length) {
    throw new Error("meta_template_not_found");
  }

  let fallbackTemplate = null;
  for (const templateAdset of candidates) {
    const campaignId = String(templateAdset.campaign_id || "");
    if (!campaignId) continue;

    const [campaign, adsetFull, adsPayload] = await Promise.all([
      metaGet(campaignId, { fields: "id,name,objective,buying_type,special_ad_categories,daily_budget,lifetime_budget" }),
      metaGet(templateAdset.id, {
        fields: "id,name,billing_event,optimization_goal,bid_strategy,bid_amount,daily_budget,promoted_object,destination_type,targeting,attribution_spec",
      }),
      metaGet(`${templateAdset.id}/ads`, {
        fields: "id,name,effective_status,creative{id,name}",
        limit: "50",
      }),
    ]);

    const ads = Array.isArray(adsPayload.data) ? adsPayload.data : [];
    const selectedAd = ads.find((item) => ["ACTIVE", "PAUSED"].includes(String(item.effective_status || "").toUpperCase())) || ads[0];
    if (!selectedAd?.creative?.id) continue;

    const creative = await metaGet(String(selectedAd.creative.id), {
      fields: "id,name,object_story_spec,asset_feed_spec,instagram_actor_id,actor_id",
    });

    const template = { campaign, adset: adsetFull, creative };
    if (!fallbackTemplate) fallbackTemplate = template;

    if (!preferredMediaKind || creativeSupportsMedia(creative, preferredMediaKind)) {
      return { ...template, mediaCompatibility: "full" };
    }
  }

  if (fallbackTemplate) {
    return { ...fallbackTemplate, mediaCompatibility: "fallback_template_media" };
  }
  throw new Error("meta_template_campaign_missing");
}

function setCopyInSpec(spec, order) {
  const cloned = JSON.parse(JSON.stringify(spec || {}));
  const primaryText = getPrimaryText(order);
  const headline = String(order.payload?.offer || "Oferta").slice(0, 60);
  const description = "Fale com nosso time no WhatsApp";
  const prefill = `Oi! Quero saber mais sobre: ${String(order.payload?.offer || "oferta")}`;

  if (cloned.object_story_spec && typeof cloned.object_story_spec === "object") {
    const linkData = cloned.object_story_spec.link_data;
    if (linkData && typeof linkData === "object") {
      linkData.message = primaryText;
      linkData.name = headline;
      linkData.description = description;
      if (linkData.call_to_action && typeof linkData.call_to_action.value === "object") {
        if ("message" in linkData.call_to_action.value) linkData.call_to_action.value.message = prefill;
        if ("whatsapp_message" in linkData.call_to_action.value) linkData.call_to_action.value.whatsapp_message = prefill;
      }
    }
    if (cloned.object_story_spec.video_data && typeof cloned.object_story_spec.video_data === "object") {
      cloned.object_story_spec.video_data.message = primaryText;
      cloned.object_story_spec.video_data.title = headline;
    }
  }

  if (cloned.asset_feed_spec && typeof cloned.asset_feed_spec === "object") {
    const afs = cloned.asset_feed_spec;
    if (Array.isArray(afs.bodies)) {
      if (afs.bodies[0]) afs.bodies[0].text = primaryText;
      else afs.bodies.push({ text: primaryText });
    }
    if (Array.isArray(afs.titles)) {
      if (afs.titles[0]) afs.titles[0].text = headline;
      else afs.titles.push({ text: headline });
    }
    if (Array.isArray(afs.descriptions)) {
      if (afs.descriptions[0]) afs.descriptions[0].text = description;
      else afs.descriptions.push({ text: description });
    }
  }

  return cloned;
}

async function downloadOrderAsset(assetId) {
  const response = await fetch(`${QUEUE_API_BASE_URL}/v1/ops/assets/${assetId}/content`, {
    method: "GET",
    headers: {
      "x-api-key": WORKER_API_KEY,
    },
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`asset_download_failed:${response.status}:${raw}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return {
    contentType: response.headers.get("content-type") || "application/octet-stream",
    fileName: response.headers.get("x-file-name") || `${assetId}.bin`,
    bytes: Buffer.from(arrayBuffer),
  };
}

async function uploadMediaToMeta(order, asset) {
  const downloaded = await downloadOrderAsset(asset.id);
  if (asset.kind === "image") {
    const form = new FormData();
    form.append("file", new Blob([downloaded.bytes], { type: downloaded.contentType }), downloaded.fileName);
    const result = await metaPost(`act_${META_AD_ACCOUNT_ID}/adimages`, { filename: downloaded.fileName }, form);
    const images = result.images || {};
    const first = Object.values(images)[0];
    if (!first || !first.hash) throw new Error("meta_image_upload_missing_hash");
    return { kind: "image", imageHash: String(first.hash) };
  }

  const form = new FormData();
  form.append("source", new Blob([downloaded.bytes], { type: downloaded.contentType }), downloaded.fileName);
  const result = await metaPost(`act_${META_AD_ACCOUNT_ID}/advideos`, {}, form);
  if (!result.id) throw new Error("meta_video_upload_missing_id");
  return { kind: "video", videoId: String(result.id) };
}

function applyMediaToCreative(spec, uploadedMedia) {
  const out = JSON.parse(JSON.stringify(spec || {}));

  if (out.asset_feed_spec && typeof out.asset_feed_spec === "object") {
    if (uploadedMedia.kind === "image") {
      if (!Array.isArray(out.asset_feed_spec.images)) out.asset_feed_spec.images = [];
      if (out.asset_feed_spec.images[0]) out.asset_feed_spec.images[0].hash = uploadedMedia.imageHash;
      else out.asset_feed_spec.images.push({ hash: uploadedMedia.imageHash });
      return { mode: "asset_feed_spec", payload: { asset_feed_spec: JSON.stringify(out.asset_feed_spec) } };
    }

    if (!Array.isArray(out.asset_feed_spec.videos)) out.asset_feed_spec.videos = [];
    if (out.asset_feed_spec.videos[0]) out.asset_feed_spec.videos[0].video_id = uploadedMedia.videoId;
    else out.asset_feed_spec.videos.push({ video_id: uploadedMedia.videoId });
    return { mode: "asset_feed_spec", payload: { asset_feed_spec: JSON.stringify(out.asset_feed_spec) } };
  }

  if (out.object_story_spec && typeof out.object_story_spec === "object") {
    const oss = out.object_story_spec;
    if (uploadedMedia.kind === "image") {
      if (!oss.link_data || typeof oss.link_data !== "object") throw new Error("meta_template_link_data_missing_for_image");
      oss.link_data.image_hash = uploadedMedia.imageHash;
    } else {
      if (!oss.video_data || typeof oss.video_data !== "object") throw new Error("meta_template_video_data_missing_for_video");
      oss.video_data.video_id = uploadedMedia.videoId;
    }
    return { mode: "object_story_spec", payload: { object_story_spec: JSON.stringify(oss) } };
  }

  throw new Error("meta_template_invalid_creative_spec");
}

function pickAsset(order) {
  const preferredIds = Array.isArray(order.payload?.mediaAssetIds) ? order.payload.mediaAssetIds.map((id) => String(id)) : [];
  const assets = Array.isArray(order.assets) ? order.assets : [];
  for (const id of preferredIds) {
    const found = assets.find((asset) => asset.id === id);
    if (found) return found;
  }
  return assets[0] || null;
}

function isTransientMetaError(error) {
  const message = String(error || "");
  return /meta_http_429|meta_http_5\d\d|network|timeout|fetch failed/i.test(message);
}

async function publishAds(order) {
  if (!REAL_ADS_ENABLED) {
    throw new Error("ads_feature_disabled");
  }
  if (!META_ACCESS_TOKEN || !/^\d+$/.test(META_AD_ACCOUNT_ID)) {
    throw new Error("meta_credentials_missing");
  }

  const mediaAsset = pickAsset(order);
  if (!mediaAsset) throw new Error("ads_media_asset_missing");

  const template = await fetchTemplate(mediaAsset?.kind);

  const names = buildMetaNames(order);
  const status = "ACTIVE";
  const dailyBudget = toDailyBudgetCents(order.payload);

  const campaignPayload = {
    name: names.campaignName,
    status,
    objective: template.campaign.objective,
    buying_type: template.campaign.buying_type || "AUCTION",
    special_ad_categories: JSON.stringify(template.campaign.special_ad_categories || []),
    is_adset_budget_sharing_enabled:
      !template.campaign.daily_budget && !template.campaign.lifetime_budget ? "false" : undefined,
  };
  if (template.campaign.daily_budget) {
    campaignPayload.daily_budget = String(dailyBudget);
  } else if (template.campaign.lifetime_budget) {
    campaignPayload.lifetime_budget = String(dailyBudget * 2);
  }

  const campaignResult = await metaPost(`act_${META_AD_ACCOUNT_ID}/campaigns`, compact(campaignPayload));
  const campaignId = String(campaignResult.id || "");
  if (!campaignId) throw new Error("meta_campaign_create_failed");

  const targeting = cleanTargeting(template.adset.targeting || {});
  if (!targeting.geo_locations) {
    targeting.geo_locations = { countries: ["BR"] };
  }

  const adsetPayload = {
    name: names.adsetName,
    campaign_id: campaignId,
    status,
    billing_event: template.adset.billing_event,
    optimization_goal: template.adset.optimization_goal,
    destination_type: template.adset.destination_type || "WHATSAPP",
    promoted_object: JSON.stringify(template.adset.promoted_object || {}),
    targeting: JSON.stringify(targeting),
    bid_strategy: template.adset.bid_strategy,
    bid_amount: template.adset.bid_amount ? String(template.adset.bid_amount) : undefined,
    attribution_spec: template.adset.attribution_spec ? JSON.stringify(template.adset.attribution_spec) : undefined,
    daily_budget: !template.campaign.daily_budget && !template.campaign.lifetime_budget ? String(dailyBudget) : undefined,
  };

  const adsetResult = await metaPost(`act_${META_AD_ACCOUNT_ID}/adsets`, compact(adsetPayload));
  const adsetId = String(adsetResult.id || "");
  if (!adsetId) throw new Error("meta_adset_create_failed");

  const specWithCopy = setCopyInSpec(
    {
      object_story_spec: template.creative.object_story_spec,
      asset_feed_spec: template.creative.asset_feed_spec,
    },
    order,
  );

  if (template.mediaCompatibility === "fallback_template_media") {
    throw new Error("meta_template_not_compatible_with_uploaded_media");
  }

  let mediaApplied;
  const uploadedMedia = await uploadMediaToMeta(order, mediaAsset);
  mediaApplied = applyMediaToCreative(specWithCopy, uploadedMedia);

  const creativePayload = compact({
    name: names.creativeName,
    status,
    ...mediaApplied.payload,
    instagram_actor_id: template.creative.instagram_actor_id,
    actor_id: template.creative.actor_id,
  });

  const creativeResult = await metaPost(`act_${META_AD_ACCOUNT_ID}/adcreatives`, creativePayload);
  const creativeId = String(creativeResult.id || "");
  if (!creativeId) throw new Error("meta_creative_create_failed");

  const adPayload = {
    name: names.adName,
    adset_id: adsetId,
    status,
    creative: JSON.stringify({ creative_id: creativeId }),
  };

  const adResult = await metaPost(`act_${META_AD_ACCOUNT_ID}/ads`, adPayload);
  const adId = String(adResult.id || "");
  if (!adId) throw new Error("meta_ad_create_failed");

  return {
    metaCampaignId: campaignId,
    metaAdsetId: adsetId,
    metaCreativeId: creativeId,
    metaAdId: adId,
    status,
    rawResponse: {
      campaignResult,
      adsetResult,
      creativeResult,
      adResult,
      creativeMode: mediaApplied.mode,
      templateMediaCompatibility: template.mediaCompatibility || "full",
    },
  };
}

async function publishAdsWithRetry(order, maxAttempts = 2) {
  let attempt = 1;
  while (attempt <= maxAttempts) {
    try {
      return await publishAds(order);
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientMetaError(error)) {
        throw error;
      }
      await api(`/v1/ops/orders/${order.id}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: `Erro transitório ao publicar anúncio (tentativa ${attempt}). Nova tentativa em 5s.`,
          statusSnapshot: "in_progress",
        }),
      });
      await sleep(5000);
      attempt += 1;
    }
  }
  throw new Error("ads_publish_retry_exhausted");
}

async function processAdsOrder(order) {
  await api(`/v1/ops/orders/${order.id}/event`, {
    method: "POST",
    body: JSON.stringify({
      message: "Publicando campanha na Meta Ads.",
      statusSnapshot: "in_progress",
    }),
  });

  const published = await publishAdsWithRetry(order, 2);

  await api(`/v1/ops/orders/${order.id}/ads-publication`, {
    method: "POST",
    body: JSON.stringify({
      metaCampaignId: published.metaCampaignId,
      metaAdsetId: published.metaAdsetId,
      metaAdId: published.metaAdId,
      metaCreativeId: published.metaCreativeId,
      status: published.status,
      rawResponse: published.rawResponse,
    }),
  });

  await api(`/v1/ops/orders/${order.id}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "campaign_plan",
          status: "submitted",
          content: {
            objective: order.payload.objective,
            budget: order.payload.budget,
            destinationWhatsApp: order.payload.destinationWhatsApp,
            metaCampaignId: published.metaCampaignId,
          },
          assetUrls: [],
        },
        {
          type: "audience_summary",
          status: "submitted",
          content: {
            region: order.payload.region,
            audience: order.payload.audience || "público amplo inicial",
            status: published.status,
          },
          assetUrls: [],
        },
        {
          type: "url_preview",
          status: "submitted",
          content: {
            metaAdId: published.metaAdId,
            message: "Campanha publicada e ativa na conta da Real.",
          },
          assetUrls: [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${order.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: "done",
      message: "Campanha publicada na Meta e colocada em ACTIVE.",
    }),
  });
}

async function processVideoEditorOrder(order) {
  const orderId = order.id;
  const inputPath = String(order.payload.backendInputPath || "");
  const inputDuration = Number(order.payload.durationSeconds || 15);
  const clipEnd = Math.max(1, Math.min(15, Number.isFinite(inputDuration) ? inputDuration : 15));

  const autoEdit = await videoApi("/jobs/auto-edit", {
    method: "POST",
    body: JSON.stringify({
      input_path: inputPath,
      max_duration_seconds: clipEnd,
      remove_silence: true,
      silence_noise_db: -35,
      silence_min_duration: 0.35,
      padding_before: 0.08,
      padding_after: 0.12,
      min_segment_duration: 0.2,
      output_name: `auto_${orderId}.mp4`,
    }),
  });
  const autoResult = await waitVideoJob(autoEdit.job_id);
  const editedOutput = autoResult?.result?.output_path;
  if (!editedOutput) throw new Error("video_auto_edit_missing_output");

  let renderInputPath = editedOutput;
  let subtitles = { enabled: true, status: "skipped" };
  const autoCaptions = order?.payload?.autoCaptions !== false;

  if (autoCaptions) {
    try {
      await api(`/v1/ops/orders/${orderId}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: "Gerando legendas automáticas.",
          statusSnapshot: "in_progress",
        }),
      });

      const subtitleGenerate = await videoApi("/jobs/subtitles/generate", {
        method: "POST",
        body: JSON.stringify({
          input_path: editedOutput,
          language: "pt",
          max_chars_per_line: 36,
          output_name: `subs_${orderId}.srt`,
        }),
      });
      const subtitleResult = await waitVideoJob(subtitleGenerate.job_id, 8 * 60 * 1000);
      const subtitlesPath = subtitleResult?.result?.output_path;
      if (!subtitlesPath) throw new Error("video_subtitles_missing_output");

      const subtitleBurn = await videoApi("/jobs/subtitles/burn", {
        method: "POST",
        body: JSON.stringify({
          input_path: editedOutput,
          subtitles_path: subtitlesPath,
          style: {
            font_name: "Arial",
            font_size: 52,
            primary_color: "&H00FFFFFF",
            outline_color: "&H00000000",
            outline: 3,
            shadow: 1,
            alignment: 2,
            margin_v: 88,
          },
          output_name: `captioned_${orderId}.mp4`,
        }),
      });
      const burnResult = await waitVideoJob(subtitleBurn.job_id, 8 * 60 * 1000);
      const captionedOutput = burnResult?.result?.output_path;
      if (!captionedOutput) throw new Error("video_subtitles_burn_missing_output");

      renderInputPath = captionedOutput;
      subtitles = {
        enabled: true,
        status: "applied",
        subtitlesPath,
        captionedOutput,
      };
    } catch (error) {
      subtitles = {
        enabled: true,
        status: "failed",
        error: String(error),
      };
      await api(`/v1/ops/orders/${orderId}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: "Falha ao aplicar legendas. Entregando vídeo sem legenda nesta execução.",
          statusSnapshot: "in_progress",
        }),
      });
    }
  } else {
    subtitles = { enabled: false, status: "disabled" };
  }

  const delivered = await videoApi("/jobs/deliver", {
    method: "POST",
    body: JSON.stringify({
      input_path: renderInputPath,
      preset: "social",
      width: 1080,
      height: 1920,
      output_name: `final_${orderId}.mp4`,
    }),
  });
  const deliveredResult = await waitVideoJob(delivered.job_id);
  const finalOutput = deliveredResult?.result?.output_path;
  if (!finalOutput) throw new Error("video_deliver_missing_output");

  const outputUrl = buildVideoOutputUrl(finalOutput);

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "url_preview",
          status: "submitted",
          content: {
            kind: "video",
            outputPath: finalOutput,
            outputUrl,
            stylePrompt: order.payload.stylePrompt || "",
            clipDurationSeconds: clipEnd,
            subtitles,
          },
          assetUrls: outputUrl ? [outputUrl] : [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: "done",
      message: outputUrl
        ? subtitles.status === "applied"
          ? "Vídeo final com legendas pronto para download."
          : "Vídeo final pronto para download."
        : "Vídeo final pronto no servidor (sem URL pública configurada).",
    }),
  });
}

function isTransientSiteError(error) {
  const message = String(error || "");
  return /site_builder_http_429|site_builder_http_5\d\d|timeout|network|fetch failed/i.test(message);
}

function sanitizeSiteSlug(value, fallback) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function getSiteCopyDeliverable(order) {
  const deliverables = Array.isArray(order?.deliverables) ? order.deliverables : [];
  return deliverables.find((item) => item.type === "copy") || null;
}

function getApprovalForDeliverable(order, deliverableId) {
  const approvals = Array.isArray(order?.approvals) ? order.approvals : [];
  return approvals.find((item) => item.deliverableId === deliverableId) || null;
}

function extractBuilderSpec(order) {
  const fromCopy = getSiteCopyDeliverable(order)?.content;
  if (fromCopy && typeof fromCopy === "object" && !Array.isArray(fromCopy) && fromCopy.builderSpec && typeof fromCopy.builderSpec === "object") {
    return fromCopy.builderSpec;
  }
  if (order?.payload?.builder && typeof order.payload.builder === "object") {
    return order.payload.builder;
  }
  return null;
}

function getSitePrompt(order, feedback = "") {
  const basePrompt =
    String(order?.payload?.builderPrompt || "").trim() ||
    String(order?.payload?.prompt || "").trim() ||
    String(order?.payload?.objective || "").trim() ||
    "Crie uma landing page simples e direta para geração de leads no WhatsApp.";
  if (!feedback) return basePrompt;
  return `${basePrompt}\n\nAjustes solicitados pelo cliente: ${feedback}`;
}

function buildSiteContext(order) {
  const builder = extractBuilderSpec(order) || {};
  return {
    businessName: String(builder.businessName || order?.payload?.businessName || "").trim(),
    segment: String(builder.segment || order?.payload?.segment || "").trim(),
    city: String(builder.city || order?.payload?.city || "").trim(),
    audience: String(builder.audience || order?.payload?.audience || "").trim(),
    offerSummary: String(builder.offerSummary || order?.payload?.offerSummary || "").trim(),
    mainDifferential: String(builder.mainDifferential || order?.payload?.mainDifferential || "").trim(),
    whatsappNumber: String(builder.whatsappNumber || order?.payload?.whatsappNumber || "").trim(),
  };
}

async function withSiteRetry(orderId, fn, { maxAttempts = 2, onRetry } = {}) {
  let attempt = 1;
  while (attempt <= maxAttempts) {
    try {
      return await fn(attempt);
    } catch (error) {
      const transient = isTransientSiteError(error);
      if (!transient || attempt >= maxAttempts) {
        try {
          error.siteRetries = Math.max(0, attempt - 1);
        } catch {
          // no-op
        }
        throw error;
      }
      await api(`/v1/ops/orders/${orderId}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: `Erro transitório no pipeline de site (tentativa ${attempt}). Nova tentativa em 4s.`,
          statusSnapshot: "in_progress",
        }),
      });
      if (typeof onRetry === "function") {
        await onRetry({ attempt, error });
      }
      await sleep(4000);
      attempt += 1;
    }
  }
  throw new Error("site_retry_exhausted");
}

async function upsertSitePublication(orderId, publication) {
  await api(`/v1/ops/orders/${orderId}/site-publication`, {
    method: "POST",
    body: JSON.stringify(publication),
  });
}

async function generateSitePreview(order, reason = "") {
  const orderId = order.id;
  const fallbackSlug = sanitizeSiteSlug(
    order?.payload?.builder?.businessName || order?.payload?.headline || `site-${String(orderId).slice(0, 8)}`,
    `site-${String(orderId).slice(0, 8)}`,
  );
  const priorSlug = order?.sitePublication?.slug || fallbackSlug;

  await upsertSitePublication(orderId, {
    stage: "building",
    slug: priorSlug,
    previewUrl: order?.sitePublication?.previewUrl || undefined,
    publicUrl: order?.sitePublication?.publicUrl || undefined,
    retries: 0,
    metadata: { reason: reason || "initial" },
  });

  await api(`/v1/ops/orders/${orderId}/event`, {
    method: "POST",
    body: JSON.stringify({
      message: reason ? "Gerando nova versão da landing com os ajustes solicitados." : "Gerando landing page automática.",
      statusSnapshot: "in_progress",
    }),
  });

  let retryCount = 0;
  const builderSpec = await withSiteRetry(
    orderId,
    async () => {
    const response = await siteApi("/v1/autobuild", {
      method: "POST",
      body: JSON.stringify({
        prompt: getSitePrompt(order, reason),
        context: buildSiteContext(order),
        currentBuilder: extractBuilderSpec(order) || undefined,
        forceRegenerate: true,
      }),
    });
    if (!response?.builderSpec || typeof response.builderSpec !== "object") {
      throw new Error("site_autobuild_invalid_response");
    }
    return response.builderSpec;
    },
    {
      maxAttempts: 3,
      onRetry: async ({ attempt }) => {
        retryCount = attempt;
        await upsertSitePublication(orderId, {
          stage: "building",
          slug: priorSlug,
          previewUrl: order?.sitePublication?.previewUrl || undefined,
          publicUrl: order?.sitePublication?.publicUrl || undefined,
          retries: retryCount,
          metadata: { reason: reason || "initial", step: "autobuild" },
        });
      },
    },
  );

  const preview = await withSiteRetry(
    orderId,
    async () => {
      return siteApi("/v1/publish/preview", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          customerId: order.customerId,
          slug: priorSlug,
          builderSpec,
        }),
      });
    },
    {
      maxAttempts: 3,
      onRetry: async ({ attempt }) => {
        retryCount += 1;
        await upsertSitePublication(orderId, {
          stage: "building",
          slug: priorSlug,
          previewUrl: order?.sitePublication?.previewUrl || undefined,
          publicUrl: order?.sitePublication?.publicUrl || undefined,
          retries: retryCount,
          metadata: { reason: reason || "initial", step: "preview_publish", transientAttempt: attempt },
        });
      },
    },
  );

  await upsertSitePublication(orderId, {
    stage: "awaiting_approval",
    slug: String(preview.slug || priorSlug),
    previewUrl: String(preview.url || ""),
    publicUrl: order?.sitePublication?.publicUrl || undefined,
    retries: retryCount,
    lastError: "",
    metadata: { mode: "preview", generatedAt: new Date().toISOString() },
  });

  const sections = Array.isArray(builderSpec.blocks)
    ? builderSpec.blocks.filter((item) => item?.enabled).map((item) => item.label || item.id).filter(Boolean)
    : ["Hero", "Prova", "Oferta", "CTA"];

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "wireframe",
          status: "submitted",
          content: {
            sections,
            slug: String(preview.slug || priorSlug),
          },
          assetUrls: [],
        },
        {
          type: "copy",
          status: "submitted",
          content: {
            headline: builderSpec.headline || "Título principal",
            cta: builderSpec.ctaLabel || "Falar no WhatsApp",
            builderSpec,
          },
          assetUrls: [],
        },
        {
          type: "url_preview",
          status: "submitted",
          content: {
            kind: "site",
            mode: "preview",
            url: String(preview.url || ""),
            slug: String(preview.slug || priorSlug),
          },
          assetUrls: preview.url ? [String(preview.url)] : [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({ status: "needs_approval", message: "Preview da landing pronto para aprovação." }),
  });
}

async function publishSiteFinal(order) {
  const orderId = order.id;
  const builderSpec = extractBuilderSpec(order);
  if (!builderSpec) {
    throw new Error("site_builder_spec_missing_for_publish");
  }

  const slug = sanitizeSiteSlug(
    order?.sitePublication?.slug ||
      builderSpec.businessName ||
      order?.payload?.headline ||
      `site-${String(orderId).slice(0, 8)}`,
    `site-${String(orderId).slice(0, 8)}`,
  );

  await upsertSitePublication(orderId, {
    stage: "publishing",
    slug,
    previewUrl: order?.sitePublication?.previewUrl || undefined,
    publicUrl: order?.sitePublication?.publicUrl || undefined,
    retries: 0,
    metadata: { mode: "final" },
  });

  await api(`/v1/ops/orders/${orderId}/event`, {
    method: "POST",
    body: JSON.stringify({
      message: "Publicando versão final da landing.",
      statusSnapshot: "in_progress",
    }),
  });

  let retryCount = 0;
  const published = await withSiteRetry(
    orderId,
    async () => {
      return siteApi("/v1/publish/final", {
        method: "POST",
        body: JSON.stringify({
          orderId,
          customerId: order.customerId,
          slug,
          builderSpec,
        }),
      });
    },
    {
      maxAttempts: 3,
      onRetry: async ({ attempt }) => {
        retryCount = attempt;
        await upsertSitePublication(orderId, {
          stage: "publishing",
          slug,
          previewUrl: order?.sitePublication?.previewUrl || undefined,
          publicUrl: order?.sitePublication?.publicUrl || undefined,
          retries: retryCount,
          metadata: { mode: "final", step: "final_publish", transientAttempt: attempt },
        });
      },
    },
  );

  const publicUrl = String(published.url || "");
  const finalSlug = String(published.slug || slug);
  await upsertSitePublication(orderId, {
    stage: "published",
    slug: finalSlug,
    previewUrl: order?.sitePublication?.previewUrl || undefined,
    publicUrl,
    retries: retryCount,
    lastError: "",
    metadata: { mode: "final", publishedAt: new Date().toISOString() },
  });

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "url_preview",
          status: "published",
          content: {
            kind: "site",
            mode: "published",
            slug: finalSlug,
            previewUrl: order?.sitePublication?.previewUrl || null,
            publicUrl,
          },
          assetUrls: publicUrl ? [publicUrl] : [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: "done",
      message: "Landing page publicada no link final.",
    }),
  });
}

async function processOrder(order) {
  const orderId = order.id;
  const needInfo = missingInfo(order);

  await api(`/v1/ops/orders/${orderId}/event`, {
    method: "POST",
    body: JSON.stringify({ message: "Iniciando execução do pedido.", statusSnapshot: "in_progress" }),
  });

  if (needInfo) {
    await api(`/v1/ops/orders/${orderId}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "needs_info", message: `Precisamos de mais dados: ${needInfo}` }),
    });
    return;
  }

  if (order.type === "ads") {
    try {
      await processAdsOrder(order);
    } catch (error) {
      await api(`/v1/ops/orders/${orderId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          status: "failed",
          message: `Falha ao publicar campanha na Meta: ${String(error).slice(0, 800)}`,
        }),
      });
    }
    return;
  }

  if (order.type === "site") {
    try {
      const copyDeliverable = getSiteCopyDeliverable(order);
      const approval = copyDeliverable ? getApprovalForDeliverable(order, copyDeliverable.id) : null;
      if (approval?.status === "approved") {
        await publishSiteFinal(order);
      } else if (approval?.status === "changes_requested") {
        await generateSitePreview(order, String(approval.feedback || "").trim());
      } else {
        await generateSitePreview(order);
      }
    } catch (error) {
      const retries = Number(error?.siteRetries || order?.sitePublication?.retries || 0);
      await upsertSitePublication(orderId, {
        stage: "failed",
        slug: order?.sitePublication?.slug || undefined,
        previewUrl: order?.sitePublication?.previewUrl || undefined,
        publicUrl: order?.sitePublication?.publicUrl || undefined,
        retries,
        lastError: String(error).slice(0, 1800),
        metadata: { failedAt: new Date().toISOString() },
      });
      await api(`/v1/ops/orders/${orderId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          status: "failed",
          message: `Falha no pipeline do site: ${String(error).slice(0, 800)}`,
        }),
      });
    }
    return;
  }

  if (order.type === "video_editor") {
    await processVideoEditorOrder(order);
    return;
  }

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "calendar",
          status: "submitted",
          content: [
            { day: "Seg", topic: "Dor" },
            { day: "Qua", topic: "Prova" },
            { day: "Sex", topic: "Oferta" },
          ],
          assetUrls: [],
        },
        {
          type: "posts",
          status: "submitted",
          content: [{ title: "Post 1" }, { title: "Post 2" }],
          assetUrls: [],
        },
        {
          type: "reels_script",
          status: "submitted",
          content: {
            hook: "Se você faz isso, está perdendo dinheiro.",
            beats: ["Problema", "Solução", "CTA"],
          },
          assetUrls: [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({ status: "done", message: "Plano de conteúdo finalizado." }),
  });
}

async function loop() {
  while (true) {
    let hadClaim = false;
    try {
      const claimed = await api("/v1/ops/orders/claim", {
        method: "POST",
        body: JSON.stringify({ workerId: WORKER_ID, leaseSeconds: CLAIM_LEASE_SECONDS }),
      });

      if (!claimed.order) {
        await heartbeat(null, false);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      hadClaim = true;
      const order = claimed.order;
      log("info", "order_claimed", { orderId: order.id, type: order.type, status: order.status, attempt: claimed.claim?.attempt });
      await heartbeat(null, true);
      await processOrder(order);
      log("info", "order_processed", { orderId: order.id });
    } catch (error) {
      log("error", "loop_error", { error: String(error) });
      await heartbeat(String(error), hadClaim);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

log("info", "worker_started", {
  queueApi: QUEUE_API_BASE_URL,
  pollMs: POLL_INTERVAL_MS,
  videoApi: VIDEO_EDITOR_API_BASE_URL || null,
  adsEnabled: REAL_ADS_ENABLED,
});
loop().catch((error) => {
  log("error", "worker_fatal", { error: String(error) });
  process.exit(1);
});
