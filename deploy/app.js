/**
 * course.yakushev.fr/deploy — Minimalist RunPod Deployer & CUDA 13.0 Monitor
 * Zero-backend: Direct browser fetch to https://api.runpod.io/v2
 */

const RUNPOD_API_BASE = "https://api.runpod.io/v2";
const CATALOG_AUTO_REFRESH_MS = 12000;

const LOCKED_TEMPLATE = Object.freeze({
  templateId: "casls01eko",
  image: "jnxmx/comfy26:test",
  containerDiskGb: 15,
  volumeDiskGb: 200,
  volumeMountPath: "/workspace",
  allowedCudaVersions: ["13.0", "13.1", "13.2", "13.3", "13.4"],
  ports: [
    "7860/http", "7861/http", "7862/http",
    "8188/tcp", "8080/tcp", "8888/tcp",
    "8188/udp", "8080/udp", "8888/udp"
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
    // 5000 ada ниже чем pro 4000
    gpuIds: ["NVIDIA RTX 5000 Ada Generation"]
  },
  {
    rank: 12,
    key: "rtx-a6000",
    label: "RTX A6000",
    // a6000 выше чем 3090
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
    // RTX 3080 Ti должен быть выше 3070
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
  NET_SPEED: "yakushev_net_speed_v1",
  MAX_PRICE: "yakushev_max_price_v3",
  OPTIONS: "yakushev_options_v3",
  COLOR_SCHEME: "color-scheme"
});

// Default selection: all video cards better than 5080 INCLUSIVE (ranks 1 to 5)
const DEFAULT_MAX_RANK = 5;

const state = {
  apiKey: "",
  catalogRows: [],
  userSelectionOverrides: new Map(),
  defaultSelectedAll: false,
  secureOnly: false,
  minNetSpeedMbps: 0,
  activePods: [],
  activePodId: null,
  activeDeploySpec: null,
  redeployCount: 0,
  pollTimerId: null,
  catalogRefreshTimerId: null,
  logAbortController: null,
  logLines: [],
  cudaStagePassed: false,
  redeployInProgress: false,
  isFetchingCatalog: false
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
  return rawId.replace(/^NVIDIA\s+(GeForce\s+)?/, "").trim();
}

function determineNetworkSpeed(cloudType, gpuId, minRam) {
  // Secure Cloud: enterprise datacenters with 10 Gbps symmetric network
  if (cloudType === "SECURE") {
    return { mbps: 10000, text: "10 Gbps" };
  }
  // Community Cloud:
  // High-end server GPUs or hosts with minRam >= 60GB have Gigabit uplinks
  const isHighEnd =
    gpuId.includes("5090") ||
    gpuId.includes("4090") ||
    gpuId.includes("6000") ||
    gpuId.includes("A100") ||
    gpuId.includes("H100") ||
    gpuId.includes("L40") ||
    (minRam && minRam >= 60);

  if (isHighEnd) {
    return { mbps: 1000, text: "1 Gbps" };
  }
  return { mbps: 500, text: "500 Mbps" };
}

/* ==========================================================================
   2. RunPod API Client
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
      detail = errJson.message || errJson.error || JSON.stringify(errJson);
    } catch {
      try { detail = await response.text(); } catch {}
    }
    throw new Error(`Ошибка RunPod (${response.status}): ${detail}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/* ==========================================================================
   3. Active Pods
   ========================================================================== */

async function fetchActivePods() {
  const container = document.getElementById("active-pods-list");
  const section = document.getElementById("active-pods-section");

  try {
    const res = await runpodFetch("/pods");
    const pods = Array.isArray(res) ? res : res?.pods || res?.data || [];
    state.activePods = pods;

    if (pods.length === 0) {
      container.replaceChildren();
      section.hidden = true;
      return;
    }

    section.hidden = false;
    container.replaceChildren();

    for (const pod of pods) {
      const row = document.createElement("div");
      row.className = "pod-row";

      const info = document.createElement("div");
      info.className = "pod-info";

      const title = document.createElement("span");
      title.className = "pod-title";
      title.textContent = pod.name || "comfy-work";

      const idCode = document.createElement("code");
      idCode.className = "pod-id-code";
      idCode.textContent = `(${pod.id})`;

      const gpuName = pod.gpu?.id ? cleanGpuName(pod.gpu.id, pod.gpu.displayName) : "GPU";
      const gpuPill = document.createElement("span");
      gpuPill.className = "badge badge-warn";
      gpuPill.textContent = `${gpuName} · ${pod.cloud || "COMMUNITY"}`;

      const statusBadge = document.createElement("span");
      statusBadge.className = pod.status === "RUNNING" ? "badge badge-success" : "badge badge-warn";
      statusBadge.textContent = pod.status || "STARTING";

      info.append(title, idCode, gpuPill, statusBadge);

      const actions = document.createElement("div");
      actions.className = "pod-actions";

      if (pod.status === "RUNNING") {
        const openLink = document.createElement("a");
        openLink.href = `https://${pod.id}-7860.proxy.runpod.net/`;
        openLink.target = "_blank";
        openLink.rel = "noopener noreferrer";
        openLink.className = "btn btn-subtle";
        openLink.textContent = "ComfyUI :7860 ↗";
        actions.appendChild(openLink);
      }

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-danger-sm";
      delBtn.textContent = "Удалить";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`Удалить под ${pod.id}?`)) return;
        delBtn.disabled = true;
        delBtn.textContent = "Удаление...";
        try {
          await runpodFetch(`/pods/${encodeURIComponent(pod.id)}`, { method: "DELETE" });
          if (state.activePodId === pod.id) {
            stopMonitor();
            document.getElementById("monitor-section").hidden = true;
          }
          await fetchActivePods();
        } catch (err) {
          alert(`Не удалось удалить под: ${err.message}`);
          delBtn.disabled = false;
          delBtn.textContent = "Удалить";
        }
      });

      actions.appendChild(delBtn);
      row.append(info, actions);
      container.appendChild(row);
    }
  } catch (err) {
    console.warn("fetchActivePods error:", err.message);
  }
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
        const net = determineNetworkSpeed(cloudType, gpu.id, gpu.minRam);

        rows.push({
          rowId,
          gpuId: gpu.id,
          displayName,
          cloud: cloudType,
          price: Number(price),
          availability: gpu.availability || "NONE",
          maxCount: cloudType === "COMMUNITY" ? (gpu.maxCount?.community || 0) : (gpu.maxCount?.secure || 0),
          cudaVersions: cuda13List,
          netSpeedMbps: net.mbps,
          netSpeedText: net.text,
          tierRank: tier ? tier.rank : 99,
          tierKey: tier ? tier.key : `other-${gpu.id}`,
          tierLabel: tier ? tier.label : displayName,
          subRank: tier ? tier.subRank : 99
        });
      }
    };

    processList(communityRes?.gpus, "COMMUNITY");
    processList(secureRes?.gpus, "SECURE");

    /**
     * Strict Sorting Order:
     * 1. Приоритетный список (Tiers 1..15: Pro 6000 -> 3070), затем остальные (tierRank 99).
     * 2. Если карта есть в Community и Secure -> Community ставить выше!
     * 3. Затем наличие (HIGH > MED > LOW > NONE).
     * 4. Затем цена по возрастанию.
     */
    rows.sort((a, b) => {
      if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
      if (a.subRank !== b.subRank) return a.subRank - b.subRank;

      // Community выше Secure
      const cloudScoreA = a.cloud === "COMMUNITY" ? 0 : 1;
      const cloudScoreB = b.cloud === "COMMUNITY" ? 0 : 1;
      if (cloudScoreA !== cloudScoreB) return cloudScoreA - cloudScoreB;

      // Availability
      const availDiff = (AVAILABILITY_WEIGHT[b.availability] || 0) - (AVAILABILITY_WEIGHT[a.availability] || 0);
      if (availDiff !== 0) return availDiff;

      // Price
      return a.price - b.price;
    });

    state.catalogRows = rows;

    // First time init selections: all GPUs better than 5080 inclusive (ranks 1 to 5)
    if (state.selectedRowIds.size === 0) {
      initDefaultSelections();
    }

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

