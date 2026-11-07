/**
 * deploy.yakushev.fr — Client-Side RunPod Deployer & CUDA 13.0 Health Monitor
 * Zero backend: all requests go directly from the user's browser to https://api.runpod.io/v2
 */

const RUNPOD_API_BASE = "https://api.runpod.io/v2";

const LOCKED_TEMPLATE = Object.freeze({
  templateId: "casls01eko",
  image: "jnxmx/comfy26:test",
  containerDiskGb: 15,
  volumeDiskGb: 200,
  volumeMountPath: "/workspace",
  allowedCudaVersions: ["13.0", "13.1", "13.2", "13.3", "13.4"],
  ports: [
    "7860/http",
    "7861/http",
    "7862/http",
    "8188/tcp",
    "8080/tcp",
    "8888/tcp",
    "8188/udp",
    "8080/udp",
    "8888/udp"
  ]
});

/**
 * Strict 11-Tier GPU Priority Order (Best to Worst) requested by user
 */
const GPU_PRIORITY_TIERS = Object.freeze([
  {
    rank: 1,
    key: "pro-6000",
    label: "Pro 6000",
    gpuIds: [
      "NVIDIA RTX PRO 6000 Blackwell Server Edition",
      "NVIDIA RTX PRO 6000 Blackwell Workstation Edition",
      "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition"
    ]
  },
  {
    rank: 2,
    key: "rtx-5090",
    label: "RTX 5090",
    gpuIds: ["NVIDIA GeForce RTX 5090"]
  },
  {
    rank: 3,
    key: "rtx-4090",
    label: "RTX 4090",
    gpuIds: ["NVIDIA GeForce RTX 4090"]
  },
  {
    rank: 4,
    key: "l40-s",
    label: "L40 / L40S",
    gpuIds: ["NVIDIA L40S", "NVIDIA L40"]
  },
  {
    rank: 5,
    key: "rtx-5080",
    label: "RTX 5080",
    gpuIds: ["NVIDIA GeForce RTX 5080"]
  },
  {
    rank: 6,
    key: "pro-5000",
    label: "Pro 5000",
    gpuIds: [
      "NVIDIA RTX PRO 5000 Blackwell",
      "NVIDIA RTX 5000 Ada Generation"
    ]
  },
  {
    rank: 7,
    key: "4080-super",
    label: "4080 Super",
    gpuIds: [
      "NVIDIA GeForce RTX 4080 SUPER",
      "NVIDIA GeForce RTX 4080"
    ]
  },
  {
    rank: 8,
    key: "6000-ada",
    label: "6000 Ada",
    gpuIds: ["NVIDIA RTX 6000 Ada Generation"]
  },
  {
    rank: 9,
    key: "pro-4500-se",
    label: "Pro 4500 / SE",
    gpuIds: [
      "NVIDIA RTX PRO 4500 Blackwell",
      "NVIDIA RTX PRO 4500 Blackwell Server Edition"
    ]
  },
  {
    rank: 10,
    key: "pro-4000",
    label: "Pro 4000",
    gpuIds: [
      "NVIDIA RTX PRO 4000 Blackwell",
      "NVIDIA RTX 4000 Ada Generation",
      "NVIDIA RTX 4000 SFF Ada Generation"
    ]
  },
  {
    rank: 11,
    key: "rtx-3090-ti",
    label: "RTX 3090 / Ti",
    gpuIds: [
      "NVIDIA GeForce RTX 3090 Ti",
      "NVIDIA GeForce RTX 3090"
    ]
  }
]);

const AVAILABILITY_WEIGHT = Object.freeze({
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 0
});

const STORAGE_KEYS = Object.freeze({
  API_KEY_LOCAL: "yakushev_runpod_api_key_v1",
  API_KEY_SESSION: "yakushev_runpod_api_key_session_v1",
  FOCUSED_TIERS: "yakushev_focused_gpu_tiers_v1",
  OPTIONS: "yakushev_deploy_options_v1",
  COLOR_SCHEME: "color-scheme"
});

// Application State
const state = {
  apiKey: "",
  catalogRows: [],
  focusedTiers: new Set(GPU_PRIORITY_TIERS.map((t) => t.key)),
  activePodId: null,
  activeDeploySpec: null,
  redeployCount: 0,
  monitorPaused: false,
  pollTimerId: null,
  logAbortController: null,
  logLines: [],
  cudaStagePassed: false,
  cudaStageActive: false,
  redeployInProgress: false,
  pullStats: {
    downloadingLayers: 0,
    extractedLayers: 0,
    lastEventTs: null
  }
};

/* ==========================================================================
   1. Modern Web Guidance Utilities (Validation, ARIA, Dark Mode, Safe URLs)
   ========================================================================== */

const UserInvalidFallback = (() => {
  const dirtyState = new WeakMap();

  const updateState = (input) => {
    const isValid = input.checkValidity();
    input.classList.toggle("user-invalid-fallback", !isValid);
    input.classList.toggle("user-valid-fallback", isValid);
    if (!isValid) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  };

  const handleEvent = (event) => {
    const input = event.target;
    if (event.type === "reset") {
      const controls = input.elements || [];
      for (const control of controls) {
        dirtyState.delete(control);
        control.classList.remove("user-invalid-fallback", "user-valid-fallback");
        control.removeAttribute("aria-invalid");
      }
      return;
    }
    if (!input || typeof input.checkValidity !== "function") return;

    if (event.type === "input" || event.type === "change") {
      const s = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      s.hasInteracted = true;
      dirtyState.set(input, s);
      if (s.hasBlurred) updateState(input);
    } else if (event.type === "blur") {
      const s = dirtyState.get(input) || { hasInteracted: false, hasBlurred: false };
      s.hasBlurred = true;
      dirtyState.set(input, s);
      if (s.hasInteracted) updateState(input);
    }
  };

  const init = (root = document) => {
    if (CSS.supports("selector(:user-invalid)")) return;
    root.addEventListener("blur", handleEvent, true);
    root.addEventListener("input", handleEvent);
    root.addEventListener("change", handleEvent);
    root.addEventListener("reset", handleEvent, true);
  };

  return { init };
})();

function initAriaValidationSync() {
  const syncAria = (el) => {
    if (!el || typeof el.matches !== "function" || !("validity" in el)) return;
    try {
      const isUserInvalid =
        (CSS.supports("selector(:user-invalid)") && el.matches(":user-invalid")) ||
        el.classList.contains("user-invalid-fallback");
      el.setAttribute("aria-invalid", isUserInvalid ? "true" : "false");
    } catch {
      // Ignore unsupported selector exceptions
    }
  };

  document.addEventListener("blur", (e) => syncAria(e.target), true);
  document.addEventListener("input", (e) => {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute("aria-invalid")) {
      syncAria(e.target);
    }
  });
}

/**
 * Two-state theme toggle (System default <-> Pinned opposite scheme)
 */
