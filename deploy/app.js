/**
 * course.yakushev.fr/deploy — Minimalist RunPod Deployer & CUDA 13.0 Monitor
 * Zero-backend: Direct browser fetch to https://api.runpod.io/v2
 */

const RUNPOD_API_BASE = "https://api.runpod.io/v2";
const CATALOG_AUTO_REFRESH_MS = 12000;

const DEFAULT_TEMPLATE = Object.freeze({
  templateId: "casls01eko",
  name: "comfy.work CUDA 13.0 with New Manager",
  image: "jnxmx/comfy26:test",
  containerDiskGb: 15,
  volumeDiskGb: 200,
  volumeMountPath: "/workspace",
  allowedCudaVersions: ["13.0", "13.1", "13.2", "13.3", "13.4"],
  ports: [
    "7860/http", "7861/http", "7862/http",
    "8188/tcp", "8080/tcp", "8888/tcp"
  ]
});

/**
 * GPU Priority Ranking (Best to Worst):
 * 1. Pro 6000
 * 2. RTX 5090
 * 3. RTX 4090
 * 4. L40 / L40S
 * 5. RTX 5080 (Включительно по умолчанию)
 * 6. Pro 5000 Blackwell
 * 7. 4080 Super / 4080
 * 8. 6000 Ada
 * 9. Pro 4500 / SE
 * 10. Pro 4000
 * 11. 5000 Ada (ниже чем pro 4000)
 * 12. RTX A6000 (выше чем 3090)
 * 13. RTX 3090 / Ti
 * 14. RTX 3080 Ti / 3080 (выше 3070)
 * 15. RTX 3070
 * 99. Все остальные видеокарты с CUDA >= 13.0
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
    label: "Pro 5000 Blackwell",
    gpuIds: ["NVIDIA RTX PRO 5000 Blackwell"]
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
    key: "5000-ada",
    label: "5000 Ada",
    gpuIds: ["NVIDIA RTX 5000 Ada Generation"]
  },
  {
    rank: 12,
    key: "rtx-a6000",
    label: "RTX A6000",
    gpuIds: ["NVIDIA RTX A6000"]
  },
  {
    rank: 13,
    key: "rtx-3090-ti",
    label: "RTX 3090 / Ti",
    gpuIds: [
      "NVIDIA GeForce RTX 3090 Ti",
      "NVIDIA GeForce RTX 3090"
    ]
  },
  {
    rank: 14,
    key: "rtx-3080-ti",
    label: "RTX 3080 Ti / 3080",
    gpuIds: [
      "NVIDIA GeForce RTX 3080 Ti",
      "NVIDIA GeForce RTX 3080"
    ]
  },
  {
    rank: 15,
    key: "rtx-3070",
    label: "RTX 3070",
    gpuIds: [
      "NVIDIA GeForce RTX 3070",
      "NVIDIA GeForce RTX 4070 Ti"
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
  API_KEY: "yakushev_runpod_api_key_v1",
  SELECTED_ROWS: "yakushev_selected_gpus_v3",
  SECURE_ONLY: "yakushev_secure_only_v1",
  MAX_PRICE: "yakushev_max_price_v3",
  OPTIONS: "yakushev_options_v4",
  COLOR_SCHEME: "color-scheme",
  CUSTOM_TEMPLATE_ID: "yakushev_custom_template_id_v2",
  OUR_POD_IDS: "yakushev_our_pod_ids_v1"
});

// Default selection: all video cards better than 5080 INCLUSIVE (ranks 1 to 5)
const DEFAULT_MAX_RANK = 5;

const state = {
  apiKey: "",
  catalogRows: [],
  userSelectionOverrides: new Map(),
  defaultSelectedAll: false,
  secureOnly: false,
  activePods: [],
  podControllers: new Map(), // Map<podId, PodController>
  currentTemplate: { ...DEFAULT_TEMPLATE },
  accountSecrets: [],
  ourPodIds: new Set(),
  currentDeploySessionId: null,
  redeployCount: 0,
  redeployInProgress: false,
  isFetchingCatalog: false,
  catalogRefreshTimerId: null
};

/* ==========================================================================
   1. Theme & Helpers
   ========================================================================== */

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const meta = document.querySelector('meta[name="color-scheme"]');
  const mql = window.matchMedia("(prefers-color-scheme: dark)");

  const updateLabel = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    const system = mql.matches ? "Темная" : "Светлая";
    if (!saved || saved === "light dark") {
      btn.textContent = `Тема: Авто (${system})`;
    } else {
      btn.textContent = `Тема: ${saved === "dark" ? "Темная" : "Светлая"}`;
    }
  };

  btn.addEventListener("click", () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    let next = "light dark";
    if (!saved || saved === "light dark") {
      next = mql.matches ? "light" : "dark";
    }
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (next === "light" || next === "dark") {
      meta.content = next;
      document.documentElement.classList.add(`theme-${next}`);
      localStorage.setItem(STORAGE_KEYS.COLOR_SCHEME, next);
    } else {
      meta.content = "light dark";
      localStorage.removeItem(STORAGE_KEYS.COLOR_SCHEME);
    }
    updateLabel();
  });

  mql.addEventListener("change", updateLabel);
  updateLabel();
}

function cleanGpuName(rawId, rawName) {
  if (rawName && rawName.trim()) {
    return rawName.replace(/^NVIDIA\s+(GeForce\s+)?/, "").trim();
  }
  return (rawId || "").replace(/^NVIDIA\s+(GeForce\s+)?/, "").trim();
}

function saveOptions() {
  const newManager = document.getElementById("opt-new-manager")?.checked ?? true;
  const restoreBackup = document.getElementById("opt-restore-backup")?.checked ?? true;
  const autoRedeploy = document.getElementById("opt-auto-redeploy")?.checked ?? true;
  const shutdownTimer = document.getElementById("opt-shutdown-timer")?.checked ?? true;
  const rawMinutes = parseInt(document.getElementById("opt-shutdown-minutes")?.value, 10);
  const shutdownMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 30;

  const data = {
    newManager,
    restoreBackup,
    autoRedeploy,
    shutdownTimer,
    shutdownMinutes
  };
  try {
    localStorage.setItem(STORAGE_KEYS.OPTIONS, JSON.stringify(data));
  } catch {}
}

function loadOptions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.OPTIONS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.newManager !== undefined) {
        const el = document.getElementById("opt-new-manager");
        if (el) el.checked = !!parsed.newManager;
      }
      if (parsed.restoreBackup !== undefined) {
        const el = document.getElementById("opt-restore-backup");
        if (el) el.checked = !!parsed.restoreBackup;
      }
      if (parsed.autoRedeploy !== undefined) {
        const el = document.getElementById("opt-auto-redeploy");
        if (el) el.checked = !!parsed.autoRedeploy;
      }
      if (parsed.shutdownTimer !== undefined) {
        const el = document.getElementById("opt-shutdown-timer");
        if (el) el.checked = !!parsed.shutdownTimer;
      }
      if (parsed.shutdownMinutes !== undefined) {
        const el = document.getElementById("opt-shutdown-minutes");
        if (el && Number.isFinite(parsed.shutdownMinutes) && parsed.shutdownMinutes > 0) {
          el.value = String(parsed.shutdownMinutes);
        }
      }
    }
  } catch {}

  const timerEl = document.getElementById("opt-shutdown-timer");
  const minEl = document.getElementById("opt-shutdown-minutes");
  if (timerEl && minEl) {
    minEl.disabled = !timerEl.checked;
  }
}

function getPodTcpPort(pod, internalPort) {
  const ports = pod?.runtime?.ports;
  if (!Array.isArray(ports)) return null;
  const p = ports.find(pt => pt.privatePort === internalPort && (pt.type === "tcp" || pt.type === "http"));
  if (p && p.ip && p.publicPort) {
    return {
      ip: p.ip,
      port: p.publicPort,
      url: `http://${p.ip}:${p.publicPort}`
    };
  }
  return null;
}

/* ==========================================================================
   2. RunPod API Client & Account Info
   ========================================================================== */

