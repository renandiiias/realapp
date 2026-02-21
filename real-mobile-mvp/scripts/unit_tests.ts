import assert from "node:assert/strict";
import { initialOrdersState, ordersReducer } from "../src/store/ordersReducer";
import type { OrderDetail } from "../src/queue/types";
import { computeProfileReadiness } from "../src/auth/profileReadiness";

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

function main() {
  testUpsertAndStatusTransition();
  testApprovalUpdatesDeliverableAndOrder();
  testProfileReadinessMinimumComplete();
  testProfileReadinessProductionComplete();
  testProfileReadinessMissingFields();
  // Keep output short (CI-friendly).
  console.log("unit_tests: ok");
}

try {
  main();
} catch (err) {
  console.error("unit_tests: failed");
  console.error(err);
  process.exit(1);
}