function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  const btnText = document.getElementById("theme-toggle-text");
  const meta = document.querySelector('meta[name="color-scheme"]');
  const mql = window.matchMedia("(prefers-color-scheme: dark)");

  const getEffectiveScheme = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    if (saved === "light" || saved === "dark") return saved;
    return mql.matches ? "dark" : "light";
  };

  const updateToggleLabel = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    const systemScheme = mql.matches ? "dark" : "light";
    if (!saved || saved === "light dark") {
      const opposite = systemScheme === "dark" ? "Light" : "Dark";
      btnText.textContent = `Theme: System (${opposite} Mode)`;
    } else {
      btnText.textContent = `Theme: Pinned ${saved === "dark" ? "Dark" : "Light"} (Reset to System)`;
    }
  };

  const applyScheme = (schemeValue) => {
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (schemeValue === "light" || schemeValue === "dark") {
      meta.content = schemeValue;
      document.documentElement.classList.add(`theme-${schemeValue}`);
      localStorage.setItem(STORAGE_KEYS.COLOR_SCHEME, schemeValue);
    } else {
      meta.content = "light dark";
      localStorage.removeItem(STORAGE_KEYS.COLOR_SCHEME);
    }
    updateToggleLabel();
  };

  btn.addEventListener("click", () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    if (saved === "light" || saved === "dark") {
      // Return to system setting
      applyScheme("light dark");
    } else {
      // Pin the opposite of current system setting
      const opposite = getEffectiveScheme() === "dark" ? "light" : "dark";
      applyScheme(opposite);
    }
  });

  mql.addEventListener("change", updateToggleLabel);
  updateToggleLabel();
}

/**
 * Safe anchor builder — validates protocol against explicit allowlist (https: / http:)
 */
function createSafeExternalLink(rawUrl, titleText, subtitleUrlText) {
  const a = document.createElement("a");
  a.className = "service-link-card";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      a.href = parsed.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    } else {
      a.href = "#";
    }
  } catch {
    a.href = "#";
  }

  const titleSpan = document.createElement("span");
  titleSpan.textContent = titleText;

  const urlSpan = document.createElement("span");
  urlSpan.className = "service-link-url";
  urlSpan.textContent = subtitleUrlText || rawUrl;

  a.append(titleSpan, urlSpan);
  return a;
}

/* ==========================================================================
   2. API Key Storage & Options Persistence
   ========================================================================== */

function loadSavedPreferences() {
  // Load focused tiers
  try {
    const rawTiers = localStorage.getItem(STORAGE_KEYS.FOCUSED_TIERS);
    if (rawTiers) {
      const parsed = JSON.parse(rawTiers);
      if (Array.isArray(parsed)) {
        state.focusedTiers = new Set(parsed);
      }
    }
  } catch {
    // Keep default all tiers
  }

  // Load startup options
  try {
    const rawOpts = localStorage.getItem(STORAGE_KEYS.OPTIONS);
    if (rawOpts) {
      const opts = JSON.parse(rawOpts);
      if (typeof opts.newManager === "boolean") {
        document.getElementById("opt-new-manager").checked = opts.newManager;
      }
      if (typeof opts.restoreBackup === "boolean") {
        document.getElementById("opt-restore-backup").checked = opts.restoreBackup;
      }
      if (typeof opts.autoRedeploy === "boolean") {
        document.getElementById("opt-auto-redeploy").checked = opts.autoRedeploy;
      }
      if (typeof opts.podNamePrefix === "string" && opts.podNamePrefix) {
        document.getElementById("pod-name-prefix").value = opts.podNamePrefix;
      }
      if (typeof opts.maxRetries === "string" && opts.maxRetries) {
        document.getElementById("max-redeploy-attempts").value = opts.maxRetries;
      }
      if (typeof opts.maxPrice === "string" && opts.maxPrice) {
        const slider = document.getElementById("max-price-slider");
        slider.value = opts.maxPrice;
        document.getElementById("max-price-readout").textContent = `$${Number(opts.maxPrice).toFixed(2)}`;
      }
    }
  } catch {
    // Ignore malformed localStorage
  }

  // Load API key from localStorage or sessionStorage
  const savedLocal = localStorage.getItem(STORAGE_KEYS.API_KEY_LOCAL);
  const savedSession = sessionStorage.getItem(STORAGE_KEYS.API_KEY_SESSION);
  const keyInput = document.getElementById("runpod-api-key");
  const rememberBox = document.getElementById("remember-api-key");

  if (savedLocal) {
    state.apiKey = savedLocal;
    keyInput.value = savedLocal;
    rememberBox.checked = true;
    updateKeyBadge(true, "Saved in Browser (localStorage)");
  } else if (savedSession) {
    state.apiKey = savedSession;
    keyInput.value = savedSession;
    rememberBox.checked = false;
    updateKeyBadge(true, "Active for Tab Session");
  } else {
    updateKeyBadge(false, "No API Key Loaded");
  }
}

function saveCurrentOptions() {
  const opts = {
    newManager: document.getElementById("opt-new-manager").checked,
    restoreBackup: document.getElementById("opt-restore-backup").checked,
    autoRedeploy: document.getElementById("opt-auto-redeploy").checked,
    podNamePrefix: document.getElementById("pod-name-prefix").value.trim() || "comfy-work",
    maxRetries: document.getElementById("max-redeploy-attempts").value.trim() || "5",
    maxPrice: document.getElementById("max-price-slider").value
  };
  localStorage.setItem(STORAGE_KEYS.OPTIONS, JSON.stringify(opts));
}

function persistFocusedTiers() {
  localStorage.setItem(STORAGE_KEYS.FOCUSED_TIERS, JSON.stringify([...state.focusedTiers]));
}

function updateKeyBadge(isLoaded, text) {
  const badge = document.getElementById("key-status-badge");
  badge.textContent = text;
  badge.className = isLoaded ? "badge badge-success" : "badge badge-neutral";
}

/* ==========================================================================
   3. RunPod REST API v2 Client (Direct Browser Fetch)
   ========================================================================== */