async function runpodFetch(path, options = {}) {
  if (!state.apiKey) {
    throw new Error("Не указан RunPod API Secret Key.");
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
    let detail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      detail = errJson.message || errJson.error || errJson.detail || JSON.stringify(errJson);
    } catch {
      try { detail = await response.text(); } catch {}
    }
    throw new Error(`Ошибка RunPod (${response.status}): ${detail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function fetchAccountInfo() {
  if (!state.apiKey) return;
  const panel = document.getElementById("account-info-panel");
  if (panel) panel.hidden = false;

  // Account Secrets
  try {
    const res = await runpodFetch("/account/secrets");
    state.accountSecrets = Array.isArray(res?.secrets) ? res.secrets : [];
  } catch (err) {
    console.debug("fetch secrets:", err.message);
    state.accountSecrets = [];
  }

  // Update secret status badges
  updateAccountBadges();
}

function updateAccountBadges() {
  const hfEl = document.getElementById("status-hf-token");
  const civitaiEl = document.getElementById("status-civitai-token");
  const backupEl = document.getElementById("status-backup");

  const secretNames = (state.accountSecrets || []).map((s) => String(s.name || "").trim().toUpperCase());
  const templateEnv = state.currentTemplate?.env || {};

  // HF_TOKEN / HD_TOKEN
  const hasHfSecret = secretNames.includes("HF_TOKEN") || secretNames.includes("HD_TOKEN");
  const hasHfEnv = Boolean(templateEnv.HF_TOKEN || templateEnv.HD_TOKEN);
  const isHfConfigured = hasHfSecret || (hasHfEnv && templateEnv.HF_TOKEN !== "");

  if (hfEl) {
    if (isHfConfigured) {
      hfEl.className = "secret-pill secret-ok";
      hfEl.innerHTML = `HF_TOKEN: <span class="secret-state">настроен ✓</span>`;
      hfEl.title = "HF_TOKEN подключён (в секретах RunPod или переменных шаблона)";
    } else {
      hfEl.className = "secret-pill secret-missing";
      hfEl.innerHTML = `HF_TOKEN: <span class="secret-state">не найден ✗</span>`;
      hfEl.title = "HF_TOKEN не найден в секретах RunPod";
    }
  }

  // CIVITAI_API_KEY
  const hasCivitaiSecret = secretNames.includes("CIVITAI_API_KEY");
  const hasCivitaiEnv = Boolean(templateEnv.CIVITAI_API_KEY);
  const isCivitaiConfigured = hasCivitaiSecret || (hasCivitaiEnv && templateEnv.CIVITAI_API_KEY !== "");

  if (civitaiEl) {
    if (isCivitaiConfigured) {
      civitaiEl.className = "secret-pill secret-ok";
      civitaiEl.innerHTML = `CIVITAI_API_KEY: <span class="secret-state">настроен ✓</span>`;
      civitaiEl.title = "CIVITAI_API_KEY подключён (в секретах RunPod или переменных шаблона)";
    } else {
      civitaiEl.className = "secret-pill secret-missing";
      civitaiEl.innerHTML = `CIVITAI_API_KEY: <span class="secret-state">не найден ✗</span>`;
      civitaiEl.title = "CIVITAI_API_KEY не найден в секретах RunPod";
    }
  }

  // COMFYUI_BACKUP — user asked: "COMFYUI_BACKUP тоже пусть показывает галочку если подключён вместо попытки показать содержимое"
  const hasBackupSecret = secretNames.includes("COMFYUI_BACKUP");
  const rawEnvBackup = templateEnv.COMFYUI_BACKUP;
  const isBackupConfigured = hasBackupSecret || Boolean(rawEnvBackup && rawEnvBackup !== "");

  if (backupEl) {
    if (isBackupConfigured) {
      backupEl.className = "secret-pill secret-ok";
      backupEl.innerHTML = `COMFYUI_BACKUP: <span class="secret-state">настроен ✓</span>`;
      backupEl.title = "COMFYUI_BACKUP подключён (в секретах RunPod или переменных шаблона)";
    } else {
      backupEl.className = "secret-pill secret-missing";
      backupEl.innerHTML = `COMFYUI_BACKUP: <span class="secret-state">не найден ✗</span>`;
      backupEl.title = "COMFYUI_BACKUP не найден в секретах RunPod";
    }
  }
}

/* ==========================================================================
   3. Template Management & Pencil Editor
   ========================================================================== */

function parseTemplateId(input) {
  if (!input) return "";
  const trimmed = input.trim();
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    }
  } catch {}
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function loadTemplate(templateId, showFeedback = false) {
  const cleanId = parseTemplateId(templateId);
  if (!cleanId) return;

  const msgEl = document.getElementById("template-edit-msg");

  try {
    const data = await runpodFetch(`/templates/${encodeURIComponent(cleanId)}`);
    if (data && data.id) {
      state.currentTemplate = {
        templateId: data.id,
        name: data.name || cleanId,
        image: data.image || DEFAULT_TEMPLATE.image,
        containerDiskGb: data.disk || DEFAULT_TEMPLATE.containerDiskGb,
        volumeDiskGb: data.mounts?.persistent?.size || DEFAULT_TEMPLATE.volumeDiskGb,
        volumeMountPath: data.mounts?.persistent?.path || DEFAULT_TEMPLATE.volumeMountPath,
        allowedCudaVersions: data.allowedCudaVersions?.length ? data.allowedCudaVersions : DEFAULT_TEMPLATE.allowedCudaVersions,
        ports: data.ports || DEFAULT_TEMPLATE.ports,
        env: data.env || {}
      };
      localStorage.setItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID, cleanId);
      if (showFeedback && msgEl) {
        msgEl.hidden = false;
        msgEl.className = "template-edit-msg msg-success";
        msgEl.textContent = `Темплейт "${data.name || cleanId}" успешно применён!`;
      }
    }
  } catch (err) {
    console.warn("Could not fetch template details, using ID:", err.message);
    state.currentTemplate = {
      ...DEFAULT_TEMPLATE,
      templateId: cleanId,
      name: `Темплейт ${cleanId}`
    };
    if (showFeedback && msgEl) {
      msgEl.hidden = false;
      msgEl.className = "template-edit-msg msg-error";
      msgEl.textContent = `Внимание: темплейт установлен по ID (${cleanId}), но детали не загрузились: ${err.message}`;
    }
  }

  updateTemplateUI();
  updateAccountBadges();
}

function updateTemplateUI() {
  const nameEl = document.getElementById("template-display-name");
  const badgeEl = document.getElementById("template-id-badge");
  if (nameEl) nameEl.textContent = state.currentTemplate.name || "comfy.work";
  if (badgeEl) badgeEl.textContent = state.currentTemplate.templateId;
}

function initTemplateControls() {
  const editBtn = document.getElementById("edit-template-btn");
  const form = document.getElementById("template-edit-form");
  const input = document.getElementById("custom-template-input");
  const saveBtn = document.getElementById("save-template-btn");
  const resetBtn = document.getElementById("reset-template-btn");
  const cancelBtn = document.getElementById("cancel-template-btn");
  const msgEl = document.getElementById("template-edit-msg");

  if (!editBtn || !form) return;

  editBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden && input) {
      input.value = state.currentTemplate.templateId;
      input.focus();
      if (msgEl) msgEl.hidden = true;
    }
  });

  cancelBtn.addEventListener("click", () => {
    form.hidden = true;
    if (msgEl) msgEl.hidden = true;
  });

  saveBtn.addEventListener("click", async () => {
    const val = input.value.trim();
    if (!val) return;
    saveBtn.disabled = true;
    saveBtn.textContent = "Загрузка...";
    await loadTemplate(val, true);
    saveBtn.disabled = false;
    saveBtn.textContent = "Применить";
    setTimeout(() => {
      form.hidden = true;
    }, 1200);
  });

  resetBtn.addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID);
    await loadTemplate(DEFAULT_TEMPLATE.templateId, true);
    setTimeout(() => {
      form.hidden = true;
    }, 800);
  });
}

/* ==========================================================================
   4. GPU Catalog Fetching & Priority Sorting
   ========================================================================== */

function findTierInfo(gpuId) {
  for (const tier of GPU_PRIORITY_TIERS) {
    const subIdx = tier.gpuIds.indexOf(gpuId);
    if (subIdx !== -1) {
      return {
        rank: tier.rank,
        key: tier.key,
        label: tier.label,
        subRank: subIdx
      };
    }
  }
  return null;
}

async function fetchGpuCatalog(silent = false) {
  if (state.isFetchingCatalog || !state.apiKey) return;
  state.isFetchingCatalog = true;

  const tbody = document.getElementById("gpu-tbody");

  if (!silent && state.catalogRows.length === 0) {
    tbody.replaceChildren();
    const loadingRow = document.createElement("tr");
    const loadingTd = document.createElement("td");
    loadingTd.colSpan = 5;
    loadingTd.className = "empty-cell";
    loadingTd.textContent = "Загрузка доступных видеокарт (CUDA >= 13.0)...";
    loadingRow.appendChild(loadingTd);
    tbody.appendChild(loadingRow);
  }

  try {
    const [communityRes, secureRes] = await Promise.all([
      runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=COMMUNITY&minCudaVersion=13.0"),
      runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE&minCudaVersion=13.0")
    ]);

    const rows = [];
    const processList = (gpus, cloudType) => {
      if (!Array.isArray(gpus)) return;
      for (const gpu of gpus) {
        const price = cloudType === "COMMUNITY" ? gpu.price?.community : gpu.price?.secure;
        if (price === null || price === undefined || price <= 0) continue;

        const cuda13List = (gpu.cudaVersions || [])
          .filter((c) => Number.parseFloat(c.version) >= 13.0 && c.available)
          .map((c) => c.version);

        if (cuda13List.length === 0) continue;

        const tier = findTierInfo(gpu.id);
        const displayName = cleanGpuName(gpu.id, gpu.name);
        const rowId = `${gpu.id}__${cloudType}`;

        rows.push({
          rowId,
          gpuId: gpu.id,
          displayName,
          cloud: cloudType,
          price: Number(price),
          availability: gpu.availability || "NONE",
          maxCount: cloudType === "COMMUNITY" ? (gpu.maxCount?.community || 0) : (gpu.maxCount?.secure || 0),
          cudaVersions: cuda13List,
          tierRank: tier ? tier.rank : 99,
          tierKey: tier ? tier.key : `other-${gpu.id}`,
          tierLabel: tier ? tier.label : displayName,
          subRank: tier ? tier.subRank : 99
        });
      }
    };

    processList(communityRes?.gpus, "COMMUNITY");
    processList(secureRes?.gpus, "SECURE");

    rows.sort((a, b) => {
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      if (a.subRank !== b.subRank) return a.subRank - b.subRank;

      const cloudScoreA = a.cloud === "COMMUNITY" ? 0 : 1;
      const cloudScoreB = b.cloud === "COMMUNITY" ? 0 : 1;
      if (cloudScoreA !== cloudScoreB) return cloudScoreA - cloudScoreB;

      const availDiff = (AVAILABILITY_WEIGHT[b.availability] || 0) - (AVAILABILITY_WEIGHT[a.availability] || 0);
      if (availDiff !== 0) return availDiff;

      return a.price - b.price;
    });

    state.catalogRows = rows;
    initDefaultSelections();
    renderGpuTable();
    updateLiveIndicator();
  } catch (err) {
    if (!silent) {
      tbody.replaceChildren();
      const errRow = document.createElement("tr");
      const errTd = document.createElement("td");
      errTd.colSpan = 5;
      errTd.className = "empty-cell";
      errTd.textContent = `Ошибка загрузки: ${err.message}`;
      errRow.appendChild(errTd);
      tbody.appendChild(errRow);
    }
  } finally {
    state.isFetchingCatalog = false;
  }
}

function initDefaultSelections() {
  const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_ROWS);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.userSelectionOverrides = new Map(Object.entries(parsed));
      return;
    } catch {}
  }

  state.userSelectionOverrides.clear();
  for (const row of state.catalogRows) {
    const isPreferredTier = row.tierRank <= DEFAULT_MAX_RANK;
    state.userSelectionOverrides.set(row.rowId, isPreferredTier);
  }
}

function persistSelections() {
  const obj = Object.fromEntries(state.userSelectionOverrides.entries());
  localStorage.setItem(STORAGE_KEYS.SELECTED_ROWS, JSON.stringify(obj));
}

function isGpuDesiredByUser(row) {
  if (state.userSelectionOverrides.has(row.rowId)) {
    return Boolean(state.userSelectionOverrides.get(row.rowId));
  }
  return row.tierRank <= DEFAULT_MAX_RANK;
}

function renderGpuTable() {
  const tbody = document.getElementById("gpu-tbody");
  tbody.replaceChildren();

  const maxPrice = Number.parseFloat(document.getElementById("max-price-slider").value) || 1.2;

  let displayRows = [...state.catalogRows];
  if (state.secureOnly) {
    displayRows = displayRows.filter((r) => r.cloud === "SECURE");
  }

  if (displayRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-cell";
    td.textContent = state.apiKey ? "Нет видеокарт по выбранным фильтрам" : "Введите API ключ для загрузки";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  /**
   * СОРТИРОВКА:
   * 1. Карты в пределах фильтра цены (price <= maxPrice) идут СВЕРХУ (0).
   *    Карты дороже фильтра цены (price > maxPrice) отбрасываются ВНИЗ (1)!
   * 2. Приоритетный ранг (1..15, затем 99)
   * 3. Sub-rank
   * 4. Community выше Secure (0 vs 1)
   * 5. Наличие (HIGH > MED > LOW > NONE)
   * 6. Цена по возрастанию
   */
  displayRows.sort((a, b) => {
    const aExceeds = a.price > maxPrice ? 1 : 0;
    const bExceeds = b.price > maxPrice ? 1 : 0;
    if (aExceeds !== bExceeds) return aExceeds - bExceeds;

    if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
    if (a.subRank !== b.subRank) return a.subRank - b.subRank;

    const cloudScoreA = a.cloud === "COMMUNITY" ? 0 : 1;
    const cloudScoreB = b.cloud === "COMMUNITY" ? 0 : 1;
    if (cloudScoreA !== cloudScoreB) return cloudScoreA - cloudScoreB;

    const availDiff = (AVAILABILITY_WEIGHT[b.availability] || 0) - (AVAILABILITY_WEIGHT[a.availability] || 0);
    if (availDiff !== 0) return availDiff;

    return a.price - b.price;
  });

  let addedPriceDivider = false;
  let inOtherSection = false;
  let inOtherOverpricedSection = false;

  for (const row of displayRows) {
    const exceedsPrice = row.price > maxPrice;
    const isDesired = isGpuDesiredByUser(row);

    // Разделитель перед видеокартами, которые улетели вниз из-за превышения цены
    if (exceedsPrice && !addedPriceDivider) {
      addedPriceDivider = true;
      const divTr = document.createElement("tr");
      divTr.className = "table-divider-row table-divider-price";
      const divTd = document.createElement("td");
      divTd.colSpan = 5;
      divTd.textContent = `Дороже фильтра цены (> ${maxPrice.toFixed(2)} €/ч)`;
      divTr.appendChild(divTd);
      tbody.appendChild(divTr);
    }

    // Разделитель "Другие видеокарты" в пределах цены
    if (!exceedsPrice && row.tierRank === 99 && !inOtherSection) {
      inOtherSection = true;
      const divTr = document.createElement("tr");
      divTr.className = "table-divider-row";
      const divTd = document.createElement("td");
      divTd.colSpan = 5;
      divTd.textContent = "Другие видеокарты с поддержкой CUDA ≥ 13.0";
      divTr.appendChild(divTd);
      tbody.appendChild(divTr);
    }

    // Разделитель "Другие видеокарты" в блоке дороже цены
    if (exceedsPrice && row.tierRank === 99 && !inOtherOverpricedSection) {
      inOtherOverpricedSection = true;
      const divTr = document.createElement("tr");
      divTr.className = "table-divider-row";
      const divTd = document.createElement("td");
      divTd.colSpan = 5;
      divTd.textContent = "Другие видеокарты (> лимита цены, CUDA ≥ 13.0)";
      divTr.appendChild(divTd);
      tbody.appendChild(divTr);
    }

    const tr = document.createElement("tr");
    tr.dataset.rowId = row.rowId;

    if (exceedsPrice) {
      tr.classList.add("row-exceeds-price");
    }

    // Checkbox:
    // Видеокарты, превышающие цену, не имеют включенных галочек и заблокированы для выбора
    const isChecked = !exceedsPrice && isDesired;
    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = isChecked;
    chk.disabled = exceedsPrice;
    if (exceedsPrice) {
      chk.title = `Превышает лимит ${maxPrice.toFixed(2)} €/ч. Увеличьте ползунок цены, чтобы выбрать.`;
    }
    chk.addEventListener("change", () => {
      state.userSelectionOverrides.set(row.rowId, chk.checked);
      persistSelections();
    });
    tdCheck.appendChild(chk);

    // Name & Cloud Badge
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const nameWrap = document.createElement("div");
    nameWrap.className = "gpu-name-cell";

    const titleSpan = document.createElement("span");
    titleSpan.className = "gpu-title";
    titleSpan.textContent = row.displayName;

    const pillsRow = document.createElement("div");
    pillsRow.className = "gpu-pills-row";

    const cloudPill = document.createElement("span");
    cloudPill.className = `cloud-pill ${row.cloud.toLowerCase()}`;
    cloudPill.textContent = row.cloud;
    pillsRow.appendChild(cloudPill);

    nameWrap.append(titleSpan, pillsRow);
    tdName.appendChild(nameWrap);

    // Price
    const tdPrice = document.createElement("td");
    tdPrice.className = "col-price";
    const priceText = document.createElement("span");
    priceText.className = "price-text";
    priceText.textContent = `${row.price.toFixed(2)} €/ч`;
    tdPrice.appendChild(priceText);

    // Availability
    const tdAvail = document.createElement("td");
    tdAvail.className = "col-avail";
    const availPill = document.createElement("span");
    const availClassMap = {
      HIGH: "avail-high",
      MEDIUM: "avail-med",
      LOW: "avail-low",
      NONE: "avail-none"
    };
    availPill.className = `avail-pill ${availClassMap[row.availability] || "avail-none"}`;
    availPill.textContent = row.availability;
    tdAvail.appendChild(availPill);

    // Action
    const tdAction = document.createElement("td");
    tdAction.className = "col-action";
    const launchBtn = document.createElement("button");
    launchBtn.type = "button";
    launchBtn.className = "btn btn-subtle-sm";
    launchBtn.textContent = "Запустить";
    launchBtn.disabled = row.availability === "NONE" || exceedsPrice;
    if (exceedsPrice) {
      launchBtn.title = `Превышает лимит ${maxPrice.toFixed(2)} €/ч`;
    } else if (row.availability === "NONE") {
      launchBtn.title = "Нет в наличии";
    }
    launchBtn.addEventListener("click", () => {
      startDeploymentSequence([row]);
    });
    tdAction.appendChild(launchBtn);

    tr.append(tdCheck, tdName, tdPrice, tdAvail, tdAction);
    tbody.appendChild(tr);
  }
}

function updateLiveIndicator() {
  const el = document.getElementById("catalog-live-badge");
  if (!el) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  el.textContent = `● Обновлено в ${timeStr}`;
}

/* ==========================================================================
   5. Unified Multi-Pod Dashboard & Expandable Cards
   ========================================================================== */

function initOurPodIds() {
  const saved = localStorage.getItem(STORAGE_KEYS.OUR_POD_IDS);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        state.ourPodIds = new Set(arr);
      }
    } catch {}
  }
}

function markPodAsOurs(podId) {
  if (!podId) return;
  state.ourPodIds.add(podId);
  try {
    localStorage.setItem(STORAGE_KEYS.OUR_POD_IDS, JSON.stringify([...state.ourPodIds]));
  } catch {}
}

function unmarkPodAsOurs(podId) {
  if (!podId) return;
  state.ourPodIds.delete(podId);
  try {
    localStorage.setItem(STORAGE_KEYS.OUR_POD_IDS, JSON.stringify([...state.ourPodIds]));
  } catch {}
}

function isPodCreatedByUs(pod) {
  if (!pod) return false;
  const id = pod.id || pod.podId;
  if (id && state.ourPodIds.has(id)) return true;

  const name = String(pod.name || "").trim().toLowerCase();
  if (name.startsWith("comfy-work-")) return true;

  return false;
}

function getOrCreatePodController(podId, initData = {}) {
  let ctrl = state.podControllers.get(podId);
  if (!ctrl) {
    const isOur = initData.isOurPod !== undefined ? initData.isOurPod : isPodCreatedByUs(initData.pod || initData);
    ctrl = {
      podId,
      displayName: initData.displayName || (isOur ? "comfy-work" : "runpod"),
      gpuName: initData.gpuName || "GPU",
      cloud: initData.cloud || "COMMUNITY",
      price: initData.price || 0,
      isOurPod: isOur,
      isExpanded: initData.isExpanded !== undefined ? initData.isExpanded : true,
      status: initData.status || "STARTING",
      stages: {
        provision: "done",
        container: "done",
        cuda: "active",
        ready: "pending"
      },
      subtitle: isOur ? "Инициализация и проверка CUDA 13.0..." : "",
      alert: null,
      logLines: [],
      logAbortController: null,
      cudaStagePassed: false,
      pollTimerId: null
    };
    state.podControllers.set(podId, ctrl);

    // Start background health polling immediately
    ctrl.pollTimerId = setInterval(() => pollHealthForPod(ctrl), 2500);
    pollHealthForPod(ctrl);

    if (ctrl.isExpanded) {
      startLogStreamForPod(ctrl);
    }
  }
  return ctrl;
}

function stopPodController(ctrl) {
  if (ctrl.pollTimerId) {
    clearInterval(ctrl.pollTimerId);
    ctrl.pollTimerId = null;
  }
  if (ctrl.logAbortController) {
    ctrl.logAbortController.abort();
    ctrl.logAbortController = null;
  }
}

async function fetchActivePods() {
  if (!state.apiKey) return;
  const podsSection = document.getElementById("pods-section");
  const countBadge = document.getElementById("pods-count-badge");

  try {
    const res = await runpodFetch("/pods");
    const pods = Array.isArray(res) ? res : res?.pods || res?.data || [];
    state.activePods = pods;

    if (pods.length === 0 && !state.currentDeploySessionId) {
      if (podsSection) podsSection.hidden = true;
      for (const ctrl of state.podControllers.values()) {
        stopPodController(ctrl);
      }
      state.podControllers.clear();
      renderPodsList();
      return;
    }

    if (podsSection) podsSection.hidden = false;
    if (countBadge) countBadge.textContent = String(pods.length);

    // Sync with existing controllers
    const currentIds = new Set(pods.map((p) => p.id));
    for (const [id, ctrl] of state.podControllers.entries()) {
      if (!currentIds.has(id)) {
        stopPodController(ctrl);
        state.podControllers.delete(id);
      }
    }

    for (const pod of pods) {
      const gpuName = pod.gpu?.id ? cleanGpuName(pod.gpu.id, pod.gpu.displayName) : "GPU";
      let ctrl = state.podControllers.get(pod.id);
      const isOur = isPodCreatedByUs(pod);

      if (!ctrl) {
        ctrl = getOrCreatePodController(pod.id, {
          displayName: pod.name || (isOur ? "comfy-work" : "runpod"),
          gpuName,
          cloud: pod.cloud || "COMMUNITY",
          status: pod.status,
          pod,
          isOurPod: isOur,
          isExpanded: true
        });
      } else {
        ctrl.status = pod.status;
        ctrl.displayName = pod.name || ctrl.displayName;
        ctrl.gpuName = gpuName;
        ctrl.cloud = pod.cloud || ctrl.cloud;
        ctrl.pod = pod;
        ctrl.isOurPod = isOur;
      }

      // Logs visible by default for all pods: start SSE stream if expanded
      if (ctrl.isExpanded && !ctrl.logAbortController) {
        startLogStreamForPod(ctrl);
      }
    }

    renderPodsList();
  } catch (err) {
    console.warn("fetchActivePods error:", err.message);
  }
}

function renderPodsList() {
  const container = document.getElementById("pods-list");
  if (!container) return;

  const countBadge = document.getElementById("pods-count-badge");
  if (countBadge) countBadge.textContent = String(state.podControllers.size);

  const existingCardEls = new Map();
  for (const card of container.querySelectorAll(".pod-card")) {
    const id = card.dataset.podId;
    if (id) existingCardEls.set(id, card);
  }

  // Remove cards for controllers that no longer exist
  for (const [id, el] of existingCardEls.entries()) {
    if (!state.podControllers.has(id)) {
      el.remove();
    }
  }

  // Create or update each pod card
  for (const ctrl of state.podControllers.values()) {
    let cardEl = existingCardEls.get(ctrl.podId);
    if (!cardEl) {
      cardEl = createPodCardElement(ctrl);
      container.appendChild(cardEl);
    }
    updatePodCardElement(ctrl, cardEl);
  }
}

function createPodCardElement(ctrl) {
  const card = document.createElement("div");
  card.className = "pod-card";
  card.dataset.podId = ctrl.podId;
  if (ctrl.isExpanded) card.classList.add("is-expanded");
  if (!ctrl.isOurPod) card.classList.add("pod-card-foreign");

  // Header (clickable row)
  const header = document.createElement("div");
  header.className = "pod-card-header";

  const summary = document.createElement("div");
  summary.className = "pod-card-summary";

  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "btn-pod-chevron";
  chevron.setAttribute("aria-label", "Развернуть детали");
  chevron.textContent = "▼";

  const title = document.createElement("strong");
  title.className = "pod-title";
  title.textContent = ctrl.displayName;

  const idCode = document.createElement("code");
  idCode.className = "pod-id-code";
  idCode.textContent = `(${ctrl.podId})`;

  const gpuBadge = document.createElement("span");
  gpuBadge.className = "badge badge-warn pod-gpu-badge";
  gpuBadge.textContent = `${ctrl.gpuName} · ${ctrl.cloud}`;

  const statusBadge = document.createElement("span");
  statusBadge.className = "badge pod-status-badge";
  statusBadge.textContent = ctrl.status;

  summary.append(chevron, title, idCode, gpuBadge, statusBadge);

  const quickActions = document.createElement("div");
  quickActions.className = "pod-card-quick-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger-sm";
  deleteBtn.textContent = "Удалить";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(`Точно удалить под ${ctrl.podId}?`)) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Удаление...";
    stopPodController(ctrl);
    unmarkPodAsOurs(ctrl.podId);
    try {
      await runpodFetch(`/pods/${encodeURIComponent(ctrl.podId)}`, { method: "DELETE" });
      state.podControllers.delete(ctrl.podId);
      await fetchActivePods();
    } catch (err) {
      alert(`Ошибка при удалении пода: ${err.message}`);
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Удалить";
    }
  });

  if (ctrl.isOurPod) {
    const openComfyBtn = document.createElement("a");
    openComfyBtn.href = `https://${ctrl.podId}-7860.proxy.runpod.net/`;
    openComfyBtn.target = "_blank";
    openComfyBtn.rel = "noopener noreferrer";
    openComfyBtn.className = "btn btn-subtle-sm btn-quick-comfy";
    openComfyBtn.textContent = "ComfyUI :7860 ↗";
    openComfyBtn.addEventListener("click", (e) => e.stopPropagation());

    const openFizgigBtn = document.createElement("a");
    openFizgigBtn.href = `https://${ctrl.podId}-7862.proxy.runpod.net/`;
    openFizgigBtn.target = "_blank";
    openFizgigBtn.rel = "noopener noreferrer";
    openFizgigBtn.className = "btn btn-subtle-sm btn-quick-fizgig";
    openFizgigBtn.textContent = "Fizgig :7862 ↗";
    openFizgigBtn.addEventListener("click", (e) => e.stopPropagation());

    quickActions.append(openComfyBtn, openFizgigBtn, deleteBtn);
  } else {
    // Foreign pod: "только ссылку на консоль и логи"
    const openConsoleBtn = document.createElement("a");
    openConsoleBtn.href = `https://console.runpod.io/pods?id=${encodeURIComponent(ctrl.podId)}`;
    openConsoleBtn.target = "_blank";
    openConsoleBtn.rel = "noopener noreferrer";
    openConsoleBtn.className = "btn btn-subtle-sm btn-quick-console";
    openConsoleBtn.textContent = "Консоль RunPod ↗";
    openConsoleBtn.addEventListener("click", (e) => e.stopPropagation());

    quickActions.append(openConsoleBtn, deleteBtn);
  }

  header.append(summary, quickActions);

  // Toggle expansion when header is clicked
  header.addEventListener("click", () => {
    togglePodExpanded(ctrl, card);
  });

  // Body (full deploy & monitor view)
  const body = document.createElement("div");
  body.className = "pod-card-body";

  // Terminal Logs: open by default for all pods ("логи по умолчанию видны у всех подов")
  const logDetails = document.createElement("details");
  logDetails.className = "logs-details";
  logDetails.open = true;
  const logSummary = document.createElement("summary");
  logSummary.textContent = "Логи пода (в реальном времени)";
  const logPre = document.createElement("pre");
  logPre.className = "terminal-logs";
  logPre.tabIndex = 0;
  logPre.textContent = `Подключение к логам пода ${ctrl.podId}...\n`;
  logDetails.append(logSummary, logPre);

  if (ctrl.isOurPod) {
    const metaRow = document.createElement("div");
    metaRow.className = "pod-monitor-meta";

    const sub = document.createElement("p");
    sub.className = "monitor-sub pod-card-subtitle";
    sub.textContent = ctrl.subtitle;

    const spinner = document.createElement("progress");
    spinner.className = "loading-spinner pod-card-spinner";
    spinner.setAttribute("aria-label", "Загрузка");

    metaRow.append(sub, spinner);

    const alertBox = document.createElement("div");
    alertBox.className = "monitor-alert pod-card-alert";
    alertBox.hidden = true;

    // 4 Stage pills
    const stagePills = document.createElement("div");
    stagePills.className = "stage-pills";

    const stages = [
      { key: "provision", label: "1. Подготовка хоста" },
      { key: "container", label: "2. Контейнер" },
      { key: "cuda", label: "3. Проверка CUDA и CPU" },
      { key: "ready", label: "4. ComfyUI & Fizgig Готовы" }
    ];

    for (const st of stages) {
      const pill = document.createElement("div");
      pill.className = "stage-pill";
      pill.dataset.stage = st.key;
      pill.textContent = st.label;
      stagePills.appendChild(pill);
    }

    // Action links box
    const readyBox = document.createElement("div");
    readyBox.className = "ready-links-box pod-card-links";

    const mainActions = document.createElement("div");
    mainActions.className = "ready-actions";

    const mainComfyLink = document.createElement("a");
    mainComfyLink.href = `https://${ctrl.podId}-7860.proxy.runpod.net/`;
    mainComfyLink.target = "_blank";
    mainComfyLink.rel = "noopener noreferrer";
    mainComfyLink.className = "btn btn-primary btn-large btn-link-comfy";
    mainComfyLink.textContent = "ComfyUI (:7860) ↗";

    const mainFizgigLink = document.createElement("a");
    mainFizgigLink.href = `https://${ctrl.podId}-7862.proxy.runpod.net/`;
    mainFizgigLink.target = "_blank";
    mainFizgigLink.rel = "noopener noreferrer";
    mainFizgigLink.className = "btn btn-primary btn-large btn-fizgig btn-link-fizgig";
    mainFizgigLink.textContent = "Fizgig — LoRA & Fine-tune Studio (:7862) ↗";

    const mainFileBrowserLink = document.createElement("a");
    mainFileBrowserLink.href = `https://${ctrl.podId}-7861.proxy.runpod.net/`;
    mainFileBrowserLink.target = "_blank";
    mainFileBrowserLink.rel = "noopener noreferrer";
    mainFileBrowserLink.className = "btn btn-secondary btn-link-filebrowser";
    mainFileBrowserLink.textContent = "FileBrowser (:7861) ↗";

    const copyDesktopBtn = document.createElement("button");
    copyDesktopBtn.type = "button";
    copyDesktopBtn.className = "btn btn-secondary";
    copyDesktopBtn.textContent = "Копировать ссылку для Comfy Desktop";
    copyDesktopBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(`https://${ctrl.podId}-7860.proxy.runpod.net`);
      copyDesktopBtn.textContent = "Ссылка скопирована!";
      setTimeout(() => {
        copyDesktopBtn.textContent = "Копировать ссылку для Comfy Desktop";
      }, 2000);
    });

    mainActions.append(mainComfyLink, mainFizgigLink, mainFileBrowserLink, copyDesktopBtn);

    const secLinks = document.createElement("div");
    secLinks.className = "secondary-links";

    // HTTP links: 7860 (ComfyUI), 7861 (FileBrowser), 7862 (Fizgig — LoRA & Fine-tune Studio)
    const httpRow = document.createElement("div");
    httpRow.className = "ports-row";
    const httpTitle = document.createElement("span");
    httpTitle.className = "ports-group-title";
    httpTitle.textContent = "HTTP:";

    const httpComfy = document.createElement("a");
    httpComfy.href = `https://${ctrl.podId}-7860.proxy.runpod.net/`;
    httpComfy.target = "_blank";
    httpComfy.rel = "noopener noreferrer";
    httpComfy.className = "link-subtle";
    httpComfy.textContent = "ComfyUI (:7860)";

    const httpFilebrowser = document.createElement("a");
    httpFilebrowser.href = `https://${ctrl.podId}-7861.proxy.runpod.net/`;
    httpFilebrowser.target = "_blank";
    httpFilebrowser.rel = "noopener noreferrer";
    httpFilebrowser.className = "link-subtle";
    httpFilebrowser.textContent = "FileBrowser (:7861)";

    const httpFizgig = document.createElement("a");
    httpFizgig.href = `https://${ctrl.podId}-7862.proxy.runpod.net/`;
    httpFizgig.target = "_blank";
    httpFizgig.rel = "noopener noreferrer";
    httpFizgig.className = "link-subtle";
    httpFizgig.textContent = "Fizgig — LoRA & Fine-tune Studio (:7862)";

    httpRow.append(httpTitle, httpComfy, httpFilebrowser, httpFizgig);

    // TCP links: 8188 (ComfyUI), 8080 (FileBrowser), 8888 (JupyterLab)
    const tcpRow = document.createElement("div");
    tcpRow.className = "ports-row";
    const tcpTitle = document.createElement("span");
    tcpTitle.className = "ports-group-title";
    tcpTitle.textContent = "TCP:";

    const tcpComfy = document.createElement("a");
    tcpComfy.target = "_blank";
    tcpComfy.rel = "noopener noreferrer";
    tcpComfy.className = "link-subtle link-tcp-8188 link-disabled";
    tcpComfy.textContent = "ComfyUI (:8188)";

    const tcpFilebrowser = document.createElement("a");
    tcpFilebrowser.target = "_blank";
    tcpFilebrowser.rel = "noopener noreferrer";
    tcpFilebrowser.className = "link-subtle link-tcp-8080 link-disabled";
    tcpFilebrowser.textContent = "FileBrowser (:8080)";

    const tcpJupyter = document.createElement("a");
    tcpJupyter.target = "_blank";
    tcpJupyter.rel = "noopener noreferrer";
    tcpJupyter.className = "link-subtle link-tcp-8888 link-disabled";
    tcpJupyter.textContent = "JupyterLab (:8888)";

    const consoleLink = document.createElement("a");
    consoleLink.href = `https://console.runpod.io/pods?id=${encodeURIComponent(ctrl.podId)}`;
    consoleLink.target = "_blank";
    consoleLink.rel = "noopener noreferrer";
    consoleLink.className = "link-subtle";
    consoleLink.textContent = "Консоль RunPod ↗";

    tcpRow.append(tcpTitle, tcpComfy, tcpFilebrowser, tcpJupyter, consoleLink);

    secLinks.append(httpRow, tcpRow);
    readyBox.append(mainActions, secLinks);

    body.append(metaRow, alertBox, stagePills, readyBox, logDetails);
  } else {
    // Foreign pod: no ComfyUI/Fizgig links, no stage pills.
    // "только ссылку на консоль и логи"
    const foreignBox = document.createElement("div");
    foreignBox.className = "ready-links-box pod-card-links pod-foreign-box";

    const consoleMainLink = document.createElement("a");
    consoleMainLink.href = `https://console.runpod.io/pods?id=${encodeURIComponent(ctrl.podId)}`;
    consoleMainLink.target = "_blank";
    consoleMainLink.rel = "noopener noreferrer";
    consoleMainLink.className = "btn btn-secondary";
    consoleMainLink.textContent = "Открыть под в консоли RunPod ↗";

    foreignBox.appendChild(consoleMainLink);
    body.append(foreignBox, logDetails);
  }

  card.append(header, body);
  return card;
}

