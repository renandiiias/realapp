(() => {
  const header = document.querySelector("[data-header]");
  const revealEls = Array.from(document.querySelectorAll("[data-reveal]"));

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" },
    );

    for (const el of revealEls) obs.observe(el);
  } else {
    for (const el of revealEls) el.classList.add("is-visible");
  }

  const flow = document.querySelector("[data-mini-flow]");
  if (!flow) return;

  const tabs = Array.from(flow.querySelectorAll("[data-flow-stage]"));
  const input = flow.querySelector("[data-mini-input]");
  const sendBtn = flow.querySelector("[data-mini-send]");
  const approveBtn = flow.querySelector("[data-mini-approve]");
  const reviseBtn = flow.querySelector("[data-mini-revise]");
  const statusTitle = flow.querySelector("[data-mini-status-title]");
  const statusText = flow.querySelector("[data-mini-status-text]");
  const codeEl = flow.querySelector("[data-mini-code]");
  const approvalGroup = flow.querySelector("[data-mini-approval]");
  const shots = Array.from(flow.querySelectorAll("[data-shot-stage]"));

  const stageMeta = {
    pedido: {
      title: "Pedido pronto para enviar",
      text: "Você descreve em texto simples e a Real transforma em plano executável.",
      showApproval: false,
    },
    execucao: {
      title: "Executando sem caos",
      text: "Pedido recebido. A Real organiza tarefas e inicia produção automaticamente.",
      showApproval: false,
    },
    aprovacao: {
      title: "Pronto para sua decisão",
      text: "Você só valida: aprovar ou pedir ajuste. O resto já está organizado.",
      showApproval: true,
    },
    aprovado: {
      title: "Aprovado",
      text: "Perfeito. A Real segue para publicação e próxima rodada de melhoria.",
      showApproval: true,
    },
    ajuste: {
      title: "Ajuste solicitado",
      text: "Feedback registrado. A Real atualiza o material e volta para nova aprovação.",
      showApproval: true,
    },
  };

  let execTimer = null;
  let currentStage = "pedido";
  let currentOutcome = "pending";

  function safePrompt(value) {
    const clean = String(value || "").trim();
    if (!clean) return "Quero mais leads para minha clínica sem aumentar caos no time.";
    return clean.replace(/\s+/g, " ");
  }

  function codeFor(stage, prompt, outcome) {
    const statusLabel =
      outcome === "approved" ? "approved" : outcome === "revision" ? "revision_requested" : "waiting_decision";
    const codeStage = stage === "aprovado" || stage === "ajuste" ? "aprovacao" : stage;

    if (codeStage === "pedido") {
      return [
        "const request = {",
        `  prompt: \"${prompt}\",`,
        "  source: \"quick_box\",",
        "};",
        "",
        "real.capture(request);",
      ].join("\n");
    }

    if (codeStage === "execucao") {
      return [
        "const flow = real.start(request);",
        "",
        "flow.enqueue([",
        "  \"brief\",",
        "  \"copy_variants\",",
        "  \"creative_direction\",",
        "]);",
        "",
        "flow.status = \"in_production\";",
      ].join("\n");
    }

    return [
      "const approval = real.openApproval({",
      "  item: \"copy + creative\",",
      "  actions: [\"approve\", \"request_changes\"],",
      "});",
      "",
      `approval.status = \"${statusLabel}\";`,
      "real.sync(approval);",
    ].join("\n");
  }

  function render(stage, outcome = currentOutcome) {
    currentStage = stage;
    currentOutcome = outcome;

    const meta = stageMeta[stage] || stageMeta.pedido;
    if (statusTitle) statusTitle.textContent = meta.title;
    if (statusText) statusText.textContent = meta.text;

    const prompt = safePrompt(input && input.value);
    if (codeEl) codeEl.textContent = codeFor(stage, prompt, outcome);

    const activeTabStage = stage === "aprovado" || stage === "ajuste" ? "aprovacao" : stage;
    for (const tab of tabs) {
      const stageId = tab.getAttribute("data-flow-stage");
      tab.classList.toggle("is-active", stageId === activeTabStage);
    }

    const activeShotStage = activeTabStage;
    for (const shot of shots) {
      const shotStage = shot.getAttribute("data-shot-stage");
      shot.classList.toggle("is-active", shotStage === activeShotStage);
    }

    if (approvalGroup) {
      approvalGroup.hidden = !meta.showApproval;
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const stage = tab.getAttribute("data-flow-stage");
      if (!stage) return;
      if (execTimer) {
        clearTimeout(execTimer);
        execTimer = null;
      }
      render(stage, "pending");
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      if (execTimer) clearTimeout(execTimer);
      render("execucao", "pending");
      execTimer = window.setTimeout(() => {
        render("aprovacao", "pending");
      }, 900);
    });
  }

  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      if (execTimer) {
        clearTimeout(execTimer);
        execTimer = null;
      }
      render("aprovado", "approved");
    });
  }

  if (reviseBtn) {
    reviseBtn.addEventListener("click", () => {
      if (execTimer) {
        clearTimeout(execTimer);
        execTimer = null;
      }
      render("ajuste", "revision");
    });
  }

  if (input) {
    input.addEventListener("input", () => {
      render(currentStage, currentOutcome);
    });
  }

  render("pedido", "pending");
})();