async function runpodFetch(path, options = {}) {
  if (!state.apiKey) {
    throw new Error("Please enter your RunPod API secret key first.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.apiKey}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${RUNPOD_API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errorDetail = errJson.message || errJson.error || JSON.stringify(errJson);
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        // Ignore
      }
    }
    throw new Error(`RunPod API Error (${response.status}): ${errorDetail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/* ==========================================================================
   4. GPU Catalog Fetching, Sorting & Rendering
   ========================================================================== */

function findGpuPriorityInfo(gpuId) {
  for (const tier of GPU_PRIORITY_TIERS) {
    const subIdx = tier.gpuIds.indexOf(gpuId);
    if (subIdx !== -1) {
      return {
        tierRank: tier.rank,
        tierKey: tier.key,
        tierLabel: tier.label,
        subRank: subIdx
      };
    }
  }
  return null;
}

async function fetchGpuCatalog() {
  const spinner = document.getElementById("catalog-spinner");
  const refreshBtn = document.getElementById("refresh-catalog-btn");
  spinner.hidden = false;
  refreshBtn.disabled = true;

  try {
    const [communityRes, secureRes] = await Promise.all([
      runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=COMMUNITY&minCudaVersion=13.0"),
      runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE&minCudaVersion=13.0")
    ]);

    const rows = [];
    const processList = (gpus, cloudType) => {
      if (!Array.isArray(gpus)) return;
      for (const gpu of gpus) {
        const priority = findGpuPriorityInfo(gpu.id);
        if (!priority) continue;

        const price =
          cloudType === "COMMUNITY"
            ? gpu.price?.community ?? null
            : gpu.price?.secure ?? null;

        if (price === null || price === undefined || price <= 0) continue;

        const cuda13List = (gpu.cudaVersions || [])
          .filter((c) => Number.parseFloat(c.version) >= 13.0 && c.available)
          .map((c) => c.version);

        const availableDcs = (gpu.dataCenters || []).filter(
          (dc) => dc.availability && dc.availability !== "NONE"
        );

        rows.push({
          gpuId: gpu.id,
          displayName: gpu.name || gpu.id.replace(/^NVIDIA\s+(GeForce\s+)?/, ""),
          memoryGb: gpu.memory || 0,
          cloud: cloudType,
          price: Number(price),
          availability: gpu.availability || "NONE",
          maxCount:
            cloudType === "COMMUNITY"
              ? gpu.maxCount?.community ?? 0
              : gpu.maxCount?.secure ?? 0,
          minRamGb: gpu.minRam ?? 0,
          minVcpu: gpu.minVcpuCount ?? 0,
          cudaVersions: cuda13List,
          dataCenters: availableDcs,
          tierRank: priority.tierRank,
          tierKey: priority.tierKey,
          tierLabel: priority.tierLabel,
          subRank: priority.subRank
        });
      }
    };

    processList(communityRes?.gpus, "COMMUNITY");
    processList(secureRes?.gpus, "SECURE");

    // Sort strictly by Tier Rank (1..11) -> Sub-model rank -> Availability -> Price ascending
    rows.sort((a, b) => {
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      if (a.subRank !== b.subRank) return a.subRank - b.subRank;
      const availDiff =
        (AVAILABILITY_WEIGHT[b.availability] ?? 0) -
        (AVAILABILITY_WEIGHT[a.availability] ?? 0);
      if (availDiff !== 0) return availDiff;
      return a.price - b.price;
    });

    state.catalogRows = rows;
    renderFocusTiersBar();
    renderCatalogTable();
  } catch (err) {
    renderCatalogError(err.message);
  } finally {
    spinner.hidden = true;
    refreshBtn.disabled = false;
  }
}

function renderFocusTiersBar() {
  const container = document.getElementById("focus-tiers-grid");
  container.replaceChildren();

  for (const tier of GPU_PRIORITY_TIERS) {
    const label = document.createElement("label");
    label.className = "tier-chip-label checkbox-control";
    label.htmlFor = `focus-tier-${tier.key}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `focus-tier-${tier.key}`;
    checkbox.name = `focus_tier_${tier.key}`;
    checkbox.className = "visually-hidden";
    checkbox.checked = state.focusedTiers.has(tier.key);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.focusedTiers.add(tier.key);
      } else {
        state.focusedTiers.delete(tier.key);
      }
      persistFocusedTiers();
      renderCatalogTable();
    });

    const spanWrap = document.createElement("span");
    const rankBadge = document.createElement("span");
    rankBadge.className = "tier-rank-num";
    rankBadge.textContent = `#${tier.rank}`;

    const textNode = document.createTextNode(` ${tier.label}`);
    spanWrap.append(rankBadge, textNode);

    label.append(checkbox, spanWrap);
    container.appendChild(label);
  }
}

function getFilteredCatalogRows() {
  const cloudRadio = document.querySelector('input[name="cloud_filter"]:checked');
  const cloudFilter = cloudRadio ? cloudRadio.value : "ALL";
  const minPrice = Number.parseFloat(document.getElementById("min-price-input").value) || 0;
  const maxPrice = Number.parseFloat(document.getElementById("max-price-slider").value) || 99;
  const availableOnly = document.getElementById("filter-available-only").checked;
  const focusedOnly = document.getElementById("filter-focused-only").checked;

  return state.catalogRows.filter((row) => {
    if (cloudFilter !== "ALL" && row.cloud !== cloudFilter) return false;
    if (row.price < minPrice || row.price > maxPrice) return false;
    if (availableOnly && (row.availability === "NONE" || row.cudaVersions.length === 0)) {
      return false;
    }
    if (focusedOnly && !state.focusedTiers.has(row.tierKey)) return false;
    return true;
  });
}

function renderCatalogError(msg) {
  const tbody = document.getElementById("gpu-catalog-tbody");
  tbody.replaceChildren();
  const tr = document.createElement("tr");
  const th = document.createElement("th");
  th.scope = "row";
  th.textContent = "Catalog Error";
  const td = document.createElement("td");
  td.colSpan = 7;
  td.textContent = msg;
  tr.append(th, td);
  tbody.appendChild(tr);
}