function updatePodCardElement(ctrl, cardEl) {
  cardEl.classList.toggle("is-expanded", ctrl.isExpanded);

  if (!ctrl.isOurPod) {
    cardEl.classList.remove("pod-running", "pod-deploying", "pod-error");

    const statusBadge = cardEl.querySelector(".pod-status-badge");
    if (statusBadge) {
      const isErr = ctrl.status === "ERROR" || ctrl.status === "EXITED";
      const isRunning = ctrl.status === "RUNNING";
      statusBadge.className = `badge ${isErr ? "badge-error" : isRunning ? "badge-subtle" : "badge-warn"} pod-status-badge`;
      statusBadge.textContent = ctrl.status || "UNKNOWN";
    }

    const logPre = cardEl.querySelector(".terminal-logs");
    if (logPre && ctrl.logLines.length > 0) {
      logPre.textContent = ctrl.logLines.join("\n");
    }
    return;
  }

  const isComfyReady = ctrl.stages.ready === "done";
  const isCudaPassed = ctrl.stages.cuda === "done";
  const isError = ctrl.status === "ERROR" || ctrl.status === "EXITED" || ctrl.stages.cuda === "error";

  cardEl.classList.toggle("pod-running", isComfyReady);
  cardEl.classList.toggle("pod-deploying", !isComfyReady && !isError);
  cardEl.classList.toggle("pod-error", isError);

  // Status badge
  const statusBadge = cardEl.querySelector(".pod-status-badge");
  if (statusBadge) {
    if (isError) {
      statusBadge.className = "badge badge-error pod-status-badge";
      statusBadge.textContent = "СБОЙ";
    } else if (isComfyReady) {
      statusBadge.className = "badge badge-success pod-status-badge";
      statusBadge.textContent = "ГОТОВ";
    } else if (isCudaPassed) {
      statusBadge.className = "badge badge-warn pod-status-badge";
      statusBadge.textContent = "ЗАПУСК COMFYUI";
    } else {
      statusBadge.className = "badge badge-warn pod-status-badge";
      statusBadge.textContent = "ПРОВЕРКА CUDA";
    }
  }

  // Quick action buttons
  const quickComfy = cardEl.querySelector(".btn-quick-comfy");
  const quickFizgig = cardEl.querySelector(".btn-quick-fizgig");
  if (quickComfy) quickComfy.style.display = isComfyReady ? "" : "none";
  if (quickFizgig) quickFizgig.style.display = isComfyReady ? "" : "none";

  // Subtitle & spinner
  const sub = cardEl.querySelector(".pod-card-subtitle");
  if (sub) sub.textContent = ctrl.subtitle;

  const spinner = cardEl.querySelector(".pod-card-spinner");
  if (spinner) spinner.hidden = isComfyReady;

  // Alert
  const alertBox = cardEl.querySelector(".pod-card-alert");
  if (alertBox) {
    if (ctrl.alert) {
      alertBox.hidden = false;
      alertBox.className = `monitor-alert alert-${ctrl.alert.level || "info"}`;
      alertBox.textContent = ctrl.alert.msg;
    } else {
      alertBox.hidden = true;
    }
  }

  // Stages
  for (const [stageKey, stageVal] of Object.entries(ctrl.stages)) {
    const pill = cardEl.querySelector(`.stage-pill[data-stage="${stageKey}"]`);
    if (pill) {
      pill.className = `stage-pill stage-${stageVal}`;
    }
  }

  // Ready links box
  const readyBox = cardEl.querySelector(".pod-card-links");
  if (readyBox) {
    readyBox.hidden = !isComfyReady && !isCudaPassed;
  }

  // Update TCP port links dynamically when runtime ports become available
  const tcp8188 = getPodTcpPort(ctrl.pod, 8188);
  const tcp8080 = getPodTcpPort(ctrl.pod, 8080);
  const tcp8888 = getPodTcpPort(ctrl.pod, 8888);

  const tcpComfyEl = cardEl.querySelector(".link-tcp-8188");
  if (tcpComfyEl) {
    if (tcp8188) {
      tcpComfyEl.href = tcp8188.url;
      tcpComfyEl.textContent = `ComfyUI TCP (:8188 ➔ ${tcp8188.ip}:${tcp8188.port})`;
      tcpComfyEl.classList.remove("link-disabled");
    } else {
      tcpComfyEl.removeAttribute("href");
      tcpComfyEl.textContent = "ComfyUI (:8188)";
      tcpComfyEl.classList.add("link-disabled");
    }
  }

  const tcpFbEl = cardEl.querySelector(".link-tcp-8080");
  if (tcpFbEl) {
    if (tcp8080) {
      tcpFbEl.href = tcp8080.url;
      tcpFbEl.textContent = `FileBrowser TCP (:8080 ➔ ${tcp8080.ip}:${tcp8080.port})`;
      tcpFbEl.classList.remove("link-disabled");
    } else {
      tcpFbEl.removeAttribute("href");
      tcpFbEl.textContent = "FileBrowser (:8080)";
      tcpFbEl.classList.add("link-disabled");
    }
  }

  const tcpJupEl = cardEl.querySelector(".link-tcp-8888");
  if (tcpJupEl) {
    if (tcp8888) {
      tcpJupEl.href = tcp8888.url;
      tcpJupEl.textContent = `JupyterLab TCP (:8888 ➔ ${tcp8888.ip}:${tcp8888.port})`;
      tcpJupEl.classList.remove("link-disabled");
    } else {
      tcpJupEl.removeAttribute("href");
      tcpJupEl.textContent = "JupyterLab (:8888)";
      tcpJupEl.classList.add("link-disabled");
    }
  }

  // Logs
  const logPre = cardEl.querySelector(".terminal-logs");
  if (logPre && ctrl.logLines.length > 0) {
    logPre.textContent = ctrl.logLines.join("\n");
  }
}