function isGpuDesiredByUser(row) {
  if (state.userSelectionOverrides.has(row.rowId)) {
    return state.userSelectionOverrides.get(row.rowId);
  }
  if (state.defaultSelectedAll) {
    return true;
  }
  return row.tierRank <= DEFAULT_MAX_RANK;
}

function initDefaultSelections() {
  const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_ROWS);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        state.userSelectionOverrides = new Map(parsed);
        return;
      }
    } catch {}
  }
}

function persistSelections() {
  localStorage.setItem(STORAGE_KEYS.SELECTED_ROWS, JSON.stringify([...state.userSelectionOverrides.entries()]));
}

function updateLiveIndicator() {
  const badge = document.getElementById("catalog-live-badge");
  if (!badge) return;
  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  badge.textContent = `● Обновлено в ${timeStr}`;
}

function renderGpuTable() {
  const tbody = document.getElementById("gpu-tbody");
  tbody.replaceChildren();

  const maxPrice = Number.parseFloat(document.getElementById("max-price-slider").value) || 1.0;

  // Filter rows by "Только Secure" and "Network Speed"
  const visibleRows = state.catalogRows.filter((row) => {
    if (state.secureOnly && row.cloud !== "SECURE") return false;
    if (state.minNetSpeedMbps > 0 && row.netSpeedMbps < state.minNetSpeedMbps) return false;
    return true;
  });

  if (visibleRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-cell";
    td.textContent = "Нет доступных видеокарт по заданным фильтрам.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  /**
   * SORTING:
   * 1. Видеокарты в пределах фильтра цены (price <= maxPrice) идут СВЕРХУ (0).
   *    Видеокарты, превышающие цену (price > maxPrice), улетают ВНИЗ (1)!
   * 2. Приоритетный ранг (1..15, затем 99)
   * 3. Sub-rank
   * 4. Community выше Secure
   * 5. Наличие (HIGH > MED > LOW > NONE)
   * 6. Цена по возрастанию
   */
  visibleRows.sort((a, b) => {
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

  let addedDivider = false;

  for (const row of visibleRows) {
    const exceedsPrice = row.price > maxPrice;
    const isDesired = isGpuDesiredByUser(row);

    // ВАЖНО: Видеокарты, превышающие фильтр цены, НЕ имеют включенных галочек ("без галочек")!
    const isChecked = !exceedsPrice && isDesired;

    // Разделитель перед видеокартами, которые улетели вниз из-за превышения цены
    if (exceedsPrice && !addedDivider) {
      addedDivider = true;
      const divTr = document.createElement("tr");
      divTr.className = "table-divider-row";
      const divTd = document.createElement("td");
      divTd.colSpan = 5;
      divTd.textContent = `Дороже фильтра цены (> ${maxPrice.toFixed(2)} €/ч)`;
      divTr.appendChild(divTd);
      tbody.appendChild(divTr);
    }

    const tr = document.createElement("tr");
    if (exceedsPrice) {
      tr.classList.add("row-exceeds-price");
    }

    // 1. Checkbox
    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = isChecked;
    chk.disabled = exceedsPrice; // Карты выше лимита цены отключены для выбора
    chk.setAttribute("aria-label", `Выбрать ${row.displayName} (${row.cloud})`);
    chk.addEventListener("change", () => {
      state.userSelectionOverrides.set(row.rowId, chk.checked);
      persistSelections();
      renderGpuTable();
    });
    tdCheck.appendChild(chk);

    // 2. GPU Name + Cloud + Network Speed
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const nameWrap = document.createElement("div");
    nameWrap.className = "gpu-name-cell";

    const nameSpan = document.createElement("span");
    nameSpan.className = "gpu-title-text";
    nameSpan.textContent = row.displayName;

    const badgesWrap = document.createElement("div");
    badgesWrap.className = "gpu-pills-row";

    const cloudPill = document.createElement("span");
    cloudPill.className = `cloud-pill ${row.cloud.toLowerCase()}`;
    cloudPill.textContent = row.cloud === "COMMUNITY" ? "Community" : "Secure";

    const netPill = document.createElement("span");
    netPill.className = "net-pill";
    netPill.textContent = row.netSpeedText;

    badgesWrap.append(cloudPill, netPill);
    nameWrap.append(nameSpan, badgesWrap);
    tdName.appendChild(nameWrap);

    // 3. Price
    const tdPrice = document.createElement("td");
    tdPrice.className = "col-price";
    const priceText = document.createElement("span");
    priceText.className = "price-text";
    priceText.textContent = `${row.price.toFixed(2)} €/ч`;
    tdPrice.appendChild(priceText);

    // 4. Availability
    const tdAvail = document.createElement("td");
    tdAvail.className = "col-avail";
    const availSpan = document.createElement("span");
    if (row.availability === "HIGH") {
      availSpan.className = "avail-pill avail-high";
      availSpan.textContent = "В наличии";
    } else if (row.availability === "MEDIUM" || row.availability === "LOW") {
      availSpan.className = "avail-pill avail-med";
      availSpan.textContent = "Мало";
    } else {
      availSpan.className = "avail-pill avail-none";
      availSpan.textContent = "Нет";
    }
    tdAvail.appendChild(availSpan);

    // 5. Action (Deploy)
    const tdAction = document.createElement("td");
    tdAction.className = "col-action";
    const deployBtn = document.createElement("button");
    deployBtn.type = "button";
    deployBtn.className = "btn btn-subtle";
    deployBtn.textContent = "Запустить";
    deployBtn.disabled = row.availability === "NONE" || exceedsPrice;
    deployBtn.addEventListener("click", () => {
      startDeploymentSequence([row]);
    });
    tdAction.appendChild(deployBtn);

    tr.append(tdCheck, tdName, tdPrice, tdAvail, tdAction);
    tbody.appendChild(tr);
  }
}

/* ==========================================================================
   5. Pod Deployment, Log Streamer & Safe Auto-Redeploy Engine
   ========================================================================== */

function setStageState(stageName, status) {
  const el = document.querySelector(`.stage-pill[data-stage="${stageName}"]`);
  if (!el) return;
  el.classList.remove("stage-active", "stage-done", "stage-error");
  if (status === "active") el.classList.add("stage-active");
  if (status === "done") el.classList.add("stage-done");
  if (status === "error") el.classList.add("stage-error");
}

function resetStages() {
  for (const s of ["provision", "container", "cuda", "ready"]) {
    setStageState(s, "pending");
  }
}

function showMonitorAlert(msg, level = "info") {
  const alertBox = document.getElementById("monitor-alert");
  alertBox.hidden = false;
  alertBox.className = `monitor-alert alert-${level}`;
  alertBox.textContent = msg;
}

function buildPayload(row) {
  const newManager = document.getElementById("opt-new-manager").checked ? "1" : "0";
  const restoreBackup = document.getElementById("opt-restore-backup").checked ? "1" : "0";
  const slug = row.tierKey || "gpu";

  return {
    name: `comfy-work-${slug}`,
    templateId: LOCKED_TEMPLATE.templateId,
    image: LOCKED_TEMPLATE.image,
    cloud: row.cloud,
    gpu: {
      id: row.gpuId,
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

/**
 * CRITICAL RULE:
 * При попытке пересоздать под сначала запускается запуск нового пода,
 * и только после успешного создания глушится старый, чтобы не попасть на тот же сбойный хост!
 */
async function startDeploymentSequence(candidates, oldBadPodId = null) {
  const monitorSec = document.getElementById("monitor-section");
  monitorSec.hidden = false;
  monitorSec.scrollIntoView({ behavior: "smooth", block: "start" });

  state.activeDeploySpec = candidates;

  for (const candidate of candidates) {
    state.redeployCount += 1;
    resetStages();
    setStageState("provision", "active");
    document.getElementById("monitor-spinner").hidden = false;
    document.getElementById("monitor-title").textContent = `Запуск: ${candidate.displayName} (${candidate.cloud})`;

    if (oldBadPodId) {
      document.getElementById("monitor-subtitle").textContent =
        `Запуск нового пода (сбойный хост ${oldBadPodId} удерживается, чтобы не попасть на него снова)...`;
      showMonitorAlert(
        `Попытка #${state.redeployCount}: Выделение нового пода на ${candidate.displayName} перед удалением ${oldBadPodId}...`,
        "info"
      );
    } else {
      document.getElementById("monitor-subtitle").textContent = `Создание пода по цене ${candidate.price.toFixed(2)} €/ч...`;
      showMonitorAlert(`Попытка #${state.redeployCount}: Выделение пода на ${candidate.displayName}...`, "info");
    }

    try {
      const payload = buildPayload(candidate);
      const created = await runpodFetch("/pods", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const newPodId = created?.id;
      if (!newPodId) throw new Error("RunPod вернул пустой ID.");

      // ТЕПЕРЬ, когда новый под успешно запущен на ДРУГОМ хосте, безопасно удаляем старый сбойный под!
      if (oldBadPodId) {
        showMonitorAlert(
          `Новый под ${newPodId} успешно создан! Теперь безопасно удаляем предыдущий сбойный под ${oldBadPodId}...`,
          "info"
        );
        try {
          await runpodFetch(`/pods/${encodeURIComponent(oldBadPodId)}`, { method: "DELETE" });
        } catch (delErr) {
          console.warn(`Предупреждение при удалении старого пода ${oldBadPodId}:`, delErr);
        }
      }

      await fetchActivePods();
      attachMonitor(newPodId, candidate);
      return;
    } catch (err) {
      showMonitorAlert(
        `Не удалось запустить на ${candidate.displayName}: ${err.message}. Пробуем следующий вариант...`,
        "warn"
      );
    }
  }

  // Если все кандидаты исчерпаны, только сейчас очищаем старый под
  if (oldBadPodId) {
    try {
      await runpodFetch(`/pods/${encodeURIComponent(oldBadPodId)}`, { method: "DELETE" });
    } catch {}
  }

  showMonitorAlert(
    "Не удалось запустить ни одну из выбранных видеокарт. Попробуйте увеличить макс. цену или выбрать другие карты.",
    "error"
  );
  document.getElementById("monitor-spinner").hidden = true;
}

function stopMonitor() {
  if (state.pollTimerId) {
    clearInterval(state.pollTimerId);
    state.pollTimerId = null;
  }
  if (state.logAbortController) {
    state.logAbortController.abort();
    state.logAbortController = null;
  }
  document.getElementById("monitor-spinner").hidden = true;
}

function attachMonitor(podId, candidate) {
  stopMonitor();
  state.activePodId = podId;
  state.cudaStagePassed = false;
  state.redeployInProgress = false;
  state.logLines = [];

  const monitorSec = document.getElementById("monitor-section");
  monitorSec.hidden = false;
  document.getElementById("ready-links-box").hidden = true;
  document.getElementById("pod-log-output").textContent = `Подключение к логам пода ${podId}...\n`;

  // Bind links
  const comfyUrl = `https://${podId}-7860.proxy.runpod.net/`;
  document.getElementById("open-comfy-link").href = comfyUrl;
  document.getElementById("link-jupyter").href = `https://${podId}-8888.proxy.runpod.net/`;
  document.getElementById("link-filebrowser").href = `https://${podId}-8080.proxy.runpod.net/`;
  document.getElementById("link-console").href = `https://console.runpod.io/pods?id=${encodeURIComponent(podId)}`;

  document.getElementById("copy-desktop-url-btn").onclick = async () => {
    await navigator.clipboard.writeText(`https://${podId}-7860.proxy.runpod.net`);
    const btn = document.getElementById("copy-desktop-url-btn");
    btn.textContent = "Ссылка скопирована!";
    setTimeout(() => { btn.textContent = "Копировать ссылку для Comfy Desktop"; }, 2000);
  };

  startLogStream(podId);
  pollHealth(podId);
  state.pollTimerId = setInterval(() => {
    if (state.activePodId === podId) pollHealth(podId);
  }, 4000);
}

async function startLogStream(podId) {
  const abortController = new AbortController();
  state.logAbortController = abortController;

  try {
    const res = await fetch(`${RUNPOD_API_BASE}/pods/${encodeURIComponent(podId)}/logs?tail=200`, {
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
          handleLog(podId, entry);
        } catch {}
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      setTimeout(() => {
        if (state.activePodId === podId) startLogStream(podId);
      }, 4000);
    }
  }
}

function handleLog(podId, entry) {
  if (state.activePodId !== podId || state.redeployInProgress) return;
  const line = String(entry.line || "").trim();
  const source = entry.source || "log";
  if (!line) return;

  state.logLines.push(`[${source}] ${line}`);
  if (state.logLines.length > 200) state.logLines.shift();
  const logPre = document.getElementById("pod-log-output");
  logPre.textContent = state.logLines.join("\n");
  logPre.scrollTop = logPre.scrollHeight;

  if (source === "container") {
    setStageState("provision", "done");
    setStageState("container", "done");

    if (line.includes("Checking CUDA initialization") || line.includes("[cuda][warn] preflight")) {
      setStageState("cuda", "active");
      document.getElementById("monitor-subtitle").textContent = "Инициализация и проверка CUDA 13.0...";
    }

    // Detect fatal CUDA / GPU error
    const isCudaFatal =
      line.includes("[fatal][gpu]") ||
      line.includes("host_gpu_driver_corrupt") ||
      line.includes("CUDA runtime initialization failed") ||
      line.includes("torch.cuda.is_available() returned False") ||
      line.includes("Error 803:") || line.includes("Error 804:");

    if (isCudaFatal) {
      setStageState("cuda", "error");
      triggerRedeploy(podId, "Сбой драйвера CUDA на хосте");
      return;
    }

    // Detect CPU overload
    if (line.includes("CPU Overload Detected") || line.includes("cpu_confirm")) {
      triggerRedeploy(podId, "Критическая перегрузка CPU хоста");
      return;
    }

    // Successful CUDA completion
    const isPastCuda =
      line.includes("STAGE: Creating environment") ||
      line.includes("STAGE: Restoring") ||
      line.includes("STAGE: Updating") ||
      line.includes("Starting ComfyUI") ||
      line.includes("To see the GUI go to:");

    if (isPastCuda && !state.cudaStagePassed) {
      state.cudaStagePassed = true;
      setStageState("cuda", "done");
      document.getElementById("ready-links-box").hidden = false;
      document.getElementById("monitor-subtitle").textContent = "CUDA 13.0 проверена успешно. Запуск интерфейса...";
    }

    if (line.includes("Starting ComfyUI") || line.includes("To see the GUI go to:") || line.includes("ComfyUI is ready")) {
      setStageState("ready", "done");
      document.getElementById("monitor-spinner").hidden = true;
      document.getElementById("ready-links-box").hidden = false;
      document.getElementById("monitor-subtitle").textContent = "ComfyUI готов к работе!";
      showMonitorAlert("ComfyUI успешно запущен и готов к работе!", "success");
    }
  }
}

async function pollHealth(podId) {
  if (state.redeployInProgress || state.activePodId !== podId) return;
  try {
    const pod = await runpodFetch(`/pods/${encodeURIComponent(podId)}`);
    if (!pod || state.activePodId !== podId) return;

    if (pod.runtime) {
      setStageState("provision", "done");
      setStageState("container", "done");
      document.getElementById("ready-links-box").hidden = false;
    }

    if (pod.status === "ERROR" || pod.status === "EXITED") {
      triggerRedeploy(podId, `Статус пода: ${pod.status}`);
      return;
    }

    try {
      const statsRes = await fetch(`https://${podId}-7860.proxy.runpod.net/system_stats`, { cache: "no-store" });
      if (statsRes.ok) {
        state.cudaStagePassed = true;
        setStageState("cuda", "done");
        setStageState("ready", "done");
        document.getElementById("monitor-spinner").hidden = true;
        document.getElementById("ready-links-box").hidden = false;
        document.getElementById("monitor-subtitle").textContent = "ComfyUI доступен на порту 7860!";
      }
    } catch {}
  } catch {}
}

async function triggerRedeploy(badPodId, reason) {
  if (state.redeployInProgress) return;
  state.redeployInProgress = true;

  const autoRedeploy = document.getElementById("opt-auto-redeploy").checked;
  if (!autoRedeploy) {
    showMonitorAlert(`Ошибка пода (${reason}). Повторные попытки отключены чекбоксом.`, "error");
    document.getElementById("monitor-spinner").hidden = true;
    return;
  }

  showMonitorAlert(
    `Обнаружена проблема: ${reason}. Запускаем новый под ПЕРЕД удалением сбойного хоста, чтобы гарантированно не попасть на тот же...`,
    "warn"
  );

  const queue = state.activeDeploySpec || getSelectedCandidatesQueue();
  state.redeployInProgress = false;
  // Pass badPodId to be deleted only AFTER new pod successfully starts!
  await startDeploymentSequence(queue, badPodId);
}

function getSelectedCandidatesQueue() {
  const maxPrice = Number.parseFloat(document.getElementById("max-price-slider").value) || 1.0;
  return state.catalogRows.filter((r) => {
    if (r.price > maxPrice) return false;
    if (!isGpuDesiredByUser(r)) return false;
    if (r.availability === "NONE") return false;
    if (state.secureOnly && r.cloud !== "SECURE") return false;
    if (state.minNetSpeedMbps > 0 && r.netSpeedMbps < state.minNetSpeedMbps) return false;
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
    // Only refresh if tab is visible and API key is set
    if (!document.hidden && state.apiKey && !state.redeployInProgress) {
      fetchGpuCatalog(true);
      fetchActivePods();
    }
  }, CATALOG_AUTO_REFRESH_MS);

  // Immediate refresh on visibility change (when tab is focused again)
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

function init() {
  initThemeToggle();

  // Price Slider
  const slider = document.getElementById("max-price-slider");
  const priceVal = document.getElementById("max-price-val");
  const onPriceChange = () => {
    const val = Number.parseFloat(slider.value).toFixed(2);
    priceVal.textContent = `${val} €/ч`;
    renderGpuTable();
  };
  slider.addEventListener("input", onPriceChange);

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
    document.getElementById("active-pods-section").hidden = true;
    document.getElementById("active-pods-list").replaceChildren();
    document.getElementById("gpu-tbody").replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-cell";
    td.textContent = "Ключ удален. Введите API ключ для подключения.";
    tr.appendChild(td);
    document.getElementById("gpu-tbody").appendChild(tr);
  });

  // Key Input Listener (auto-connect on valid key)
  const onKeyUpdated = async () => {
    const entered = keyInput.value.trim();
    if (entered.length >= 20 && entered !== state.apiKey) {
      state.apiKey = entered;
      localStorage.setItem(STORAGE_KEYS.API_KEY, entered);
      await Promise.all([fetchActivePods(), fetchGpuCatalog()]);
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

  // Network Speed Filter
  const selectNetSpeed = document.getElementById("select-net-speed");
  const savedSpeed = localStorage.getItem(STORAGE_KEYS.NET_SPEED);
  if (savedSpeed) {
    selectNetSpeed.value = savedSpeed;
    state.minNetSpeedMbps = savedSpeed === "ALL" ? 0 : Number(savedSpeed);
  }

  selectNetSpeed.addEventListener("change", () => {
    const val = selectNetSpeed.value;
    state.minNetSpeedMbps = val === "ALL" ? 0 : Number(val);
    localStorage.setItem(STORAGE_KEYS.NET_SPEED, val);
    renderGpuTable();
  });

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
      alert("Нет доступных видеокарт среди выбранных по текущим фильтрам (цена, Secure, скорость сети). Увеличьте ползунок цены или выберите другие карты.");
      return;
    }
    startDeploymentSequence(queue);
  });

  // Refresh Pods
  document.getElementById("refresh-pods-btn").addEventListener("click", () => fetchActivePods());

  // Terminate Monitored Pod
  document.getElementById("terminate-monitored-btn").addEventListener("click", async () => {
    const podId = state.activePodId;
    if (!podId) return;
    if (!confirm(`Точно удалить под ${podId}?`)) return;
    stopMonitor();
    try {
      await runpodFetch(`/pods/${encodeURIComponent(podId)}`, { method: "DELETE" });
      document.getElementById("monitor-section").hidden = true;
      state.activePodId = null;
      await fetchActivePods();
    } catch (err) {
      alert(`Ошибка при удалении: ${err.message}`);
    }
  });

  // Start background auto-refresh loop
  startAutoRefreshLoop();

  // Auto-load if key was saved
  const savedKey = localStorage.getItem(STORAGE_KEYS.API_KEY);
  if (savedKey) {
    state.apiKey = savedKey;
    keyInput.value = savedKey;
    fetchActivePods();
    fetchGpuCatalog();
  }
}

document.addEventListener("DOMContentLoaded", init);
