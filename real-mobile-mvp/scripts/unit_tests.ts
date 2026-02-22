import assert from "node:assert/strict";
import { initialOrdersState, ordersReducer } from "../src/store/ordersReducer";
import type { OrderDetail } from "../src/queue/types";
import { computeProfileReadiness } from "../src/auth/profileReadiness";
import {
  buildVideoDeliverableSummary,
  humanizeVideoError,
  mapVideoStatusToClientLabel,
} from "../src/services/videoEditorPresenter";
import { __resetPickerRecoveryMutexForTests, pickVideoWithRecoveryCore, type PickerRecoveryDeps } from "../src/services/videoPickerRecoveryCore";

function testUpsertAndStatusTransition() {
  const state1 = ordersReducer(initialOrdersState, {
    type: "UPSERT_ORDERS",
    orders: [
      {
        id: "o1",
        customerId: "c1",
        type: "ads",
        status: "draft",
        title: "Trafego",
        summary: "Teste",
        payload: {},
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    ],
  });

  assert.equal(state1.ordersById.o1?.status, "draft");

  const state2 = ordersReducer(state1, {
    type: "SET_ORDER_STATUS",
    orderId: "o1",
    status: "queued",
  });
  assert.equal(state2.ordersById.o1?.status, "queued");
}

function testApprovalUpdatesDeliverableAndOrder() {
  const detail: OrderDetail = {
    id: "o2",
    customerId: "c1",
    type: "ads",
    status: "needs_approval",
    title: "Pedido Ads",
    summary: "Resumo",
    payload: {},
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    events: [],
    deliverables: [
      {
        id: "d1",
        orderId: "o2",
        type: "creative",
        status: "submitted",
        content: {},
        assetUrls: [],
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      {
        id: "d2",
        orderId: "o2",
        type: "copy",
        status: "submitted",
        content: {},
        assetUrls: [],
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    ],
    approvals: [
      {
        deliverableId: "d1",
        status: "pending",
        feedback: "",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
      {
        deliverableId: "d2",
        status: "pending",
        feedback: "",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    ],
    assets: [],
    adsPublication: null,
  };

  const s1 = ordersReducer(initialOrdersState, { type: "UPSERT_DETAIL", detail });
  const s2 = ordersReducer(s1, { type: "APPLY_APPROVAL", orderId: "o2", deliverableId: "d1", status: "approved" });

  assert.equal(s2.detailsById.o2?.deliverables.find((d) => d.id === "d1")?.status, "approved");
  assert.equal(s2.detailsById.o2?.status, "needs_approval");

  const s3 = ordersReducer(s2, { type: "APPLY_APPROVAL", orderId: "o2", deliverableId: "d2", status: "approved" });
  assert.equal(s3.detailsById.o2?.deliverables.find((d) => d.id === "d2")?.status, "approved");
  assert.equal(s3.detailsById.o2?.status, "in_progress");
}

function testProfileReadinessMinimumComplete() {
  const result = computeProfileReadiness({
    rayX: {
      mainGoal: "leads",
      monthlyBudget: "500_1000",
      marketSegment: "Clinica odontologica",
    },
    companyProfile: {
      companyName: "Clinica Real",
      instagram: "@clinicareal",
      whatsappBusiness: "(17)99999-9999",
      targetAudience: "Adultos de 25 a 55",
      city: "Sao Jose do Rio Preto",
    },
  });

  assert.equal(result.profileMinimumComplete, true);
  assert.equal(result.profileProductionComplete, false);
  assert.equal(result.missingForProduction.includes("website"), true);
}

function testProfileReadinessProductionComplete() {
  const result = computeProfileReadiness({
    rayX: {
      knowledgeLevel: "intermediario",
      mainGoal: "visibilidade",
      monthlyBudget: "1000_5000",
      marketSegment: "Clinica estetica",
    },
    companyProfile: {
      companyName: "Real Clinica",
      instagram: "@realclinica",
      website: "https://realclinica.com",
      googleBusinessLink: "https://g.page/realclinica",
      whatsappBusiness: "(17)98888-8888",
      targetAudience: "Mulheres de 25 a 45",
      city: "Sao Paulo",
      offerSummary: "Consultas e procedimentos esteticos",
      mainDifferential: "Atendimento rapido e humanizado",
      primarySalesChannel: "WhatsApp",
      competitorsReferences: "Concorrente A, Concorrente B",
    },
  });

  assert.equal(result.profileMinimumComplete, true);
  assert.equal(result.profileProductionComplete, true);
  assert.equal(result.missingForProduction.length, 0);
}

function testProfileReadinessMissingFields() {
  const result = computeProfileReadiness({
    rayX: {
      mainGoal: "leads",
      monthlyBudget: "ate_200",
      marketSegment: "Clinica",
    },
    companyProfile: {
      companyName: "Teste",
      instagram: "@teste",
      whatsappBusiness: "(17)90000-0000",
      targetAudience: "Moradores locais",
      city: "Rio Preto",
      website: "",
      offerSummary: "",
    },
  });

  assert.equal(result.profileMinimumComplete, true);
  assert.equal(result.profileProductionComplete, false);
  assert.equal(result.missingForProduction.includes("knowledgeLevel"), true);
  assert.equal(result.missingForProduction.includes("website"), true);
  assert.equal(result.missingForProduction.includes("offerSummary"), true);
}

function testVideoStatusPresenter() {
  assert.equal(mapVideoStatusToClientLabel(null), "Aguardando envio do video.");
  assert.equal(mapVideoStatusToClientLabel("QUEUED"), "Preparando sua edicao.");
  assert.equal(mapVideoStatusToClientLabel("PROCESSING", 0.2), "Analisando e selecionando os melhores trechos.");
  assert.equal(mapVideoStatusToClientLabel("PROCESSING", 0.6), "Editando seu video com IA.");
  assert.equal(mapVideoStatusToClientLabel("PROCESSING", 0.95), "Finalizando o video para exportacao.");
  assert.equal(mapVideoStatusToClientLabel("COMPLETE"), "Video pronto para visualizar e baixar.");
}

function testVideoErrorHumanization() {
  assert.equal(
    humanizeVideoError("video_http_500:{\"detail\":\"stack trace\"}"),
    "Tivemos um erro tecnico ao editar seu video. Tente novamente.",
  );
  assert.equal(
    humanizeVideoError("video nao esta em 9:16 vertical"),
    "Este video nao esta em 9:16. Envie um video vertical (ex.: 1080x1920).",
  );
}

function testVideoDeliverableSummary() {
  const summary = buildVideoDeliverableSummary({
    kind: "video",
    clipDurationSeconds: 14.2,
    subtitles: { status: "applied" },
    stylePrompt: "mais dinamico",
  });
  assert.equal(summary.includes("Video final processado para redes sociais."), true);
  assert.equal(summary.includes("Duracao aproximada: 14.2s."), true);
  assert.equal(summary.includes("Legendas automaticas aplicadas."), true);
  assert.equal(summary.includes("Estilo solicitado considerado na edicao."), true);
}

function createPickerDeps(overrides?: Partial<PickerRecoveryDeps>): PickerRecoveryDeps {
  const stagedSizes = new Map<string, number>();
  return {
    platform: "ios",
    launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
    getDocumentAsync: async () => ({ canceled: true, assets: [] }),
    copyAsync: async ({ to }) => {
      stagedSizes.set(to, 1024);
    },
    getInfoAsync: async (uri: string) => ({ exists: stagedSizes.has(uri), size: stagedSizes.get(uri) ?? 0 }),
    cacheDirectory: "file:///tmp/",
    documentDirectory: "file:///docs/",
    sleepMs: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    nowMs: () => Date.now(),
    random: () => Math.random(),
    ...overrides,
  };
}

async function testPickerRecoverySuccessFirstAttempt() {
  __resetPickerRecoveryMutexForTests();
  const events: string[] = [];
  let galleryCalls = 0;
  let documentCalls = 0;
  const deps = createPickerDeps({
    launchImageLibraryAsync: async () => {
      galleryCalls += 1;
      return {
        canceled: false,
        assets: [{ uri: "file:///video-a.mp4", fileName: "video-a.mp4", mimeType: "video/mp4", duration: 5000, fileSize: 2048 }],
      };
    },
    getDocumentAsync: async () => {
      documentCalls += 1;
      return { canceled: true, assets: [] };
    },
  });

  const recovered = await pickVideoWithRecoveryCore({
    traceId: "trace_picker_a",
    galleryAttempts: [{ id: "gallery_preserve", options: {} }],
    documentPickerOptions: {},
    deps,
    log: ({ event }) => {
      events.push(event);
    },
  });

  assert.equal(recovered?.source, "gallery_preserve");
  assert.equal(galleryCalls, 1);
  assert.equal(documentCalls, 0);
  assert.equal(events.includes("picker_stage_copy_ok"), true);
}

async function testPickerRecoverySecondAttemptAfterFirstFailure() {
  __resetPickerRecoveryMutexForTests();
  const events: string[] = [];
  let galleryCalls = 0;
  const deps = createPickerDeps({
    launchImageLibraryAsync: async () => {
      galleryCalls += 1;
      if (galleryCalls === 1) {
        throw new Error("PHPhotosErrorDomain error 3164");
      }
      return {
        canceled: false,
        assets: [{ uri: "file:///video-b.mp4", fileName: "video-b.mp4", mimeType: "video/mp4", duration: 12, fileSize: 4096 }],
      };
    },
  });

  const recovered = await pickVideoWithRecoveryCore({
    traceId: "trace_picker_b",
    galleryAttempts: [
      { id: "gallery_preserve", options: {} },
      { id: "gallery_compat", options: {} },
    ],
    documentPickerOptions: {},
    deps,
    log: ({ event }) => {
      events.push(event);
    },
  });

  assert.equal(galleryCalls, 2);
  assert.equal(recovered?.source, "gallery_compat");
  assert.equal(events.includes("picker_attempt_recovered"), true);
}

async function testPickerRecoveryFallsBackToDocuments() {
  __resetPickerRecoveryMutexForTests();
  const events: string[] = [];
  let documentCalls = 0;
  const deps = createPickerDeps({
    launchImageLibraryAsync: async () => {
      throw new Error("picker_failed");
    },
    getDocumentAsync: async () => {
      documentCalls += 1;
      return {
        canceled: false,
        assets: [{ uri: "file:///video-c.mp4", fileName: "video-c.mp4", mimeType: "video/mp4", duration: 5, fileSize: 1500 }],
      };
    },
  });

  const recovered = await pickVideoWithRecoveryCore({
    traceId: "trace_picker_c",
    galleryAttempts: [
      { id: "gallery_preserve", options: {} },
      { id: "gallery_compat", options: {} },
    ],
    documentPickerOptions: {},
    deps,
    log: ({ event }) => {
      events.push(event);
    },
  });

  assert.equal(documentCalls, 1);
  assert.equal(recovered?.source, "document_auto");
  assert.equal(events.includes("picker_auto_document_start"), true);
  assert.equal(events.includes("picker_auto_document_ok"), true);
}

async function testPickerRecoveryMutexBlocksConcurrentPickers() {
  __resetPickerRecoveryMutexForTests();
  let running = 0;
  let maxRunning = 0;
  let call = 0;
  const deps = createPickerDeps({
    launchImageLibraryAsync: async () => {
      call += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const current = call;
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
      return {
        canceled: false,
        assets: [{ uri: `file:///video-${current}.mp4`, fileName: `video-${current}.mp4`, mimeType: "video/mp4", duration: 7, fileSize: 2000 }],
      };
    },
  });

  const params = {
    galleryAttempts: [{ id: "gallery_preserve" as const, options: {} }],
    documentPickerOptions: {},
    deps,
  };
  const [first, second] = await Promise.all([
    pickVideoWithRecoveryCore({ traceId: "trace_mutex_1", ...params }),
    pickVideoWithRecoveryCore({ traceId: "trace_mutex_2", ...params }),
  ]);

  assert.ok(first);
  assert.ok(second);
  assert.equal(maxRunning, 1);
}

async function main() {
  testUpsertAndStatusTransition();
  testApprovalUpdatesDeliverableAndOrder();
  testProfileReadinessMinimumComplete();
  testProfileReadinessProductionComplete();
  testProfileReadinessMissingFields();
  testVideoStatusPresenter();
  testVideoErrorHumanization();
  testVideoDeliverableSummary();
  await testPickerRecoverySuccessFirstAttempt();
  await testPickerRecoverySecondAttemptAfterFirstFailure();
  await testPickerRecoveryFallsBackToDocuments();
  await testPickerRecoveryMutexBlocksConcurrentPickers();
  // Keep output short (CI-friendly).
  console.log("unit_tests: ok");
}

main().catch((err) => {
  console.error("unit_tests: failed");
  console.error(err);
  process.exit(1);
});