function togglePodExpanded(ctrl, cardEl) {
  ctrl.isExpanded = !ctrl.isExpanded;
  cardEl.classList.toggle("is-expanded", ctrl.isExpanded);

  if (ctrl.isExpanded) {
    if (!ctrl.logAbortController) {
      startLogStreamForPod(ctrl);
    }
    if (!ctrl.pollTimerId) {
      pollHealthForPod(ctrl);
      ctrl.pollTimerId = setInterval(() => pollHealthForPod(ctrl), 2500);
    }
  } else {
    // When collapsing, abort SSE logs stream to save network bandwidth,
    // but keep pollHealthForPod running so status remains live and accurate!
    if (ctrl.logAbortController) {
      ctrl.logAbortController.abort();
      ctrl.logAbortController = null;
    }
  }
  updatePodCardElement(ctrl, cardEl);
}

async function startLogStreamForPod(ctrl) {
  if (ctrl.logAbortController) ctrl.logAbortController.abort();
  const abortController = new AbortController();
  ctrl.logAbortController = abortController;

  try {
    const res = await fetch(`${RUNPOD_API_BASE}/pods/${encodeURIComponent(ctrl.podId)}/logs?tail=200`, {
      headers: { Authorization: `Bearer ${state.apiKey}` },
      signal: abortController.signal
    });
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonPart = trimmed.slice(5).trim();
        if (!jsonPart) continue;
        try {
          const entry = JSON.parse(jsonPart);
          handlePodLog(ctrl, entry);
        } catch {
          handlePodLog(ctrl, { line: jsonPart, source: "system" });
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError" && ctrl.isExpanded) {
      setTimeout(() => {
        if (ctrl.isExpanded && state.podControllers.has(ctrl.podId)) {
          startLogStreamForPod(ctrl);
        }
      }, 4000);
    }
  }
}