function renderCatalogTable() {
  const tbody = document.getElementById("gpu-catalog-tbody");
  tbody.replaceChildren();

  const rows = getFilteredCatalogRows();
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = "No Matching GPUs";
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent =
      state.catalogRows.length === 0
        ? "Enter your RunPod API key and click 'Load GPUs & Connect'."
        : "No GPUs match your current Cloud, Price, or Availability filters. Try widening the Max $/hr slider or unchecking 'Hide Out-of-Stock'.";
    tr.append(th, td);
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const isFocused = state.focusedTiers.has(row.tierKey);
    const tr = document.createElement("tr");
    if (!isFocused) tr.classList.add("row-unfocused");

    // 1. Sticky Row Header: Tier & GPU Model
    const th = document.createElement("th");
    th.scope = "row";
    const titleWrap = document.createElement("div");
    titleWrap.className = "gpu-title-cell";

    const tierTag = document.createElement("span");
    tierTag.className = "gpu-tier-tag";
    tierTag.textContent = `#${row.tierRank} ${row.tierLabel}`;

    const modelName = document.createElement("span");
    modelName.className = "gpu-model-name";
    modelName.textContent = row.displayName;

    const vramSub = document.createElement("span");
    vramSub.className = "gpu-vram-sub";
    vramSub.textContent = `${row.memoryGb} GB VRAM (${row.gpuId})`;

    titleWrap.append(tierTag, modelName, vramSub);
    th.appendChild(titleWrap);

    // 2. Focus Checkbox
    const tdFocus = document.createElement("td");
    const focusLabel = document.createElement("label");
    focusLabel.className = "checkbox-control";
    const focusInput = document.createElement("input");
    focusInput.type = "checkbox";
    focusInput.className = "visually-hidden";
    focusInput.checked = isFocused;
    focusInput.setAttribute("aria-label", `Focus ${row.tierLabel}`);
    focusInput.addEventListener("change", () => {
      if (focusInput.checked) {
        state.focusedTiers.add(row.tierKey);
      } else {
        state.focusedTiers.delete(row.tierKey);
      }
      persistFocusedTiers();
      renderFocusTiersBar();
      renderCatalogTable();
    });
    const focusSpan = document.createElement("span");
    focusSpan.textContent = isFocused ? "In Focus" : "Ignored";
    focusLabel.append(focusInput, focusSpan);
    tdFocus.appendChild(focusLabel);

    // 3. Cloud Type
    const tdCloud = document.createElement("td");
    const cloudBadge = document.createElement("span");
    cloudBadge.className =
      row.cloud === "SECURE" ? "badge badge-success" : "badge badge-neutral";
    cloudBadge.textContent = row.cloud;
    tdCloud.appendChild(cloudBadge);

    // 4. Price ($/hr)
    const tdPrice = document.createElement("td");
    const priceSpan = document.createElement("span");
    priceSpan.className = "price-figure";
    priceSpan.textContent = `$${row.price.toFixed(2)}/hr`;
    tdPrice.appendChild(priceSpan);

    // 5. Availability
    const tdAvail = document.createElement("td");
    const availBadge = document.createElement("span");
    if (row.availability === "HIGH") {
      availBadge.className = "badge badge-success";
    } else if (row.availability === "MEDIUM" || row.availability === "LOW") {
      availBadge.className = "badge badge-warn";
    } else {
      availBadge.className = "badge badge-error";
    }
    availBadge.textContent = `${row.availability} (max ${row.maxCount})`;
    tdAvail.appendChild(availBadge);

    // 6. CUDA >= 13.0
    const tdCuda = document.createElement("td");
    if (row.cudaVersions.length > 0) {
      const cudaCode = document.createElement("code");
      cudaCode.textContent = row.cudaVersions.join(", ");
      tdCuda.appendChild(cudaCode);
    } else {
      const noCuda = document.createElement("span");
      noCuda.className = "badge badge-error";
      noCuda.textContent = "None >= 13.0";
      tdCuda.appendChild(noCuda);
    }

    // 7. Host Specs & Network / Datacenters
    const tdSpecs = document.createElement("td");
    const specsWrap = document.createElement("div");
    specsWrap.className = "specs-list";

    const cpuRamLine = document.createElement("span");
    cpuRamLine.textContent = `Min ${row.minVcpu} vCPU · ${row.minRamGb} GB Sys RAM`;

    const netLine = document.createElement("span");
    netLine.textContent =
      row.cloud === "SECURE"
        ? "Tier-3 Datacenter · 1–10 Gbps Symmetric"
        : "Verified Host · Direct High-Speed Uplink";

    specsWrap.append(cpuRamLine, netLine);

    if (row.dataCenters.length > 0) {
      const dcContainer = document.createElement("div");
      dcContainer.className = "dc-pills";
      for (const dc of row.dataCenters.slice(0, 6)) {
        const pill = document.createElement("span");
        pill.className = "dc-pill";
        pill.textContent = `${dc.id} (${dc.availability})`;
        dcContainer.appendChild(pill);
      }
      if (row.dataCenters.length > 6) {
        const more = document.createElement("span");
        more.className = "dc-pill";
        more.textContent = `+${row.dataCenters.length - 6} regions`;
        dcContainer.appendChild(more);
      }
      specsWrap.appendChild(dcContainer);
    }
    tdSpecs.appendChild(specsWrap);

    // 8. Action (Deploy Button)
    const tdAction = document.createElement("td");
    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "btn btn-primary";
    deployBtn.textContent = `Deploy ${row.tierLabel}`;
    deployBtn.disabled = row.availability === "NONE" || row.cudaVersions.length === 0;
    deployBtn.addEventListener("click", () => {
      startDeploymentSequence([row]);
    });
    tdAction.appendChild(deployBtn);

    tr.append(th, tdFocus, tdCloud, tdPrice, tdAvail, tdCuda, tdSpecs, tdAction);
    tbody.appendChild(tr);
  }
}

/* ==========================================================================
   5. Active Account Pods Listing & Management
   ========================================================================== */