function handlePodLog(ctrl, entry) {
  if (state.redeployInProgress) return;
  const line = String(entry.line || "").trim();
  const source = entry.source || "log";
  if (!line) return;

  ctrl.logLines.push(`[${source}] ${line}`);
  if (ctrl.logLines.length > 250) ctrl.logLines.shift();

  const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
  if (card) {
    const logPre = card.querySelector(".terminal-logs");
    if (logPre) {
      logPre.textContent = ctrl.logLines.join("\n");
      logPre.scrollTop = logPre.scrollHeight;
    }
  }

  // If this pod was not created through our interface, only show logs and console link
  if (!ctrl.isOurPod) return;

  const lowerLine = line.toLowerCase();

  // Detect fatal CUDA / GPU error (checked for ANY log source: system, container, docker daemon)
  const isNotEnoughGpu =
    lowerLine.includes("not enough gpus free") ||
    (lowerLine.includes("error creating container") && lowerLine.includes("gpu"));

  const isCudaFatal =
    line.includes("[fatal][gpu]") ||
    line.includes("host_gpu_driver_corrupt") ||
    line.includes("CUDA runtime initialization failed") ||
    line.includes("torch.cuda.is_available() returned False") ||
    line.includes("Error 803:") ||
    line.includes("Error 804:") ||
    isNotEnoughGpu;

  if (isCudaFatal) {
    ctrl.stages.cuda = "error";
    if (isNotEnoughGpu) {
      ctrl.stages.container = "error";
      ctrl.subtitle = "✗ Ошибка хоста: not enough GPUs free (CUDA недоступна)";
    } else {
      ctrl.subtitle = "✗ Сбой драйвера CUDA на хосте";
    }
    if (card) updatePodCardElement(ctrl, card);

    const reason = isNotEnoughGpu
      ? "Сбой GPU на хосте (not enough GPUs free)"
      : "Сбой драйвера CUDA на хосте";
    triggerRedeploy(ctrl.podId, reason);
    return;
  }

  // Detect CPU overload (checked for ANY log source)
  if (line.includes("CPU Overload Detected") || line.includes("cpu_confirm") || line.includes("[fatal][cpu]")) {
    ctrl.stages.cuda = "error";
    ctrl.subtitle = "✗ Критическая перегрузка CPU хоста";
    if (card) updatePodCardElement(ctrl, card);
    triggerRedeploy(ctrl.podId, "Критическая перегрузка CPU хоста");
    return;
  }

  if (source === "container") {
    ctrl.stages.provision = "done";
    ctrl.stages.container = "done";

    if (line.includes("Checking CUDA initialization") || line.includes("[cuda][warn] preflight")) {
      ctrl.stages.cuda = "active";
      ctrl.subtitle = "Инициализация и проверка CUDA 13.0...";
    }

    // Fast CUDA & CPU completion detection
    const isCudaPassed =
      line.includes("[cuda] preflight passed") ||
      line.includes("STAGE: Checking workspace volume") ||
      line.includes("[volume] persistent volume disk mounted") ||
      line.includes("[fizgig placeholder] started") ||
      line.includes("STAGE: Ensuring ComfyUI Manager") ||
      line.includes("STAGE: Installing sageattention") ||
      line.includes("STAGE: Updating ComfyUI and custom nodes") ||
      line.includes("STAGE: Starting ComfyUI") ||
      line.includes("To see the GUI go to:");

    if (isCudaPassed && !ctrl.cudaStagePassed && ctrl.stages.cuda !== "error") {
      ctrl.cudaStagePassed = true;
      ctrl.stages.cuda = "done";
      ctrl.subtitle = "✓ Проверки CUDA 13.0 и CPU пройдены успешно! Инициализация...";
    }

    // Dynamic detailed progress updates
    if (ctrl.cudaStagePassed) {
      if (line.includes("[fizgig]") || line.includes("Fizgig")) {
        ctrl.subtitle = "✓ Проверки пройдены. Настройка Fizgig Studio...";
      } else if (line.includes("STAGE: Ensuring ComfyUI Manager") || line.includes("comfyui-manager")) {
        ctrl.subtitle = "✓ Проверки пройдены. Подготовка ComfyUI Manager...";
      } else if (line.includes("STAGE: Installing sageattention") || line.includes("sageattention")) {
        ctrl.subtitle = "✓ Проверки пройдены. Установка оптимизаций SageAttention...";
      } else if (line.includes("STAGE: Updating ComfyUI and custom nodes") || line.includes("Updating:")) {
        ctrl.subtitle = "✓ Проверки пройдены. Обновление ComfyUI и кастомных нод...";
      } else if (line.includes("STAGE: Restoring") || line.includes("[restore]")) {
        ctrl.subtitle = "✓ Проверки пройдены. Восстановление бэкапа нод...";
      }
    }

    if (line.includes("Starting ComfyUI") || line.includes("To see the GUI go to:") || line.includes("ComfyUI is ready")) {
      ctrl.stages.ready = "done";
      ctrl.subtitle = "ComfyUI и Fizgig готовы к работе!";
      ctrl.status = "RUNNING";
    }

    if (card) updatePodCardElement(ctrl, card);
  }
}

async function pollHealthForPod(ctrl) {
  if (state.redeployInProgress) return;
  try {
    const pod = await runpodFetch(`/pods/${encodeURIComponent(ctrl.podId)}`);
    if (!pod) return;

    ctrl.pod = pod;
    ctrl.status = pod.status;

    // For foreign pods, only update status & card (no Comfy health checks or redeploys)
    if (!ctrl.isOurPod) {
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
      return;
    }

    // Check status or error fields for container/GPU errors
    const podErrStr = String(pod.error || pod.lastStatusChange || "").toLowerCase();
    if (
      podErrStr.includes("not enough gpus free") ||
      (podErrStr.includes("error creating container") && podErrStr.includes("gpu"))
    ) {
      ctrl.stages.cuda = "error";
      ctrl.stages.container = "error";
      ctrl.subtitle = "✗ Ошибка хоста: not enough GPUs free (CUDA недоступна)";
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
      triggerRedeploy(ctrl.podId, "Сбой GPU на хосте (not enough GPUs free)");
      return;
    }

    if (pod.runtime) {
      ctrl.stages.provision = "done";
      ctrl.stages.container = "done";

      if (pod.runtime.uptimeInSeconds > 15 && !ctrl.cudaStagePassed && ctrl.stages.cuda !== "error") {
        ctrl.cudaStagePassed = true;
        ctrl.stages.cuda = "done";
        ctrl.subtitle = "✓ Проверки CUDA 13.0 и CPU пройдены успешно! Запуск сервисов...";
      }
    }

    if (pod.status === "ERROR" || pod.status === "EXITED") {
      triggerRedeploy(ctrl.podId, `Статус пода: ${pod.status}`);
      return;
    }

    try {
      const statsRes = await fetch(`https://${ctrl.podId}-7860.proxy.runpod.net/system_stats`, { cache: "no-store" });
      if (statsRes.ok && ctrl.stages.cuda !== "error") {
        ctrl.cudaStagePassed = true;
        ctrl.stages.cuda = "done";
        ctrl.stages.ready = "done";
        ctrl.status = "RUNNING";
        ctrl.subtitle = "ComfyUI и Fizgig доступны и готовы к работе!";
      }
    } catch {}

    const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
    if (card) updatePodCardElement(ctrl, card);
  } catch {}
}