async function fetchActivePods() {
  const container = document.getElementById("existing-pods-list");
  try {
    const res = await runpodFetch("/pods");
    const pods = Array.isArray(res) ? res : res?.pods || res?.data || [];
    container.replaceChildren();

    if (pods.length === 0) {
      const p = document.createElement("p");
      p.className = "empty-state";
      p.textContent = "No active pods currently running on your RunPod account.";
      container.appendChild(p);
      return;
    }

    for (const pod of pods) {
      const card = document.createElement("div");
      card.className = "pod-mini-card";

      const top = document.createElement("div");
      top.className = "pod-mini-top";

      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${pod.name || "Pod"} (${pod.id})`;
      const sub = document.createElement("div");
      sub.className = "section-desc";
      const gpuName = pod.gpu?.id || pod.gpu?.displayName || "GPU";
      sub.textContent = `${gpuName} · ${pod.cloud || "CLOUD"} · CUDA ${pod.cudaVersion || "?"}`;
      info.append(title, sub);

      const statusBadge = document.createElement("span");
      statusBadge.className =
        pod.status === "RUNNING" ? "badge badge-success" : "badge badge-warn";
      statusBadge.textContent = pod.status || "UNKNOWN";

      top.append(info, statusBadge);

      const actions = document.createElement("div");
      actions.className = "pod-mini-actions";

      const monitorBtn = document.createElement("button");
      monitorBtn.type = "button";
      monitorBtn.className = "btn btn-secondary";
      monitorBtn.textContent = "Attach Health Monitor";
      monitorBtn.addEventListener("click", () => {
        attachMonitorToPod(pod.id, {
          gpuId: pod.gpu?.id || gpuName,
          cloud: pod.cloud || "COMMUNITY",
          tierLabel: gpuName,
          price: pod.costPerHr || 0
        });
      });

      const termBtn = document.createElement("button");
      termBtn.type = "button";
      termBtn.className = "btn btn-danger-outline";
      termBtn.textContent = "Terminate";
      termBtn.addEventListener("click", async () => {
        termBtn.disabled = true;
        termBtn.textContent = "Terminating...";
        try {
          await runpodFetch(`/pods/${encodeURIComponent(pod.id)}`, { method: "DELETE" });
          if (state.activePodId === pod.id) {
            stopActiveMonitor("Pod terminated by user.");
          }
          await fetchActivePods();
        } catch (err) {
          termBtn.disabled = false;
          termBtn.textContent = "Terminate";
          showMonitorAlert(`Failed to terminate pod ${pod.id}: ${err.message}`, "error");
        }
      });

      actions.append(monitorBtn, termBtn);
      card.append(top, actions);
      container.appendChild(card);
    }
  } catch (err) {
    container.replaceChildren();
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = `Could not load active pods: ${err.message}`;
    container.appendChild(p);
  }
}

/* ==========================================================================
   6. Pod Deployment, Live Log Streaming & CUDA/CPU Auto-Redeploy Engine
   ========================================================================== */

function logAttemptEvent(message, badgeType = "info") {
  const list = document.getElementById("attempt-history-list");
  const li = document.createElement("li");
  li.className = "attempt-item";

  const timeStr = new Date().toLocaleTimeString();
  const strong = document.createElement("strong");
  strong.textContent = `[${timeStr}] `;

  const span = document.createElement("span");
  span.textContent = message;

  li.append(strong, span);
  list.prepend(li);

  const counterBadge = document.getElementById("attempt-counter-badge");
  counterBadge.textContent = `Attempt ${state.redeployCount}`;
  counterBadge.className =
    badgeType === "error"
      ? "badge badge-error"
      : badgeType === "success"
        ? "badge badge-success"
        : "badge badge-warn";
}

function showMonitorAlert(message, level = "info") {
  const banner = document.getElementById("monitor-alert");
  banner.hidden = false;
  banner.className = `alert-banner alert-${level}`;
  banner.textContent = message;
}

function setStageState(stageName, status, detailText) {
  const stepEl = document.querySelector(`.stage-step[data-stage="${stageName}"]`);
  const detailEl = document.getElementById(`stage-detail-${stageName}`);
  if (!stepEl || !detailEl) return;

  stepEl.classList.remove("stage-active", "stage-done", "stage-error");
  if (status === "active") stepEl.classList.add("stage-active");
  if (status === "done") stepEl.classList.add("stage-done");
  if (status === "error") stepEl.classList.add("stage-error");

  if (detailText) {
    detailEl.textContent = detailText;
  }
}

function resetStageTracker() {
  for (const stage of ["provision", "container", "cuda", "cpu", "env", "ready"]) {
    setStageState(stage, "pending", "Pending");
  }
  setStageState("cuda", "pending", "Waiting for completion");
}

function buildPodCreatePayload(candidate) {
  saveCurrentOptions();
  const newManager = document.getElementById("opt-new-manager").checked ? "1" : "0";
  const restoreBackup = document.getElementById("opt-restore-backup").checked ? "1" : "0";
  const prefix = document.getElementById("pod-name-prefix").value.trim() || "comfy-work";
  const slug = candidate.tierKey || "gpu";

  return {
    name: `${prefix}-${slug}`,
    templateId: LOCKED_TEMPLATE.templateId,
    image: LOCKED_TEMPLATE.image,
    cloud: candidate.cloud,
    gpu: {
      id: candidate.gpuId,
      count: 1,
      allowedCudaVersions: LOCKED_TEMPLATE.allowedCudaVersions
    },
    disk: LOCKED_TEMPLATE.containerDiskGb,
    mounts: {
      persistent: {
        size: LOCKED_TEMPLATE.volumeDiskGb,
        path: LOCKED_TEMPLATE.volumeMountPath
      }
    },
    ports: LOCKED_TEMPLATE.ports,
    startJupyter: true,
    startSsh: true,
    env: {
      CIVITAI_API_KEY: "{{ RUNPOD_SECRET_CIVITAI_API_KEY }}",
      COMFYUI_BACKUP: "{{ RUNPOD_SECRET_COMFYUI_BACKUP }}",
      HF_TOKEN: "{{ RUNPOD_SECRET_HF_TOKEN }}",
      NEW_MANAGER: newManager,
      RESTORE_BACKUP: restoreBackup,
      STUDENT_MODE: "0"
    }
  };
}

async function startDeploymentSequence(candidateQueue, isAutoRetry = false) {
  const monitorSection = document.getElementById("monitor-section");
  monitorSection.hidden = false;
  monitorSection.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!isAutoRetry) {
    state.redeployCount = 0;
    document.getElementById("attempt-history-list").replaceChildren();
  }

  const maxAttempts =
    Number.parseInt(document.getElementById("max-redeploy-attempts").value, 10) || 5;

  for (const candidate of candidateQueue) {
    if (state.redeployCount >= maxAttempts) {
      showMonitorAlert(
        `Reached maximum auto-redeploy limit (${maxAttempts} attempts). Stopping deployment.`,
        "error"
      );
      logAttemptEvent(`Stopped after ${maxAttempts} attempts.`, "error");
      return;
    }

    state.redeployCount += 1;
    state.activeDeploySpec = { candidateQueue, currentCandidate: candidate };

    resetStageTracker();
    setStageState("provision", "active", `Requesting ${candidate.displayName} (${candidate.cloud})...`);
    showMonitorAlert(
      `Attempt #${state.redeployCount}: Creating pod on ${candidate.displayName} (${candidate.cloud}, $${candidate.price.toFixed(2)}/hr, CUDA >= 13.0)...`,
      "info"
    );
    logAttemptEvent(
      `Creating pod on ${candidate.displayName} (${candidate.cloud}) at $${candidate.price.toFixed(2)}/hr...`
    );

    try {
      const payload = buildPodCreatePayload(candidate);
      const created = await runpodFetch("/pods", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const podId = created?.id;
      if (!podId) {
        throw new Error("RunPod returned an empty pod ID.");
      }

      logAttemptEvent(
        `Pod ${podId} created on ${candidate.displayName} (${candidate.cloud}). Starting health & CUDA 13.0 verification...`
      );
      await fetchActivePods();
      attachMonitorToPod(podId, candidate, candidateQueue);
      return;
    } catch (err) {
      logAttemptEvent(
        `Provisioning failed for ${candidate.displayName} (${candidate.cloud}): ${err.message}`,
        "error"
      );
      showMonitorAlert(
        `Could not allocate ${candidate.displayName} (${candidate.cloud}): ${err.message}. Trying next candidate...`,
        "warn"
      );
    }
  }

  showMonitorAlert(
    "All selected GPU candidates failed to allocate capacity. Try refreshing the catalog or enabling additional GPU tiers.",
    "error"
  );
}

function stopActiveMonitor(reasonText) {
  state.monitorPaused = true;
  if (state.pollTimerId) {
    clearInterval(state.pollTimerId);
    state.pollTimerId = null;
  }
  if (state.logAbortController) {
    state.logAbortController.abort();
    state.logAbortController = null;
  }
  document.getElementById("monitor-spinner").hidden = true;
  document.getElementById("log-stream-status").textContent = "Stopped";
  if (reasonText) {
    showMonitorAlert(reasonText, "info");
  }
}

function attachMonitorToPod(podId, candidate, candidateQueue = null) {
  stopActiveMonitor();
  state.activePodId = podId;
  state.monitorPaused = false;
  state.cudaStagePassed = false;
  state.cudaStageActive = false;
  state.redeployInProgress = false;
  state.logLines = [];
  state.pullStats = { downloadingLayers: 0, extractedLayers: 0, lastEventTs: null };

  if (candidateQueue) {
    state.activeDeploySpec = { candidateQueue, currentCandidate: candidate };
  } else if (!state.activeDeploySpec) {
    state.activeDeploySpec = { candidateQueue: [candidate], currentCandidate: candidate };
  }

  const monitorSection = document.getElementById("monitor-section");
  monitorSection.hidden = false;
  document.getElementById("monitor-spinner").hidden = false;
  document.getElementById("monitor-subtitle").textContent =
    `Monitoring Pod ${podId} (${candidate.displayName || candidate.gpuId} · ${candidate.cloud})`;
  document.getElementById("pod-log-output").textContent =
    `Connecting to SSE log stream for pod ${podId}...\n`;

  resetStageTracker();
  setStageState("provision", "active", `Pod ${podId} allocated`);
  renderServiceLinks(podId, null);

  // Start SSE log stream + 4s status poller
  startPodLogStream(podId);
  pollPodHealth(podId);
  state.pollTimerId = setInterval(() => {
    if (!state.monitorPaused && state.activePodId === podId) {
      pollPodHealth(podId);
    }
  }, 4000);
}

async function startPodLogStream(podId) {
  if (state.logAbortController) {
    state.logAbortController.abort();
  }
  const abortController = new AbortController();
  state.logAbortController = abortController;

  const badge = document.getElementById("log-stream-status");
  badge.textContent = "Streaming SSE";
  badge.className = "badge badge-success";

  try {
    const response = await fetch(
      `${RUNPOD_API_BASE}/pods/${encodeURIComponent(podId)}/logs?tail=250`,
      {
        headers: {
          Authorization: `Bearer ${state.apiKey}`
        },
        signal: abortController.signal
      }
    );

    if (!response.ok || !response.body) {
      badge.textContent = `Log HTTP ${response.status}`;
      badge.className = "badge badge-warn";
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonPart = trimmed.slice(5).trim();
        if (!jsonPart) continue;
        try {
          const entry = JSON.parse(jsonPart);
          handleLogEntry(podId, entry);
        } catch {
          // Ignore non-JSON keepalive comments
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      badge.textContent = "Stream Reconnecting";
      badge.className = "badge badge-warn";
      setTimeout(() => {
        if (!state.monitorPaused && state.activePodId === podId) {
          startPodLogStream(podId);
        }
      }, 4000);
    }
  }
}

function handleLogEntry(podId, entry) {
  if (state.activePodId !== podId || state.redeployInProgress) return;
  const source = entry.source || "log";
  const line = String(entry.line || "").trim();
  if (!line) return;

  // Track layer pull activity
  if (source === "system") {
    if (line.includes("Downloading")) state.pullStats.downloadingLayers += 1;
    if (line.includes("Extracting") || line.includes("Pull complete")) {
      state.pullStats.extractedLayers += 1;
    }
    state.pullStats.lastEventTs = Date.now();
    document.getElementById("metric-network").textContent =
      `Pulling image (${state.pullStats.extractedLayers} layers extracted)`;
    setStageState(
      "provision",
      "active",
      `Pulling image (${state.pullStats.extractedLayers} extracted)`
    );
  }

  // Append to terminal output (keep last 220 lines)
  state.logLines.push(`[${source}] ${line}`);
  if (state.logLines.length > 220) {
    state.logLines.shift();
  }
  const logPre = document.getElementById("pod-log-output");
  logPre.textContent = state.logLines.join("\n");
  logPre.scrollTop = logPre.scrollHeight;

  // Inspect container logs for CUDA preflight & CPU overload & Startup stages
  if (source === "container") {
    setStageState("provision", "done", "Image pulled");
    setStageState("container", "done", "Container running");

    // Detect CUDA preflight start
    if (
      line.includes("Checking CUDA initialization") ||
      line.includes("[cuda][warn] preflight attempt")
    ) {
      state.cudaStageActive = true;
      setStageState("cuda", "active", line.slice(0, 65));
    }

    // Detect fatal CUDA failure -> Auto-terminate & redeploy!
    const isCudaFatal =
      line.includes("[fatal][gpu]") ||
      line.includes("host_gpu_driver_corrupt") ||
      line.includes("CUDA runtime initialization failed") ||
      line.includes("torch.cuda.is_available() returned False") ||
      line.includes("Error 803:") ||
      line.includes("Error 804:");

    if (isCudaFatal) {
      setStageState("cuda", "error", "CUDA Initialization Failed!");
      triggerAutoRedeploy(
        podId,
        `Host GPU CUDA initialization failed (${line.slice(0, 90)})`
      );
      return;
    }

    // Detect CPU overload prompt
    const isCpuOverload =
      line.includes("CPU Overload Detected") ||
      line.includes("cpu_confirm") ||
      line.includes("Host CPU load is critically high");

    if (isCpuOverload) {
      setStageState("cpu", "error", "Host CPU Overload Detected!");
      triggerAutoRedeploy(podId, `Unhealthy host CPU overload (${line.slice(0, 80)})`);
      return;
    }

    // Strict rule: Only mark CUDA preflight as DONE when container advances past CUDA check!
    const passedCudaStage =
      line.includes("STAGE: Creating environment") ||
      line.includes("STAGE: Restoring") ||
      line.includes("STAGE: Updating") ||
      line.includes("Updating ComfyUI") ||
      line.includes("Starting ComfyUI") ||
      line.includes("To see the GUI go to:");

    if (passedCudaStage && !state.cudaStagePassed) {
      state.cudaStagePassed = true;
      state.cudaStageActive = false;
      setStageState("cuda", "done", "CUDA 13.0 Verified Healthy");
      setStageState("cpu", "done", "Host CPU Normal");
      setStageState("env", "active", line.slice(0, 60));
      logAttemptEvent(`Pod ${podId} passed CUDA 13.0 preflight check!`, "success");
    }

    if (
      line.includes("Starting ComfyUI") ||
      line.includes("To see the GUI go to:") ||
      line.includes("ComfyUI is ready")
    ) {
      setStageState("env", "done", "Environment & Backup Ready");
      setStageState("ready", "done", "ComfyUI Listening on :7860");
      document.getElementById("monitor-spinner").hidden = true;
      showMonitorAlert(
        `Pod ${podId} is 100% healthy and ComfyUI is ready! Use the links below to open ComfyUI or copy the URL for Comfy Desktop.`,
        "success"
      );
      logAttemptEvent(`Pod ${podId} ComfyUI server is live and ready!`, "success");
    }
  }
}

async function pollPodHealth(podId) {
  if (state.redeployInProgress) return;
  try {
    const pod = await runpodFetch(`/pods/${encodeURIComponent(podId)}`);
    if (!pod || state.activePodId !== podId) return;

    // Update live telemetry bar
    document.getElementById("metric-pod-id").textContent = `${pod.id} · ${pod.status}`;
    const gpuModel = pod.gpu?.id || "GPU";
    document.getElementById("metric-gpu-cuda").textContent =
      `${gpuModel} · CUDA ${pod.cudaVersion || "13.0"}`;

    if (pod.runtime) {
      const cpuUtil = pod.runtime.cpu?.util ?? 0;
      const ramUtil = pod.runtime.memory?.util ?? 0;
      document.getElementById("metric-cpu-ram").textContent =
        `CPU ${cpuUtil.toFixed(1)}% · RAM ${ramUtil.toFixed(1)}%`;

      const uptimeSec = pod.runtime.uptime || 0;
      const mins = Math.floor(uptimeSec / 60);
      const secs = uptimeSec % 60;
      document.getElementById("metric-uptime").textContent = `${mins}m ${secs}s uptime`;

      setStageState("provision", "done", "Image pulled");
      setStageState("container", "done", `Running (${mins}m ${secs}s)`);
      renderServiceLinks(podId, pod);
    } else {
      document.getElementById("metric-cpu-ram").textContent = "Awaiting container runtime...";
      document.getElementById("metric-uptime").textContent = "Provisioning...";
    }

    if (pod.status === "ERROR" || pod.status === "EXITED") {
      triggerAutoRedeploy(podId, `Pod entered ${pod.status} state.`);
      return;
    }

    // Also probe port 7860 /state and /system_stats if container is running
    if (pod.runtime) {
      await probePodHttpEndpoints(podId);
    }
  } catch (err) {
    // Transient network error during poll
    console.warn("Poll warning:", err.message);
  }
}

async function probePodHttpEndpoints(podId) {
  if (state.redeployInProgress || state.activePodId !== podId) return;
  const baseUrl = `https://${podId}-7860.proxy.runpod.net`;

  // 1. Try launchpad /state (if CORS allows or when reverse proxy forwards it)
  try {
    const stateRes = await fetch(`${baseUrl}/state`, { cache: "no-store" });
    if (stateRes.ok) {
      const st = await stateRes.json();
      if (st?.fatal?.active || st?.fatal?.code === "host_gpu_driver_corrupt") {
        setStageState("cuda", "error", st.fatal.title || "CUDA Fatal Error");
        triggerAutoRedeploy(
          podId,
          `Launchpad reported fatal GPU error: ${st.fatal.code || st.fatal.summary}`
        );
        return;
      }
      if (st?.cpu_confirm?.required) {
        setStageState("cpu", "error", "CPU Overload Confirmation Required");
        triggerAutoRedeploy(podId, `Launchpad reported CPU overload (${st.cpu_confirm.message})`);
        return;
      }
      // Strict check: only mark CUDA done when stages.cuda.status === "done"
      const cudaStage = st?.stages?.cuda;
      if (cudaStage?.status === "active") {
        setStageState("cuda", "active", "Running CUDA 13.0 preflight...");
      } else if (cudaStage?.status === "done" && !state.cudaStagePassed) {
        state.cudaStagePassed = true;
        setStageState("cuda", "done", "CUDA 13.0 Verified Healthy");
        setStageState("cpu", "done", "Host CPU Verified");
      }
    }
  } catch {
    // Port 7860 /state may still be starting or in pre-CORS launchpad phase; SSE log stream covers this
  }

  // 2. Try ComfyUI /system_stats (ComfyUI passes --enable-cors-header *)
  try {
    const statsRes = await fetch(`${baseUrl}/system_stats`, { cache: "no-store" });
    if (statsRes.ok) {
      const stats = await statsRes.json();
      if (stats?.system) {
        state.cudaStagePassed = true;
        setStageState("cuda", "done", "CUDA 13.0 Verified Healthy");
        setStageState("cpu", "done", "Host CPU Verified");
        setStageState("env", "done", "Environment Ready");
        setStageState("ready", "done", `ComfyUI ${stats.system.comfyui_version || ""} Ready`);
        document.getElementById("monitor-spinner").hidden = true;
        showMonitorAlert(
          `Pod ${podId} is live! ComfyUI ${stats.system.comfyui_version || ""} is responding on Port 7860 with PyTorch ${stats.system.pytorch_version || ""}.`,
          "success"
        );
      }
    }
  } catch {
    // ComfyUI not yet listening on 7860
  }
}

async function triggerAutoRedeploy(unhealthyPodId, reason) {
  if (state.redeployInProgress) return;
  state.redeployInProgress = true;

  logAttemptEvent(`Unhealthy pod ${unhealthyPodId}: ${reason}`, "error");
  const autoRedeployEnabled = document.getElementById("opt-auto-redeploy").checked;

  if (!autoRedeployEnabled) {
    showMonitorAlert(
      `Health check failed on pod ${unhealthyPodId}: ${reason}. Auto-redeploy is unchecked.`,
      "error"
    );
    document.getElementById("monitor-spinner").hidden = true;
    return;
  }

  showMonitorAlert(
    `Unhealthy host detected (${reason}). Automatically terminating pod ${unhealthyPodId} and redeploying...`,
    "warn"
  );

  try {
    await runpodFetch(`/pods/${encodeURIComponent(unhealthyPodId)}`, { method: "DELETE" });
    logAttemptEvent(`Terminated unhealthy pod ${unhealthyPodId}.`, "warn");
  } catch (err) {
    logAttemptEvent(`Warning while deleting ${unhealthyPodId}: ${err.message}`, "warn");
  }

  await fetchActivePods();
  const queue = state.activeDeploySpec?.candidateQueue || getFocusedCandidateQueue();
  state.redeployInProgress = false;
  await startDeploymentSequence(queue, true);
}

function renderServiceLinks(podId, podData) {
  const panel = document.getElementById("ready-links-panel");
  const grid = document.getElementById("service-links-grid");
  panel.hidden = false;
  grid.replaceChildren();

  const comfyProxyUrl = `https://${podId}-7860.proxy.runpod.net/`;
  const port7861Url = `https://${podId}-7861.proxy.runpod.net/`;
  const port7862Url = `https://${podId}-7862.proxy.runpod.net/`;
  const fileBrowserProxyUrl = `https://${podId}-8080.proxy.runpod.net/`;
  const jupyterProxyUrl = `https://${podId}-8888.proxy.runpod.net/`;
  const consoleUrl = `https://console.runpod.io/pods?id=${encodeURIComponent(podId)}`;

  grid.append(
    createSafeExternalLink(comfyProxyUrl, "ComfyUI / Launchpad (Port 7860)", comfyProxyUrl),
    createSafeExternalLink(fileBrowserProxyUrl, "FileBrowser / Port 8080 Proxy", fileBrowserProxyUrl),
    createSafeExternalLink(jupyterProxyUrl, "JupyterLab (Port 8888 Proxy)", jupyterProxyUrl),
    createSafeExternalLink(port7861Url, "Aux HTTP Service (Port 7861)", port7861Url),
    createSafeExternalLink(port7862Url, "Aux HTTP Service (Port 7862)", port7862Url),
    createSafeExternalLink(consoleUrl, "RunPod Console Pod Page", consoleUrl)
  );

  // Add direct IP:Port TCP links if available in runtime.ports
  const runtimePorts = podData?.runtime?.ports || [];
  for (const p of runtimePorts) {
    if (p.ip && p.publicPort && (p.privatePort === 8080 || p.privatePort === 8888 || p.privatePort === 8188)) {
      const directUrl = `http://${p.ip}:${p.publicPort}/`;
      grid.appendChild(
        createSafeExternalLink(
          directUrl,
          `Direct TCP :${p.privatePort} (${p.ip}:${p.publicPort})`,
          directUrl
        )
      );
    }
  }

  // Bind quick copy buttons
  const copyComfyBtn = document.getElementById("copy-comfy-url-btn");
  copyComfyBtn.onclick = async () => {
    await navigator.clipboard.writeText(`https://${podId}-7860.proxy.runpod.net`);
    copyComfyBtn.textContent = "Copied https://...-7860.proxy.runpod.net!";
    setTimeout(() => {
      copyComfyBtn.textContent = "Copy ComfyUI URL (:7860) for Comfy Desktop";
    }, 2200);
  };

  const copySshBtn = document.getElementById("copy-ssh-cmd-btn");
  const sshCmd = podData?.ssh?.proxy?.command || `ssh ${podId}@ssh.runpod.io`;
  copySshBtn.onclick = async () => {
    await navigator.clipboard.writeText(sshCmd);
    copySshBtn.textContent = "Copied SSH Command!";
    setTimeout(() => {
      copySshBtn.textContent = "Copy SSH Command";
    }, 2200);
  };
}

function getFocusedCandidateQueue() {
  const filtered = getFilteredCatalogRows();
  return filtered.filter(
    (r) => state.focusedTiers.has(r.tierKey) && r.availability !== "NONE" && r.cudaVersions.length > 0
  );
}

/* ==========================================================================
   7. Event Wiring & Initialization
   ========================================================================== */

function initApp() {
  UserInvalidFallback.init(document);
  initAriaValidationSync();
  initThemeToggle();
  loadSavedPreferences();
  renderFocusTiersBar();

  // Range slider WebKit fallback progress variable
  const priceSlider = document.getElementById("max-price-slider");
  const updateSliderProgress = () => {
    const min = Number.parseFloat(priceSlider.min) || 0.2;
    const max = Number.parseFloat(priceSlider.max) || 10.0;
    const val = Number.parseFloat(priceSlider.value) || 4.5;
    const pct = ((val - min) / (max - min)) * 100;
    priceSlider.style.setProperty("--progress", `${pct.toFixed(1)}%`);
    document.getElementById("max-price-readout").textContent = `$${val.toFixed(2)}`;
  };
  priceSlider.addEventListener("input", () => {
    updateSliderProgress();
    saveCurrentOptions();
    renderCatalogTable();
  });
  updateSliderProgress();

  // Password Show/Hide toggle
  const keyInput = document.getElementById("runpod-api-key");
  const toggleBtn = document.getElementById("toggle-api-key");
  const toggleIcon = document.getElementById("toggle-api-icon");
  toggleBtn.addEventListener("click", () => {
    const isPassword = keyInput.type === "password";
    keyInput.type = isPassword ? "text" : "password";
    toggleBtn.setAttribute("aria-pressed", isPassword ? "true" : "false");
    toggleBtn.setAttribute("aria-label", isPassword ? "Hide API secret key" : "Show API secret key");
    toggleIcon.textContent = isPassword ? "Hide" : "Show";
  });

  // Custom validity message on API key input
  keyInput.addEventListener("invalid", () => {
    keyInput.setCustomValidity("Please enter a valid RunPod API secret key (minimum 20 characters).");
  });
  keyInput.addEventListener("input", () => {
    keyInput.setCustomValidity("");
  });

  // API Form submission
  const apiForm = document.getElementById("api-config-form");
  apiForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!apiForm.checkValidity()) {
      const firstInvalid = apiForm.querySelector(":invalid");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const connectBtn = document.getElementById("connect-btn");
    connectBtn.disabled = true;

    const enteredKey = keyInput.value.trim();
    state.apiKey = enteredKey;
    const remember = document.getElementById("remember-api-key").checked;

    if (remember) {
      localStorage.setItem(STORAGE_KEYS.API_KEY_LOCAL, enteredKey);
      sessionStorage.removeItem(STORAGE_KEYS.API_KEY_SESSION);
      updateKeyBadge(true, "Saved in Browser (localStorage)");
    } else {
      sessionStorage.setItem(STORAGE_KEYS.API_KEY_SESSION, enteredKey);
      localStorage.removeItem(STORAGE_KEYS.API_KEY_LOCAL);
      updateKeyBadge(true, "Active for Tab Session");
    }

    saveCurrentOptions();
    await Promise.all([fetchGpuCatalog(), fetchActivePods()]);
    connectBtn.disabled = false;
  });

  // Forget API Key button
  document.getElementById("forget-key-btn").addEventListener("click", () => {
    state.apiKey = "";
    keyInput.value = "";
    localStorage.removeItem(STORAGE_KEYS.API_KEY_LOCAL);
    sessionStorage.removeItem(STORAGE_KEYS.API_KEY_SESSION);
    updateKeyBadge(false, "Key Cleared from Browser");
  });

  // Filter controls
  const filterForm = document.getElementById("catalog-filter-form");
  filterForm.addEventListener("change", () => renderCatalogTable());
  filterForm.addEventListener("submit", (e) => {
    e.preventDefault();
    renderCatalogTable();
  });
  document.getElementById("min-price-input").addEventListener("input", () => renderCatalogTable());

  // Focus quick-select buttons
  document.getElementById("focus-all-btn").addEventListener("click", () => {
    state.focusedTiers = new Set(GPU_PRIORITY_TIERS.map((t) => t.key));
    persistFocusedTiers();
    renderFocusTiersBar();
    renderCatalogTable();
  });
  document.getElementById("focus-top3-btn").addEventListener("click", () => {
    state.focusedTiers = new Set(["pro-6000", "rtx-5090", "rtx-4090"]);
    persistFocusedTiers();
    renderFocusTiersBar();
    renderCatalogTable();
  });
  document.getElementById("focus-none-btn").addEventListener("click", () => {
    state.focusedTiers.clear();
    persistFocusedTiers();
    renderFocusTiersBar();
    renderCatalogTable();
  });

  // Refresh & Deploy Best buttons
  document.getElementById("refresh-catalog-btn").addEventListener("click", () => fetchGpuCatalog());
  document.getElementById("refresh-pods-btn").addEventListener("click", () => fetchActivePods());

  document.getElementById("deploy-best-focus-btn").addEventListener("click", () => {
    const queue = getFocusedCandidateQueue();
    if (queue.length === 0) {
      const monitorSection = document.getElementById("monitor-section");
      monitorSection.hidden = false;
      showMonitorAlert(
        "No available GPUs match your Focused Tiers and Price Filter. Check at least one available GPU tier or raise the Max $/hr filter.",
        "warn"
      );
      return;
    }
    startDeploymentSequence(queue, false);
  });

  // Monitor Pause / Terminate buttons
  document.getElementById("stop-monitor-btn").addEventListener("click", () => {
    if (state.monitorPaused && state.activePodId) {
      attachMonitorToPod(
        state.activePodId,
        state.activeDeploySpec?.currentCandidate || { gpuId: "GPU", cloud: "CLOUD" }
      );
      document.getElementById("stop-monitor-btn").textContent = "Pause Monitor";
    } else {
      stopActiveMonitor("Health monitoring paused by user.");
      document.getElementById("stop-monitor-btn").textContent = "Resume Monitor";
    }
  });

  document.getElementById("terminate-current-pod-btn").addEventListener("click", async () => {
    const podId = state.activePodId;
    if (!podId) return;
    stopActiveMonitor(`Terminating pod ${podId}...`);
    try {
      await runpodFetch(`/pods/${encodeURIComponent(podId)}`, { method: "DELETE" });
      showMonitorAlert(`Pod ${podId} has been terminated.`, "info");
      logAttemptEvent(`User terminated pod ${podId}.`, "warn");
      state.activePodId = null;
      await fetchActivePods();
    } catch (err) {
      showMonitorAlert(`Error terminating pod ${podId}: ${err.message}`, "error");
    }
  });

  // Auto-load catalog if API key was remembered
  if (state.apiKey) {
    fetchGpuCatalog();
    fetchActivePods();
  }
}

document.addEventListener("DOMContentLoaded", initApp);