function buildPayload(candidate) {
  const newManager = document.getElementById("opt-new-manager")?.checked ? "1" : "0";
  const restoreBackup = document.getElementById("opt-restore-backup")?.checked ? "1" : "0";
  const timerEnabled = document.getElementById("opt-shutdown-timer") ? document.getElementById("opt-shutdown-timer").checked : true;
  const rawMinutes = document.getElementById("opt-shutdown-minutes") ? parseInt(document.getElementById("opt-shutdown-minutes").value, 10) : 30;
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 30;
  const slug = candidate.tierKey || "gpu";
  const tpl = state.currentTemplate;

  const env = {
    CIVITAI_API_KEY: "{{ RUNPOD_SECRET_CIVITAI_API_KEY }}",
    COMFYUI_BACKUP: "{{ RUNPOD_SECRET_COMFYUI_BACKUP }}",
    HF_TOKEN: "{{ RUNPOD_SECRET_HF_TOKEN }}",
    NEW_MANAGER: newManager,
    RESTORE_BACKUP: restoreBackup,
    STUDENT_MODE: "0"
  };

  if (timerEnabled) {
    env.RUNPOD_SHUTDOWN_MINUTES = String(minutes);
  } else {
    env.DISABLE_SHUTDOWN_TIMER = "1";
  }

  return {
    name: `comfy-work-${slug}`,
    templateId: tpl.templateId,
    cloud: candidate.cloud,
    gpu: {
      id: candidate.gpuId,
      count: 1,
      allowedCudaVersions: tpl.allowedCudaVersions || ["13.0", "13.1", "13.2", "13.3", "13.4"]
    },
    disk: tpl.containerDiskGb || 15,
    mounts: {
      persistent: {
        size: tpl.volumeDiskGb || 200,
        path: tpl.volumeMountPath || "/workspace"
      }
    },
    ports: tpl.ports || [
      "7860/http", "7861/http", "7862/http",
      "8188/tcp", "8080/tcp", "8888/tcp"
    ],
    env
  };
}

/**
 * CRITICAL RULE:
 * При попытке пересоздать под сначала запускается запуск нового пода,
 * и только после успешного создания глушится старый, чтобы не попасть на тот же сбойный хост!
 */
async function startDeploymentSequence(candidates, oldBadPodId = null) {
  const podsSection = document.getElementById("pods-section");
  if (podsSection) podsSection.hidden = false;
  podsSection.scrollIntoView({ behavior: "smooth", block: "start" });

  const pendingCard = document.getElementById("pending-deploy-card");
  const pendingTitle = document.getElementById("pending-deploy-title");
  const pendingSub = document.getElementById("pending-deploy-subtitle");
  const pendingAlert = document.getElementById("pending-deploy-alert");
  const cancelBtn = document.getElementById("cancel-pending-deploy-btn");

  if (pendingCard) pendingCard.hidden = false;

  const sessionId = Symbol("deploy-session");
  state.currentDeploySessionId = sessionId;

  const isSingleCandidate = candidates.length === 1;

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      state.currentDeploySessionId = null;
      if (pendingCard) pendingCard.hidden = true;
    };
  }

  while (state.currentDeploySessionId === sessionId) {
    let currentCandidates = candidates;
    if (!isSingleCandidate) {
      const refreshedQueue = getSelectedCandidatesQueue();
      if (refreshedQueue.length > 0) {
        currentCandidates = refreshedQueue;
      }
    }

    let lastErrorMessage = "";
    let isFatalAuthOrBilling = false;

    for (const candidate of currentCandidates) {
      if (state.currentDeploySessionId !== sessionId) return;

      state.redeployCount += 1;
      if (pendingTitle) pendingTitle.textContent = `Запуск: ${candidate.displayName} (${candidate.cloud})`;

      if (oldBadPodId) {
        if (pendingSub) pendingSub.textContent = `Запуск нового пода (сбойный хост ${oldBadPodId} удерживается)...`;
        if (pendingAlert) {
          pendingAlert.hidden = false;
          pendingAlert.className = "monitor-alert alert-info";
          pendingAlert.textContent = `Попытка #${state.redeployCount}: Выделение нового пода на ${candidate.displayName} перед удалением ${oldBadPodId}...`;
        }
      } else {
        if (pendingSub) pendingSub.textContent = `Создание пода по цене ${candidate.price.toFixed(2)} €/ч...`;
        if (pendingAlert) {
          pendingAlert.hidden = false;
          pendingAlert.className = "monitor-alert alert-info";
          pendingAlert.textContent = `Попытка #${state.redeployCount}: Выделение пода на ${candidate.displayName}...`;
        }
      }

      try {
        const payload = buildPayload(candidate);
        const created = await runpodFetch("/pods", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const newPodId = created?.id;
        if (!newPodId) throw new Error("RunPod вернул пустой ID.");

        markPodAsOurs(newPodId);

        if (oldBadPodId) {
          unmarkPodAsOurs(oldBadPodId);
          try {
            await runpodFetch(`/pods/${encodeURIComponent(oldBadPodId)}`, { method: "DELETE" });
          } catch (delErr) {
            console.warn(`Предупреждение при удалении старого пода ${oldBadPodId}:`, delErr);
          }
        }

        if (pendingCard) pendingCard.hidden = true;
        state.currentDeploySessionId = null;

        // Initialize controller for the newly launched pod
        const ctrl = getOrCreatePodController(newPodId, {
          displayName: candidate.displayName,
          gpuName: candidate.displayName,
          cloud: candidate.cloud,
          price: candidate.price,
          status: "STARTING",
          isOurPod: true,
          isExpanded: true
        });
        ctrl.isExpanded = true;
        ctrl.isOurPod = true;

        await fetchActivePods();
        startLogStreamForPod(ctrl);

        const newCard = document.querySelector(`.pod-card[data-pod-id="${newPodId}"]`);
        if (newCard) {
          updatePodCardElement(ctrl, newCard);
          newCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      } catch (err) {
        lastErrorMessage = err.message || "";
        const lowerErr = lastErrorMessage.toLowerCase();
        if (
          lastErrorMessage.includes("401") ||
          lastErrorMessage.includes("402") ||
          lastErrorMessage.includes("403") ||
          lowerErr.includes("unauthorized") ||
          lowerErr.includes("payment") ||
          lowerErr.includes("balance")
        ) {
          isFatalAuthOrBilling = true;
          break;
        }

        if (pendingAlert) {
          pendingAlert.hidden = false;
          pendingAlert.className = "monitor-alert alert-warn";
          pendingAlert.textContent = `Попытка #${state.redeployCount} (${candidate.displayName}): ${err.message}.`;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (state.currentDeploySessionId !== sessionId) return;

    if (isFatalAuthOrBilling) {
      if (pendingAlert) {
        pendingAlert.hidden = false;
        pendingAlert.className = "monitor-alert alert-error";
        pendingAlert.textContent = `Критическая ошибка: ${lastErrorMessage}`;
      }
      return;
    }

    const autoRedeploy = document.getElementById("opt-auto-redeploy").checked;
    if (!autoRedeploy) {
      if (oldBadPodId) {
        try {
          await runpodFetch(`/pods/${encodeURIComponent(oldBadPodId)}`, { method: "DELETE" });
        } catch {}
      }
      if (pendingAlert) {
        pendingAlert.hidden = false;
        pendingAlert.className = "monitor-alert alert-error";
        pendingAlert.textContent = `Все выбранные видеокарты сейчас недоступны: ${lastErrorMessage || "на RunPod нет свободных машин"}.`;
      }
      return;
    }

    // Auto-retry loop countdown
    const targetLabel = isSingleCandidate
      ? currentCandidates[0].displayName
      : "Все выбранные видеокарты";

    for (let sec = 5; sec > 0; sec--) {
      if (state.currentDeploySessionId !== sessionId) return;
      if (pendingAlert) {
        pendingAlert.hidden = false;
        pendingAlert.className = "monitor-alert alert-warn";
        pendingAlert.textContent = `${targetLabel} сейчас заняты на RunPod. Повторная попытка #${state.redeployCount + 1} через ${sec} сек...`;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (state.currentDeploySessionId !== sessionId) return;

    try {
      await fetchGpuCatalog(true);
    } catch {}
  }
}

async function triggerRedeploy(badPodId, reason) {
  if (state.redeployInProgress) return;
  state.redeployInProgress = true;

  const autoRedeploy = document.getElementById("opt-auto-redeploy").checked;
  const ctrl = state.podControllers.get(badPodId);
  if (ctrl) {
    ctrl.alert = {
      msg: `Обнаружена проблема: ${reason}. Перезапуск пода...`,
      level: "warn"
    };
  }

  if (!autoRedeploy) {
    if (ctrl) {
      ctrl.alert = {
        msg: `Ошибка пода (${reason}). Повторные попытки отключены.`,
        level: "error"
      };
    }
    state.redeployInProgress = false;
    return;
  }

  const queue = getSelectedCandidatesQueue();
  state.redeployInProgress = false;
  await startDeploymentSequence(queue, badPodId);
}

function getSelectedCandidatesQueue() {
  const maxPrice = Number.parseFloat(document.getElementById("max-price-slider").value) || 1.2;
  return state.catalogRows.filter((r) => {
    if (r.price > maxPrice) return false;
    if (!isGpuDesiredByUser(r)) return false;
    if (r.availability === "NONE") return false;
    if (state.secureOnly && r.cloud !== "SECURE") return false;
    return true;
  });
}

/* ==========================================================================
   6. Auto-Refresh Loop While Tab is Open
   ========================================================================== */

function startAutoRefreshLoop() {
  if (state.catalogRefreshTimerId) {
    clearInterval(state.catalogRefreshTimerId);
  }
  state.catalogRefreshTimerId = setInterval(() => {
    if (!document.hidden && state.apiKey && !state.redeployInProgress) {
      fetchGpuCatalog(true);
      fetchActivePods();
    }
  }, CATALOG_AUTO_REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.apiKey) {
      fetchGpuCatalog(true);
      fetchActivePods();
    }
  });
}

/* ==========================================================================
   7. Event Wiring & Init
   ========================================================================== */

async function init() {
  initThemeToggle();
  initTemplateControls();
  initOurPodIds();

  // Price Slider
  const slider = document.getElementById("max-price-slider");
  const priceVal = document.getElementById("max-price-val");

  const savedPrice = localStorage.getItem(STORAGE_KEYS.MAX_PRICE);
  if (savedPrice && !isNaN(Number.parseFloat(savedPrice))) {
    slider.value = savedPrice;
    priceVal.textContent = `${Number.parseFloat(savedPrice).toFixed(2)} €/ч`;
  } else {
    slider.value = "1.20";
    priceVal.textContent = "1.20 €/ч";
  }

  const onPriceChange = () => {
    const val = Number.parseFloat(slider.value).toFixed(2);
    priceVal.textContent = `${val} €/ч`;
    localStorage.setItem(STORAGE_KEYS.MAX_PRICE, val);
    renderGpuTable();
  };
  slider.addEventListener("input", onPriceChange);
  slider.addEventListener("change", onPriceChange);

  // Key Visibility Toggle
  const keyInput = document.getElementById("runpod-api-key");
  const toggleKeyBtn = document.getElementById("toggle-key-btn");
  toggleKeyBtn.addEventListener("click", () => {
    const isPw = keyInput.type === "password";
    keyInput.type = isPw ? "text" : "password";
    toggleKeyBtn.textContent = isPw ? "Скрыть" : "Показать";
  });

  // Forget Key Button
  document.getElementById("forget-key-btn").addEventListener("click", () => {
    state.apiKey = "";
    keyInput.value = "";
    localStorage.removeItem(STORAGE_KEYS.API_KEY);
    document.getElementById("account-info-panel").hidden = true;
    document.getElementById("pods-section").hidden = true;
    document.getElementById("pods-list").replaceChildren();
    document.getElementById("gpu-tbody").replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-cell";
    td.textContent = "Ключ удален. Введите API ключ для подключения.";
    tr.appendChild(td);
    document.getElementById("gpu-tbody").appendChild(tr);
  });

  // Key Input Listener
  const onKeyUpdated = async () => {
    const entered = keyInput.value.trim();
    if (entered.length >= 20 && entered !== state.apiKey) {
      state.apiKey = entered;
      localStorage.setItem(STORAGE_KEYS.API_KEY, entered);
      await Promise.all([fetchAccountInfo(), fetchActivePods(), fetchGpuCatalog()]);
    }
  };
  keyInput.addEventListener("input", onKeyUpdated);
  keyInput.addEventListener("change", onKeyUpdated);

  // Button "Только Secure"
  const btnSecureOnly = document.getElementById("btn-secure-only");
  const savedSecure = localStorage.getItem(STORAGE_KEYS.SECURE_ONLY);
  if (savedSecure === "true") {
    state.secureOnly = true;
    btnSecureOnly.classList.add("active");
  }

  btnSecureOnly.addEventListener("click", () => {
    state.secureOnly = !state.secureOnly;
    btnSecureOnly.classList.toggle("active", state.secureOnly);
    localStorage.setItem(STORAGE_KEYS.SECURE_ONLY, state.secureOnly ? "true" : "false");
    renderGpuTable();
  });

  // Load and bind options (ComfyUI Manager, Backup, Auto-redeploy, Shutdown timer)
  loadOptions();

  const bindOpt = (id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", saveOptions);
  };
  bindOpt("opt-new-manager");
  bindOpt("opt-restore-backup");
  bindOpt("opt-auto-redeploy");

  const shutdownTimerEl = document.getElementById("opt-shutdown-timer");
  const shutdownMinutesEl = document.getElementById("opt-shutdown-minutes");
  if (shutdownTimerEl && shutdownMinutesEl) {
    shutdownTimerEl.addEventListener("change", () => {
      shutdownMinutesEl.disabled = !shutdownTimerEl.checked;
      saveOptions();
    });
    shutdownMinutesEl.addEventListener("input", saveOptions);
    shutdownMinutesEl.addEventListener("change", saveOptions);
  }

  // Quick Select Buttons
  const btnAll = document.getElementById("btn-select-all");
  const btnNone = document.getElementById("btn-select-none");

  btnAll.addEventListener("click", () => {
    state.defaultSelectedAll = true;
    state.userSelectionOverrides.clear();
    for (const row of state.catalogRows) {
      state.userSelectionOverrides.set(row.rowId, true);
    }
    persistSelections();
    renderGpuTable();
  });

  btnNone.addEventListener("click", () => {
    state.defaultSelectedAll = false;
    state.userSelectionOverrides.clear();
    for (const row of state.catalogRows) {
      state.userSelectionOverrides.set(row.rowId, false);
    }
    persistSelections();
    renderGpuTable();
  });

  // Deploy Best Button
  document.getElementById("deploy-best-btn").addEventListener("click", () => {
    const queue = getSelectedCandidatesQueue();
    if (queue.length === 0) {
      alert("Нет доступных видеокарт среди выбранных по текущим фильтрам (цена, Secure). Увеличьте ползунок цены или выберите другие карты.");
      return;
    }
    startDeploymentSequence(queue);
  });

  // Refresh Pods
  document.getElementById("refresh-pods-btn").addEventListener("click", () => fetchActivePods());

  // Load custom template if saved
  const savedTemplateId = localStorage.getItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID);
  if (savedTemplateId) {
    await loadTemplate(savedTemplateId);
  } else {
    updateTemplateUI();
  }

  // Start background auto-refresh loop
  startAutoRefreshLoop();

  // Auto-load if key was saved
  const savedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
  if (savedKey) {
    state.apiKey = savedKey;
    keyInput.value = savedKey;
    fetchAccountInfo();
    fetchActivePods();
    fetchGpuCatalog();
  }
}

document.addEventListener("DOMContentLoaded", init);
