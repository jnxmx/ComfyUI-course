import {
  GPU_PRIORITY_TIERS,
  getGpuArchitecture,
  GPU_POWER_RATINGS,
  GPU_BENCHMARK_ORDER,
  buildSegmentedPowerBars,
  isAnomalousGpuPrice,
  isRecommendedGpu
} from "./gpu_data.js?v=20261124_01";

/**
 * course.yakushev.fr/deploy — Comfy.Work RunPod Deployer (Web Direct)
 * Zero-backend: Direct browser fetch to https://api.runpod.io/v2
 */

const RUNPOD_API_BASE = "https://api.runpod.io/v2";
const CATALOG_AUTO_REFRESH_MS = 12000;

const PRICE_STEPS = Object.freeze([
  ...Array.from({ length: 29 }, (_, i) => Number((0.2 + i * 0.05).toFixed(2))),
  2.0,
  3.0
]);
const DEFAULT_PRICE_STEP_INDEX = 20; // 1.20 $/ч

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

function buildGpuSortOrder() {
  const benchmarkRank = new Map();
  GPU_BENCHMARK_ORDER.forEach((id, i) => benchmarkRank.set(id, i + 1));

  const oldList = [];
  for (const tier of GPU_PRIORITY_TIERS) {
    for (const gpuId of tier.gpuIds) oldList.push(gpuId);
  }

  const tableSlots = [];
  const tableGpuIds = [];
  oldList.forEach((gpuId, index) => {
    if (benchmarkRank.has(gpuId)) {
      tableSlots.push(index);
      tableGpuIds.push(gpuId);
    }
  });
  tableGpuIds.sort((a, b) => benchmarkRank.get(a) - benchmarkRank.get(b));

  const order = {};
  oldList.forEach((gpuId, index) => {
    order[gpuId] = index;
  });
  tableGpuIds.forEach((gpuId, i) => {
    order[gpuId] = tableSlots[i];
  });

  return Object.freeze(order);
}

const GPU_SORT_ORDER = buildGpuSortOrder();

const AVAILABILITY_WEIGHT = Object.freeze({
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  NONE: 0
});

const STORAGE_KEYS = Object.freeze({
  API_KEY: "yakushev_runpod_api_key_v1",
  CUSTOM_TEMPLATE_ID: "yakushev_custom_template_id_v2",
  SELECTED_ROWS: "yakushev_selected_gpus_v3",
  SECURE_ONLY: "yakushev_secure_only_v1",
  SHOW_UNAVAILABLE: "yakushev_show_unavailable_v1",
  MIN_RAM: "yakushev_min_ram_gb_v1",
  MAX_PRICE: "yakushev_max_price_v3",
  OPTIONS: "yakushev_options_v4",
  OUR_POD_IDS: "yakushev_our_pod_ids_v1",
  POD_LAUNCH_META: "yakushev_pod_launch_meta_v1",
  HAD_KEY_HINT: "yakushev_had_key_hint_v1"
});

const DEFAULT_MAX_RANK = 8;

const state = {
  apiKey: "",
  statusLoaded: true,
  hasApiKey: false,
  maskedKey: "",
  accountEmail: "",
  apiKeyInfo: null,
  initialPodsLoaded: false,
  initialProfileLoaded: false,
  catalogRows: [],
  userSelectionOverrides: new Map(),
  secureOnly: false,
  showUnavailable: false,
  minRamGb: 0,
  activePods: [],
  podControllers: new Map(),
  currentTemplate: { ...DEFAULT_TEMPLATE },
  accountSecrets: [],
  ourPodIds: new Set(),
  heldBadPodIds: new Set(),
  redeployTriggeredPodIds: new Set(),
  deployCreateInFlight: false,
  currentDeploySessionId: null,
  redeployCount: 0,
  redeployInProgress: false,
  isTransitioningToPod: false,
  isFetchingCatalog: false,
  catalogFetchPromise: null,
  catalogFetchStartedAt: 0,
  catalogLastFetchedAt: 0,
  catalogRefreshTimerId: null,
  ipGeoCache: new Map(),
  apiKeyPermissionErrors: new Map(),
  heldRetryInfo: null
};

/* ==========================================================================
   1. Bridge Helpers, Theme & Preferences
   ========================================================================== */

async function openExternalUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function initExternalLinkDelegation() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".btn-split-group")) {
      document.querySelectorAll(".btn-split-group.is-open").forEach((grp) => {
        grp.classList.remove("is-open");
        const menu = grp.querySelector(".btn-split-menu");
        if (menu) menu.hidden = true;
        const caret = grp.querySelector(".btn-split-caret");
        if (caret) caret.setAttribute("aria-expanded", "false");
      });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".btn-split-group.is-open").forEach((grp) => {
        grp.classList.remove("is-open");
        const menu = grp.querySelector(".btn-split-menu");
        if (menu) menu.hidden = true;
        const caret = grp.querySelector(".btn-split-caret");
        if (caret) caret.setAttribute("aria-expanded", "false");
      });
    }
  });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function connectToPod(ctrl) {
  if (!ctrl?.podId) return;
  window.open(`https://${ctrl.podId}-7860.proxy.runpod.net/`, "_blank", "noopener,noreferrer");
}

function cleanGpuName(rawId, rawName) {
  if (rawName && rawName.trim()) {
    return rawName.replace(/^NVIDIA\s+(GeForce\s+)?/, "").trim();
  }
  return (rawId || "").replace(/^NVIDIA\s+(GeForce\s+)?/, "").trim();
}

function getShortPodGpuName(gpuId, rawName) {
  if (gpuId && Array.isArray(state.catalogRows) && state.catalogRows.length > 0) {
    const match = state.catalogRows.find((r) => r.gpuId === gpuId);
    if (match?.displayName) return match.displayName;
  }
  return cleanGpuName(gpuId, rawName)
    .replace(/\s+Blackwell\s+Server\s+Edition/i, "")
    .replace(/\s+Blackwell\s+Workstation\s+Edition/i, " WK")
    .trim();
}

function normalizeMinRamGb(value) {
  const num = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(65536, num);
}

function getMaxPriceFromSlider() {
  const slider = document.getElementById("max-price-slider");
  if (!slider) return PRICE_STEPS[DEFAULT_PRICE_STEP_INDEX];
  const idx = Number.parseInt(slider.value, 10);
  if (Number.isFinite(idx) && idx >= 0 && idx < PRICE_STEPS.length) {
    return PRICE_STEPS[idx];
  }
  return PRICE_STEPS[DEFAULT_PRICE_STEP_INDEX];
}

function findClosestPriceStepIndex(rawPrice) {
  const price = Number.parseFloat(rawPrice);
  if (!Number.isFinite(price)) return DEFAULT_PRICE_STEP_INDEX;
  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < PRICE_STEPS.length; i += 1) {
    const diff = Math.abs(PRICE_STEPS[i] - price);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function rowFailsRamFilter(row, minRamGb) {
  if (minRamGb <= 0) return false;
  return !row.minRam || row.minRam < minRamGb;
}

function getRowFilterBucket(row, maxPrice, minRamGb) {
  if (row.price > maxPrice) return 2;
  if (rowFailsRamFilter(row, minRamGb)) return 1;
  return 0;
}

function saveOptions() {
  const newManager = document.getElementById("opt-new-manager")?.checked ?? true;
  const restoreBackup = document.getElementById("opt-restore-backup")?.checked ?? true;
  const autoRedeploy = document.getElementById("opt-auto-redeploy")?.checked ?? true;
  const shutdownTimer = document.getElementById("opt-shutdown-timer")?.checked ?? true;
  const rawMinutes = parseInt(document.getElementById("opt-shutdown-minutes")?.value, 10);
  const shutdownMinutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 30;

  const data = { newManager, restoreBackup, autoRedeploy, shutdownTimer, shutdownMinutes };
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
  const mappedPort = pod?.portMappings?.[String(internalPort)] ?? pod?.portMappings?.[internalPort];
  if (pod?.publicIp && mappedPort) {
    return { ip: pod.publicIp, port: mappedPort, url: `http://${pod.publicIp}:${mappedPort}` };
  }
  const ports = pod?.runtime?.ports;
  if (Array.isArray(ports)) {
    const targetPort = Number(internalPort);
    const matches = ports.filter((pt) => {
      const priv = Number(pt?.private ?? pt?.privatePort);
      const pub = Number(pt?.public ?? pt?.publicPort);
      const ptype = String(pt?.type || "").toLowerCase();
      return priv === targetPort && Boolean(pt?.ip) && Number.isFinite(pub) && pub > 0 && (ptype === "tcp" || ptype === "http");
    });
    const preferred =
      matches.find((pt) => String(pt.type || "").toLowerCase() === "tcp" && !String(pt.ip).startsWith("100.")) ||
      matches.find((pt) => String(pt.type || "").toLowerCase() === "tcp") ||
      matches[0];
    if (preferred) {
      const pubPort = preferred.public ?? preferred.publicPort;
      return { ip: preferred.ip, port: pubPort, url: `http://${preferred.ip}:${pubPort}` };
    }
  }
  return null;
}

/* ==========================================================================
   2. RunPod API Proxy Client, GraphQL Balance & Secrets
   ========================================================================== */

function getScopeLabelForPath(path) {
  if (path.startsWith("/account/secrets")) return "Secrets (Read)";
  if (path.startsWith("/templates/")) return "Templates (Read)";
  if (path.startsWith("/catalog/")) return "Catalog (Read)";
  if (path.startsWith("/pods")) return "Pods (Read + Write)";
  return "REST API";
}

function formatRussianDays(days) {
  const n = Math.abs(Math.trunc(Number(days) || 0));
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} дней`;
  if (mod10 === 1) return `${n} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} дня`;
  return `${n} дней`;
}

function formatKeyExpiryInfo(keyInfo) {
  if (!keyInfo || typeof keyInfo !== "object") return null;
  if (!keyInfo.expiresAt) {
    return {
      text: "Бессрочный",
      daysText: "Бессрочно",
      shortText: "",
      expired: false,
      expiringSoon: false
    };
  }
  const ms = Date.parse(keyInfo.expiresAt);
  if (!Number.isFinite(ms)) return null;
  const fullDate = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(ms).replace(/\s?г\.?$/, "");
  const shortDate = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  }).format(ms);
  const daysLeft = Math.ceil((ms - Date.now()) / 86400000);
  if (daysLeft <= 0) {
    return {
      text: `Истёк ${fullDate}`,
      daysText: "Истёк",
      shortText: "истёк",
      expired: true,
      expiringSoon: true
    };
  }
  return {
    text: `До ${fullDate} (${daysLeft} дн.)`,
    daysText: formatRussianDays(daysLeft),
    shortText: `ключ до ${shortDate}`,
    expired: false,
    expiringSoon: daysLeft <= 7
  };
}

function updateSavedKeyExpiryUI() {
  const el = document.getElementById("saved-key-expiry");
  if (!el) return;
  if (!state.hasApiKey || !state.apiKeyInfo) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("is-expiring");
    return;
  }
  const info = formatKeyExpiryInfo(state.apiKeyInfo);
  if (!info || !info.shortText) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("is-expiring");
    return;
  }
  el.textContent = info.shortText;
  el.title = state.apiKeyInfo.name
    ? `${state.apiKeyInfo.name}: ${info.text}`
    : info.text;
  el.classList.toggle("is-expiring", Boolean(info.expiringSoon));
  el.classList.toggle("is-expired", Boolean(info.expired));
  el.hidden = false;
}

function updateApiKeyRequirementsBanner() {
  const onboardingScreen = document.getElementById("auth-onboarding");
  const dashboardMain = document.getElementById("dashboard-main");
  const authCard = document.getElementById("auth-card");
  const box = document.getElementById("api-key-requirements");
  const titleEl = document.getElementById("api-key-req-title");
  const errorsEl = document.getElementById("api-key-req-errors");
  const savedBadge = document.getElementById("saved-key-badge");
  const keyInput = document.getElementById("runpod-api-key");
  const authLoadingEl = document.getElementById("auth-loading");
  const authInputRow = document.getElementById("auth-input-row");
  const headerLinks = document.getElementById("auth-header-links");
  const forgetBtn = document.getElementById("forget-key-btn");

  let hadKeyHint = false;
  try {
    hadKeyHint = localStorage.getItem(STORAGE_KEYS.HAD_KEY_HINT) === "1";
  } catch {}

  const showOnboarding = state.statusLoaded && !state.hasApiKey;
  const showDashboard = state.hasApiKey || (!state.statusLoaded && hadKeyHint);
  const waitingProfile = !state.initialProfileLoaded && showDashboard;
  if (onboardingScreen) onboardingScreen.hidden = !showOnboarding;
  if (dashboardMain) dashboardMain.hidden = !showDashboard;

  const isSaved = state.statusLoaded && state.hasApiKey;
  if (authCard) {
    authCard.hidden = waitingProfile;
    authCard.classList.toggle("has-saved-key", isSaved);
  }
  const podsSectionEl = document.getElementById("pods-section");
  if (podsSectionEl) {
    podsSectionEl.hidden = waitingProfile || !state.hasApiKey || !state.initialPodsLoaded;
  }
  if (waitingProfile) {
    setBalanceLoading(true);
  }
  if (authLoadingEl) authLoadingEl.hidden = state.statusLoaded;
  if (authInputRow) authInputRow.hidden = !state.statusLoaded || isSaved;
  if (headerLinks) headerLinks.hidden = !state.statusLoaded || isSaved;
  if (forgetBtn) forgetBtn.hidden = !isSaved;

  if (savedBadge) {
    savedBadge.hidden = true;
    savedBadge.textContent = "✓";
    savedBadge.title = state.maskedKey ? `API-ключ сохранён (${state.maskedKey})` : "API-ключ сохранён локально";
  }
  updateSavedKeyExpiryUI();
  if (keyInput) {
    keyInput.placeholder = "rpa_...";
  }

  if (!box || !titleEl || !errorsEl) return;
  if (state.isTransitioningToPod || !state.statusLoaded) {
    box.hidden = true;
    return;
  }

  if (!state.hasApiKey) {
    box.hidden = false;
    box.classList.remove("is-error");
    titleEl.textContent = "Требования к API-ключу RunPod";
    errorsEl.hidden = true;
    errorsEl.textContent = "";
    return;
  }

  if (state.apiKeyPermissionErrors.size > 0) {
    box.hidden = false;
    box.classList.add("is-error");
    const has401 = Array.from(state.apiKeyPermissionErrors.values()).some((code) => code === 401);
    titleEl.textContent = has401
      ? "API-ключ RunPod недействителен или отклонён (HTTP 401)"
      : "У API-ключа RunPod не хватает разрешений";
    const missingList = Array.from(state.apiKeyPermissionErrors.entries())
      .map(([scope, code]) => `${scope} (HTTP ${code})`)
      .join(", ");
    errorsEl.textContent = `Отсутствует доступ: ${missingList}`;
    errorsEl.hidden = false;
    return;
  }

  box.hidden = true;
  box.classList.remove("is-error");
  errorsEl.hidden = true;
  errorsEl.textContent = "";
}

function setApiKeyPermissionError(scope, status) {
  if (!scope || state.isTransitioningToPod) return;
  const prev = state.apiKeyPermissionErrors.get(scope);
  if (prev !== status) {
    state.apiKeyPermissionErrors.set(scope, status);
    updateApiKeyRequirementsBanner();
  }
}

function clearApiKeyPermissionError(scope) {
  if (!scope) return;
  if (state.apiKeyPermissionErrors.delete(scope)) {
    updateApiKeyRequirementsBanner();
  }
}

async function runpodFetch(path, options = {}) {
  if (!state.apiKey) {
    throw new Error("Не указан RunPod API Secret Key.");
  }
  const { timeoutMs: customTimeoutMs, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("Authorization", `Bearer ${state.apiKey}`);
  if (fetchOptions.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutMs = customTimeoutMs ?? (String(fetchOptions.method || "GET").toUpperCase() === "POST" ? 25000 : 12000);
  const controller = new AbortController();
  const externalSignal = fetchOptions.signal;
  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });
  }
  const timerId = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);

  let response;
  try {
    response = await fetch(`${RUNPOD_API_BASE}${path}`, {
      cache: "no-store",
      ...fetchOptions,
      headers,
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`Таймаут запроса к RunPod API (${Math.round(timeoutMs / 1000)} сек)`);
    }
    throw err;
  } finally {
    clearTimeout(timerId);
  }

  const scopeLabel = getScopeLabelForPath(path);
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      detail = errJson.message || errJson.error || errJson.detail || JSON.stringify(errJson);
    } catch {
      try { detail = await response.text(); } catch {}
    }
    const isRemoteTransition = state.isTransitioningToPod || String(detail).toLowerCase().includes("remote pod");
    if ((response.status === 401 || response.status === 403) && !isRemoteTransition) {
      setApiKeyPermissionError(scopeLabel, response.status);
    }
    throw new Error(`Ошибка RunPod (${response.status}): ${detail}`);
  }

  clearApiKeyPermissionError(scopeLabel);
  if (response.status === 204) return null;
  return response.json();
}

function updateBalanceUserNameUI() {
  const userEl = document.getElementById("balance-user-name");
  if (!userEl) return;
  const email = typeof state.accountEmail === "string" ? state.accountEmail.trim() : "";
  userEl.textContent = email;
  userEl.title = email;
  userEl.hidden = !email;
}

function setBalanceLoading(isLoading) {
  let hadKeyHint = false;
  try {
    hadKeyHint = localStorage.getItem(STORAGE_KEYS.HAD_KEY_HINT) === "1";
  } catch {}
  const waitingProfile = !state.initialProfileLoaded && (state.hasApiKey || (!state.statusLoaded && hadKeyHint));
  const showSpinner = Boolean(isLoading || waitingProfile);
  const loadingEl = document.getElementById("balance-loading");
  const metricsEl = document.getElementById("balance-metrics");
  if (loadingEl) loadingEl.hidden = !showSpinner;
  if (metricsEl) metricsEl.hidden = showSpinner;
}

async function fetchBalance() {
  return;
}

async function _unusedFetchBalance() {
  if (state.isTransitioningToPod || !state.statusLoaded) return;
  const amountEl = document.getElementById("balance-amount");
  const etaEl = document.getElementById("balance-eta");
  const errEl = document.getElementById("balance-error");
  if (!amountEl || !etaEl) return;

  if (!state.hasApiKey) {
    state.accountEmail = "";
    updateBalanceUserNameUI();
    amountEl.textContent = "—";
    amountEl.classList.remove("is-low", "is-critical");
    if (errEl) errEl.hidden = true;
    etaEl.textContent = "Укажите API-ключ для загрузки баланса";
    etaEl.title = "";
    setBalanceLoading(false);
    return;
  }

  try {
    const res = await fetch(`${BRIDGE_BASE}/balance`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (state.isTransitioningToPod) return;
    if (!res.ok) {
      const errMsg = String(data.error || "");
      if (errMsg.toLowerCase().includes("remote pod")) return;
      if (res.status === 401 || res.status === 403) {
        setApiKeyPermissionError("GraphQL API (Read)", res.status);
      }
      setBalanceLoading(false);
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = errMsg || `Ошибка загрузки баланса (HTTP ${res.status})`;
      }
      return;
    }

    clearApiKeyPermissionError("GraphQL API (Read)");
    if (errEl) errEl.hidden = true;

    if (typeof data.email === "string" && data.email.trim()) {
      state.accountEmail = data.email.trim();
    }
    if (data.keyInfo && typeof data.keyInfo === "object") {
      state.apiKeyInfo = data.keyInfo;
      updateSavedKeyExpiryUI();
    }
    updateBalanceUserNameUI();

    const balance = Number(data.clientBalance);
    const spend = Number(data.currentSpendPerHr);

    if (Number.isFinite(balance)) {
      amountEl.textContent = `$${balance.toFixed(2)}`;
      amountEl.classList.toggle("is-critical", balance < 1.5);
      amountEl.classList.toggle("is-low", balance >= 1.5 && balance < 5.0);
    } else {
      amountEl.textContent = "—";
      amountEl.classList.remove("is-low", "is-critical");
    }

    if (Number.isFinite(spend) && spend > 0) {
      etaEl.textContent = `Текущий расход: $${spend.toFixed(2)}/ч`;
      if (Number.isFinite(balance) && balance > 0) {
        const totalMins = Math.floor((balance / spend) * 60);
        const hrs = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        etaEl.title = hrs > 0
          ? `Хватит примерно на ${hrs} ч ${mins} мин`
          : `Хватит примерно на ${mins} мин`;
      } else {
        etaEl.title = "";
      }
    } else {
      etaEl.textContent = "Текущий расход: $0.00/ч";
      etaEl.title = "";
    }
    setBalanceLoading(false);
  } catch (err) {
    if (state.isTransitioningToPod) return;
    setBalanceLoading(false);
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = `Сеть: ${err.message}`;
    }
  }
}

async function fetchAccountInfo() {
  if (!state.hasApiKey) return;
  const panel = document.getElementById("account-info-panel");
  if (panel) panel.hidden = false;

  const [secretsRes, accountRes] = await Promise.allSettled([
    runpodFetch("/account/secrets"),
    state.accountEmail ? Promise.resolve(null) : runpodFetch("/account")
  ]);

  if (secretsRes.status === "fulfilled") {
    state.accountSecrets = Array.isArray(secretsRes.value?.secrets) ? secretsRes.value.secrets : [];
  } else {
    console.debug("fetch secrets:", secretsRes.reason?.message);
    state.accountSecrets = [];
  }

  if (accountRes.status === "fulfilled" && accountRes.value && !state.accountEmail) {
    const rawEmail = accountRes.value.email || accountRes.value.username || accountRes.value.name || "";
    if (typeof rawEmail === "string" && rawEmail.trim()) {
      state.accountEmail = rawEmail.trim();
      updateBalanceUserNameUI();
    }
  }

  updateAccountBadges();
}

const RUNPOD_SECRETS_CREATE_URL = "https://console.runpod.io/user/credentials?tab=secrets";

function updateSecretPillElement(el, label, isConfigured, secretObj) {
  if (!el) return;
  el.className = isConfigured ? "secret-pill secret-ok" : "secret-pill secret-missing";
  if (el.tagName === "A") {
    el.href =
      isConfigured && secretObj?.id
        ? `https://console.runpod.io/user/secrets/${encodeURIComponent(secretObj.id)}`
        : RUNPOD_SECRETS_CREATE_URL;
  }
  el.title = isConfigured
    ? `Редактировать ${label} в RunPod`
    : `Создать ${label} в RunPod`;
  const stateSpan = el.querySelector(".secret-state");
  if (stateSpan) {
    stateSpan.textContent = "✓";
  }
}

function updateAccountBadges() {
  const hfEl = document.getElementById("status-hf-token");
  const civitaiEl = document.getElementById("status-civitai-token");
  const backupEl = document.getElementById("status-backup");

  const secretsByName = new Map();
  for (const s of state.accountSecrets || []) {
    const key = String(s?.name || "").trim().toUpperCase();
    if (key) secretsByName.set(key, s);
  }
  const templateEnv = state.currentTemplate?.env || {};

  const hfSecret = secretsByName.get("HF_TOKEN") || secretsByName.get("HD_TOKEN") || null;
  const isHfConfigured = Boolean(hfSecret || templateEnv.HF_TOKEN || templateEnv.HD_TOKEN);
  updateSecretPillElement(hfEl, "HF_TOKEN", isHfConfigured, hfSecret);

  const civitaiSecret = secretsByName.get("CIVITAI_API_KEY") || null;
  const isCivitaiConfigured = Boolean(civitaiSecret || templateEnv.CIVITAI_API_KEY);
  updateSecretPillElement(civitaiEl, "CIVITAI_API_KEY", isCivitaiConfigured, civitaiSecret);

  const backupSecret = secretsByName.get("COMFYUI_BACKUP") || null;
  const isBackupConfigured = Boolean(backupSecret || templateEnv.COMFYUI_BACKUP);
  updateSecretPillElement(backupEl, "COMFYUI_BACKUP", isBackupConfigured, backupSecret);
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

async function persistCustomTemplateId(templateId) {
  try {
    if (templateId) localStorage.setItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID, templateId);
    else localStorage.removeItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID);
  } catch {}
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
      await persistCustomTemplateId(cleanId);
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
      name: cleanId === DEFAULT_TEMPLATE.templateId ? DEFAULT_TEMPLATE.name : `Темплейт ${cleanId}`
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
  const tplId = state.currentTemplate.templateId || "casls01eko";
  if (nameEl) {
    nameEl.textContent = state.currentTemplate.name || "comfy.work";
    if (nameEl.tagName === "A") {
      nameEl.href = `https://console.runpod.io/hub/template/${encodeURIComponent(tplId)}?id=${encodeURIComponent(tplId)}`;
    }
  }
  if (badgeEl) badgeEl.textContent = tplId;
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

  const closeModal = () => {
    form.hidden = true;
    if (msgEl) msgEl.hidden = true;
  };

  editBtn.addEventListener("click", () => {
    form.hidden = false;
    if (input) {
      input.value = state.currentTemplate.templateId;
      input.focus();
      input.select();
    }
    if (msgEl) msgEl.hidden = true;
  });

  cancelBtn.addEventListener("click", closeModal);
  document.getElementById("template-modal-close")?.addEventListener("click", closeModal);
  form.addEventListener("click", (e) => {
    if (e.target === form) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !form.hidden) closeModal();
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
    await persistCustomTemplateId(null);
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

function getGpuSortOrder(gpuId, tier) {
  if (!tier) return 99;
  return GPU_SORT_ORDER[gpuId] ?? tier.rank;
}

async function fetchGpuCatalog(silent = false) {
  if (!state.hasApiKey) return;

  if (state.catalogFetchPromise && Date.now() - state.catalogFetchStartedAt < 14000) {
    return state.catalogFetchPromise;
  }

  state.isFetchingCatalog = true;
  state.catalogFetchStartedAt = Date.now();

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

  const fetchTask = (async () => {
    try {
      const [communityRes, secureRes] = await Promise.all([
        runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=COMMUNITY"),
        runpodFetch("/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE")
      ]);

      const rows = [];
      const processList = (gpus, cloudType) => {
        if (!Array.isArray(gpus)) return;
        for (const gpu of gpus) {
          const price = cloudType === "COMMUNITY" ? gpu.price?.community : gpu.price?.secure;
          if (price === null || price === undefined || price <= 0) continue;
          if (isAnomalousGpuPrice(gpu.id, price)) continue;

          const isUnavailable = !gpu.availability || gpu.availability === "NONE";
          const cuda13List = (gpu.cudaVersions || [])
            .filter((c) => Number.parseFloat(c.version) >= 13.0 && (isUnavailable || c.available))
            .map((c) => c.version);

          if (!isUnavailable && cuda13List.length === 0) continue;
          if (isUnavailable && (gpu.cudaVersions || []).length > 0 && cuda13List.length === 0) continue;

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
            vramGb: Number.isFinite(gpu.memory) ? gpu.memory : null,
            minRam: Number.isFinite(gpu.minRam) ? gpu.minRam : null,
            cudaVersions: cuda13List,
            tierRank: tier ? tier.rank : 99,
            sortOrder: getGpuSortOrder(gpu.id, tier),
            tierKey: tier ? tier.key : `other-${gpu.id}`,
            tierLabel: tier ? tier.label : displayName,
            subRank: tier ? tier.subRank : 99
          });
        }
      };

      processList(communityRes?.gpus, "COMMUNITY");
      processList(secureRes?.gpus, "SECURE");

      rows.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        if (a.subRank !== b.subRank) return a.subRank - b.subRank;

        const cloudScoreA = a.cloud === "COMMUNITY" ? 0 : 1;
        const cloudScoreB = b.cloud === "COMMUNITY" ? 0 : 1;
        if (cloudScoreA !== cloudScoreB) return cloudScoreA - cloudScoreB;

        const availDiff = (AVAILABILITY_WEIGHT[b.availability] || 0) - (AVAILABILITY_WEIGHT[a.availability] || 0);
        if (availDiff !== 0) return availDiff;

        return a.price - b.price;
      });

      state.catalogRows = rows;
      state.catalogLastFetchedAt = Date.now();
      initDefaultSelections();
      renderGpuTable();
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
      if (state.catalogFetchPromise === fetchTask) {
        state.catalogFetchPromise = null;
        state.isFetchingCatalog = false;
      }
    }
  })();

  state.catalogFetchPromise = fetchTask;
  return fetchTask;
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

function updateSelectedGpuCount() {
  const el = document.getElementById("selected-gpu-count");
  if (!el) return;
  const tbody = document.getElementById("gpu-tbody");
  const count = tbody ? tbody.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').length : 0;
  el.textContent = `Выбрано: ${count}`;
}

function renderGpuTable() {
  const tbody = document.getElementById("gpu-tbody");
  tbody.replaceChildren();

  const maxPrice = getMaxPriceFromSlider();
  const minRamGb = normalizeMinRamGb(state.minRamGb);

  let displayRows = [...state.catalogRows];
  if (state.secureOnly) {
    displayRows = displayRows.filter((r) => r.cloud === "SECURE");
  }
  if (!state.showUnavailable) {
    displayRows = displayRows.filter((r) => r.availability !== "NONE");
  }

  const gpuColCount = state.showUnavailable ? 5 : 4;

  if (displayRows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = gpuColCount;
    td.className = "empty-cell";
    td.textContent = state.hasApiKey ? "Нет видеокарт по выбранным фильтрам" : "Введите API ключ слева для загрузки";
    tr.appendChild(td);
    tbody.appendChild(tr);
    updateSelectedGpuCount();
    return;
  }

  displayRows.sort((a, b) => {
    const bucketDiff = getRowFilterBucket(a, maxPrice, minRamGb) - getRowFilterBucket(b, maxPrice, minRamGb);
    if (bucketDiff !== 0) return bucketDiff;

    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.subRank !== b.subRank) return a.subRank - b.subRank;

    const cloudScoreA = a.cloud === "COMMUNITY" ? 0 : 1;
    const cloudScoreB = b.cloud === "COMMUNITY" ? 0 : 1;
    if (cloudScoreA !== cloudScoreB) return cloudScoreA - cloudScoreB;

    const availDiff = (AVAILABILITY_WEIGHT[b.availability] || 0) - (AVAILABILITY_WEIGHT[a.availability] || 0);
    if (availDiff !== 0) return availDiff;

    return a.price - b.price;
  });

  let addedRamDivider = false;
  let addedPriceDivider = false;
  let inOtherSection = false;
  let inOtherRamSection = false;
  let inOtherOverpricedSection = false;

  const appendDivider = (text, extraClass = "") => {
    const divTr = document.createElement("tr");
    divTr.className = `table-divider-row ${extraClass}`.trim();
    const divTd = document.createElement("td");
    divTd.colSpan = gpuColCount;
    divTd.textContent = text;
    divTr.appendChild(divTd);
    tbody.appendChild(divTr);
  };

  for (const row of displayRows) {
    const exceedsPrice = row.price > maxPrice;
    const failsRam = rowFailsRamFilter(row, minRamGb);
    const failsFilter = exceedsPrice || failsRam;
    const isDesired = isGpuDesiredByUser(row);

    if (!exceedsPrice && failsRam && !addedRamDivider) {
      addedRamDivider = true;
      appendDivider("Не подходит под фильтр RAM", "table-divider-ram");
    }
    if (exceedsPrice && !addedPriceDivider) {
      addedPriceDivider = true;
      appendDivider("Дороже фильтра цены", "table-divider-price");
    }
    if (!failsFilter && row.tierRank === 99 && !inOtherSection) {
      inOtherSection = true;
      appendDivider("Нерекомендуемые");
    }
    if (!exceedsPrice && failsRam && row.tierRank === 99 && !inOtherRamSection) {
      inOtherRamSection = true;
      appendDivider("Нерекомендуемые");
    }
    if (exceedsPrice && row.tierRank === 99 && !inOtherOverpricedSection) {
      inOtherOverpricedSection = true;
      appendDivider("Нерекомендуемые");
    }

    const tr = document.createElement("tr");
    tr.dataset.rowId = row.rowId;
    if (failsFilter) tr.classList.add("row-exceeds-price");

    let mismatchReason = "";
    if (exceedsPrice && failsRam) {
      mismatchReason = `Превышает лимит ${maxPrice.toFixed(2)} $/ч и меньше фильтра RAM (${minRamGb} ГБ).`;
    } else if (exceedsPrice) {
      mismatchReason = `Превышает лимит ${maxPrice.toFixed(2)} $/ч.`;
    } else if (failsRam) {
      mismatchReason = `Доступная RAM ниже фильтра ${minRamGb} ГБ.`;
    }

    const isChecked = !failsFilter && isDesired;
    tr.classList.toggle("is-selected", state.showUnavailable && isChecked);

    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = isChecked;
    chk.disabled = failsFilter;
    if (mismatchReason) chk.title = mismatchReason;
    chk.addEventListener("change", () => {
      state.userSelectionOverrides.set(row.rowId, chk.checked);
      tr.classList.toggle("is-selected", state.showUnavailable && chk.checked);
      persistSelections();
      updateSelectedGpuCount();
    });
    tdCheck.appendChild(chk);

    if (!failsFilter && state.showUnavailable) {
      tr.classList.add("row-selectable");
      tr.addEventListener("click", (e) => {
        if (e.target.closest("input, button, a, label, .col-action")) return;
        chk.checked = !chk.checked;
        state.userSelectionOverrides.set(row.rowId, chk.checked);
        tr.classList.toggle("is-selected", chk.checked);
        persistSelections();
        updateSelectedGpuCount();
      });
    }

    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const nameWrap = document.createElement("div");
    nameWrap.className = "gpu-name-cell";

    const titleWrap = document.createElement("span");
    titleWrap.className = "gpu-title-wrap";

    if (row.gpuId === "NVIDIA GeForce RTX 4090" && row.cloud === "COMMUNITY") {
      const warnIcon = document.createElement("span");
      warnIcon.className = "gpu-broken-warn";
      warnIcon.title = "Часто проблемные хосты";
      warnIcon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9.5a5 5 0 0 1 10 0c0 1.8-.9 3-2 3.7V15H9v-1.8c-1.1-.7-2-1.9-2-3.7Z"/><circle cx="10.2" cy="9.5" r="1" fill="currentColor" stroke="none"/><circle cx="13.8" cy="9.5" r="1" fill="currentColor" stroke="none"/><path d="M5 21.5 19 17.5"/><path d="M5 17.5 19 21.5"/></svg>`;
      titleWrap.appendChild(warnIcon);
    }

    const recommended = isRecommendedGpu(row.gpuId, row.cloud);
    const isUnrecommendedSection = row.tierRank === 99;
    const titleSpan = document.createElement("span");
    titleSpan.className = isUnrecommendedSection ? "gpu-title-text is-unrecommended" : "gpu-title-text";
    titleSpan.textContent = row.displayName;
    titleWrap.appendChild(titleSpan);

    if (recommended) {
      const starSup = document.createElement("sup");
      starSup.className = "recommended-star";
      starSup.textContent = "★";
      starSup.title = "Рекомендуемая видеокарта";
      titleWrap.appendChild(starSup);
    }

    if (Number.isFinite(row.vramGb) && row.vramGb > 0) {
      const vramSup = document.createElement("sup");
      vramSup.className = "vram-sup";
      vramSup.textContent = `${Math.round(row.vramGb)} GB`;
      titleWrap.appendChild(vramSup);
    }

    const arch = getGpuArchitecture(row.gpuId, row.displayName);
    if (arch) {
      const archPill = document.createElement("sup");
      archPill.className = `arch-pill ${arch.tierClass}`;
      archPill.textContent = arch.label;
      archPill.title = arch.title;
      titleWrap.appendChild(archPill);
    }

    const pillsRow = document.createElement("div");
    pillsRow.className = "gpu-pills-row";

    const cloudPill = document.createElement("span");
    cloudPill.className = `cloud-pill ${row.cloud.toLowerCase()}`;
    cloudPill.textContent = row.cloud;
    pillsRow.appendChild(cloudPill);

    if (row.minRam && row.minRam > 0) {
      const ramPill = document.createElement("span");
      ramPill.className = "ram-pill";
      ramPill.textContent = `RAM от ${row.minRam} ГБ`;
      pillsRow.appendChild(ramPill);
    }

    nameWrap.append(titleWrap, pillsRow);
    tdName.appendChild(nameWrap);

    const tdPrice = document.createElement("td");
    tdPrice.className = "col-price";
    const priceText = document.createElement("span");
    priceText.className = "price-text";
    priceText.textContent = row.price.toFixed(2);
    const priceUnit = document.createElement("span");
    priceUnit.className = "price-unit";
    priceUnit.textContent = " $/ч";
    tdPrice.append(priceText, priceUnit);

    const tdPower = document.createElement("td");
    tdPower.className = "col-power";
    const rating = GPU_POWER_RATINGS[row.gpuId];
    if (rating) {
      tdPower.appendChild(buildSegmentedPowerBars(rating));
    }

    const tdAction = document.createElement("td");
    tdAction.className = "col-action";
    const isUnavailable = row.availability === "NONE";
    const launchBtn = document.createElement("button");
    launchBtn.type = "button";
    launchBtn.className = isUnavailable ? "btn btn-subtle-sm btn-hunt" : "btn btn-subtle-sm";
    launchBtn.textContent = isUnavailable ? "Охотиться" : "Запустить";
    launchBtn.disabled = failsFilter;
    if (mismatchReason) launchBtn.title = mismatchReason;
    launchBtn.addEventListener("click", () => {
      startDeploymentSequence([row], null, { singleGpuOnly: true, huntMode: isUnavailable });
    });
    tdAction.appendChild(launchBtn);

    tr.append(tdCheck, tdName, tdPrice, tdPower, tdAction);
    tbody.appendChild(tr);
  }

  updateSelectedGpuCount();
}

/* ==========================================================================
   5. Unified Multi-Pod Dashboard & Expandable Cards
   ========================================================================== */

function initOurPodIds() {
  const saved = localStorage.getItem(STORAGE_KEYS.OUR_POD_IDS);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) state.ourPodIds = new Set(arr);
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

function loadPodLaunchMetaMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.POD_LAUNCH_META);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePodLaunchMeta(podId, meta) {
  if (!podId || !meta || typeof meta !== "object") return;
  try {
    const all = loadPodLaunchMetaMap();
    all[podId] = {
      launchMode: meta.launchMode === "queue" ? "queue" : "single",
      huntMode: Boolean(meta.huntMode),
      candidate: meta.candidate && meta.candidate.gpuId
        ? {
            gpuId: meta.candidate.gpuId,
            displayName: meta.candidate.displayName || meta.candidate.gpuId,
            cloud: meta.candidate.cloud || "COMMUNITY",
            price: Number(meta.candidate.price) || 0
          }
        : null
    };
    localStorage.setItem(STORAGE_KEYS.POD_LAUNCH_META, JSON.stringify(all));
  } catch {}
}

function getPodLaunchMeta(podId) {
  if (!podId) return null;
  const all = loadPodLaunchMetaMap();
  return all[podId] || null;
}

function removePodLaunchMeta(podId) {
  if (!podId) return;
  try {
    const all = loadPodLaunchMetaMap();
    if (podId in all) {
      delete all[podId];
      localStorage.setItem(STORAGE_KEYS.POD_LAUNCH_META, JSON.stringify(all));
    }
  } catch {}
}

function isPodCreatedByUs(pod) {
  if (!pod) return false;
  const id = pod.id || pod.podId;
  if (id && state.ourPodIds.has(id)) return true;
  const name = String(pod.name || "").trim().toLowerCase();
  return name.startsWith("comfy-work-");
}

function isPodRuntimeActive(pod) {
  const rt = pod?.runtime;
  if (!rt) return false;
  return (Number(rt.uptime) || 0) > 0 || (Array.isArray(rt.ports) && rt.ports.length > 0);
}

function getContainerFatalReason(lowerLine, source = "system") {
  if (!lowerLine) return null;
  if (lowerLine.includes("mount_attr_idmap")) {
    return "Ошибка ядра/Docker на хосте (MOUNT_ATTR_IDMAP)";
  }
  if (source === "system" && lowerLine.includes("no space left on device")) {
    return "На хосте закончилось место на диске (no space left on device)";
  }
  if (
    lowerLine.includes("error starting container") ||
    lowerLine.includes("error creating container") ||
    lowerLine.includes("failed to create task for container") ||
    lowerLine.includes("failed to create shim task") ||
    lowerLine.includes("oci runtime create failed") ||
    lowerLine.includes("runc create failed")
  ) {
    return "Ошибка запуска Docker-контейнера на хосте";
  }
  return null;
}

function getPublicIpFromPod(pod) {
  const ports = pod?.runtime?.ports;
  if (!Array.isArray(ports)) return null;
  const pub = ports.find(
    (p) => p && typeof p.ip === "string" && p.ip && (p.isIpPublic || !p.ip.startsWith("100."))
  );
  return pub ? pub.ip : null;
}

function formatPodRamText(ctrl) {
  if (Number.isFinite(ctrl.ramGb) && ctrl.ramGb > 0) {
    return `${Math.round(ctrl.ramGb)} ГБ RAM`;
  }
  return "";
}

async function resolvePodGeoByIp(ctrl, ip) {
  if (!ip) return;
  if (state.ipGeoCache.has(ip)) {
    const cached = state.ipGeoCache.get(ip);
    if (cached && cached !== ctrl.locationText) {
      ctrl.locationText = cached;
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
    }
    return;
  }
  if (ctrl.geoFetchInFlightIp === ip) return;
  ctrl.geoFetchInFlightIp = ip;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || data.success === false) return;
    const flag = data.flag?.emoji ? `${data.flag.emoji} ` : "";
    const place = [data.country_code || data.country, data.city].filter(Boolean).join(", ");
    if (!place) return;
    const label = `${flag}${place}`;
    state.ipGeoCache.set(ip, label);
    ctrl.locationText = label;
    const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
    if (card) updatePodCardElement(ctrl, card);
  } catch {
  } finally {
    if (ctrl.geoFetchInFlightIp === ip) ctrl.geoFetchInFlightIp = null;
  }
}

function syncPodStateFromApi(ctrl, pod) {
  if (!pod) return;
  if (!pod.runtime && ctrl.pod?.runtime) {
    pod = { ...pod, runtime: ctrl.pod.runtime };
  }
  ctrl.pod = pod;
  ctrl.status = pod.status || ctrl.status;
  ctrl.gpuId = pod.gpu?.id || pod.machine?.gpuTypeId || ctrl.gpuId || null;
  ctrl.startedAtMs = parsePodStartMs(pod) || ctrl.startedAtMs;
  const apiCost = Number(pod?.cost ?? pod?.costPerHr);
  if (!(ctrl.price > 0) && Number.isFinite(apiCost) && apiCost > 0) {
    ctrl.price = apiCost;
  }

  const ramGb = pod.gpu?.memory ?? pod.cpu?.memory;
  if (Number.isFinite(ramGb) && ramGb > 0) ctrl.ramGb = ramGb;

  const toPosNum = (v) => {
    if (v === null || v === undefined || v === "") return NaN;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : NaN;
  };
  const dl = toPosNum(pod.machine?.maxDownloadSpeedMbps ?? pod.maxDownloadSpeedMbps ?? pod.machine?.downloadSpeedMbps ?? pod.machine?.networkSpeedMbps);
  const ul = toPosNum(pod.machine?.maxUploadSpeedMbps ?? pod.maxUploadSpeedMbps ?? pod.machine?.uploadSpeedMbps);
  if (Number.isFinite(dl) || Number.isFinite(ul)) {
    const dlPart = Number.isFinite(dl) ? `↓${Math.round(dl)}` : "";
    const ulPart = Number.isFinite(ul) ? `↑${Math.round(ul)}` : "";
    const joined = [dlPart, ulPart].filter(Boolean).join(" / ");
    if (joined) ctrl.speedText = `${joined} Мбит/с`;
  }

  if (pod.dataCenterId) {
    ctrl.locationText = pod.dataCenterId;
  } else {
    const pubIp = getPublicIpFromPod(pod);
    if (pubIp) resolvePodGeoByIp(ctrl, pubIp);
  }

  if (!ctrl.isOurPod) return;

  const hasErrorStage =
    ctrl.stages.provision === "error" ||
    ctrl.stages.container === "error" ||
    ctrl.stages.cuda === "error";
  if (hasErrorStage || ctrl.status === "ERROR" || ctrl.status === "EXITED") return;

  if (ctrl.stages.ready === "done") {
    ctrl.containerStarted = true;
    ctrl.stages.provision = "done";
    ctrl.stages.container = "done";
    ctrl.stages.cuda = "done";
    ctrl.stages.update = "done";
    return;
  }

  if (ctrl.cudaStagePassed) {
    ctrl.containerStarted = true;
    ctrl.stages.provision = "done";
    ctrl.stages.container = "done";
    ctrl.stages.cuda = "done";
    if (ctrl.stages.update === "pending") ctrl.stages.update = "active";
    return;
  }

  if (isPodRuntimeActive(pod)) {
    ctrl.containerStarted = true;
    ctrl.stages.provision = "done";
    ctrl.stages.container = "done";
    if (ctrl.stages.cuda === "pending") {
      ctrl.stages.cuda = "active";
      ctrl.subtitle = "Инициализация и проверка CUDA 13.0...";
    }
    return;
  }

  if (!ctrl.containerStarted) {
    ctrl.stages.cuda = "pending";
    ctrl.stages.update = "pending";
    ctrl.stages.ready = "pending";
    if (pod.status === "RUNNING") {
      ctrl.stages.provision = "done";
      ctrl.stages.container = "active";
      if (!ctrl.liveStepLabel || ctrl.liveStepLabel === "Подготовка хоста") {
        ctrl.liveStepLabel = "Загрузка контейнера";
      }
      if (!ctrl.subtitle || ctrl.subtitle.includes("Подготовка хоста") || ctrl.subtitle.includes("CUDA")) {
        ctrl.subtitle = "Загрузка Docker-контейнера...";
      }
    } else {
      ctrl.stages.provision = "active";
      ctrl.stages.container = "pending";
      if (!ctrl.subtitle || ctrl.subtitle.includes("CUDA")) {
        ctrl.subtitle = "Подготовка хоста на RunPod...";
      }
    }
  }
}

function parsePodStartMs(pod) {
  const raw = pod?.lastStartedAt || pod?.createdAt;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function getPodDiskHourlyCost(pod) {
  const containerGb = Number(pod?.containerDiskInGb ?? pod?.containerDiskGb ?? DEFAULT_TEMPLATE.containerDiskGb);
  const volumeGb = Number(pod?.volumeInGb ?? pod?.volumeDiskGb ?? DEFAULT_TEMPLATE.volumeDiskGb);
  const totalGb = (Number.isFinite(containerGb) && containerGb > 0 ? containerGb : 0) +
    (Number.isFinite(volumeGb) && volumeGb > 0 ? volumeGb : 0);
  return (totalGb * 0.10) / 730;
}

function getPodHourlyPrice(ctrl) {
  const costPerHr = Number(ctrl.pod?.cost ?? ctrl.pod?.costPerHr);
  let baseGpuPrice = 0;
  if (Number.isFinite(costPerHr) && costPerHr > 0) {
    baseGpuPrice = costPerHr;
  } else if (ctrl.price > 0) {
    baseGpuPrice = ctrl.price;
  } else if (ctrl.launchCandidate?.price > 0) {
    baseGpuPrice = ctrl.launchCandidate.price;
  } else {
    const match =
      state.catalogRows.find((r) => ctrl.gpuId && r.gpuId === ctrl.gpuId && r.cloud === ctrl.cloud) ||
      state.catalogRows.find(
        (r) =>
          (ctrl.gpuId && r.gpuId === ctrl.gpuId) ||
          (ctrl.gpuName && r.displayName === ctrl.gpuName && r.cloud === ctrl.cloud)
      );
    baseGpuPrice = match?.price > 0 ? match.price : 0;
  }
  if (!(baseGpuPrice > 0)) return 0;
  return baseGpuPrice + getPodDiskHourlyCost(ctrl.pod);
}

function isHeldPodMergedWithRetry(ctrl) {
  if (!ctrl || !state.heldBadPodIds.has(ctrl.podId) || !state.currentDeploySessionId || !state.heldRetryInfo) {
    return false;
  }
  const { gpuIds, gpuNames, badPodIds } = state.heldRetryInfo;
  const ctrlGpuId = ctrl.gpuId || ctrl.launchCandidate?.gpuId || ctrl.pod?.gpu?.id || ctrl.pod?.machine?.gpuTypeId;
  if (ctrlGpuId && gpuIds?.has(ctrlGpuId)) return true;
  if (ctrl.gpuName && gpuNames?.has(ctrl.gpuName)) return true;
  if (badPodIds?.has(ctrl.podId) && (!gpuIds || gpuIds.size === 0)) return true;
  return false;
}

function getPodElapsedMs(ctrl) {
  if (!ctrl) return 0;
  if (!ctrl.startedAtMs) {
    const parsed = parsePodStartMs(ctrl.pod);
    if (parsed) {
      ctrl.startedAtMs = parsed;
    } else if (Number.isFinite(ctrl.pod?.runtime?.uptime) && ctrl.pod.runtime.uptime > 0) {
      ctrl.startedAtMs = Date.now() - ctrl.pod.runtime.uptime * 1000;
    } else {
      ctrl.startedAtMs = Date.now();
    }
  }
  return Math.max(0, Date.now() - ctrl.startedAtMs);
}

function formatPodUptime(ctrl) {
  if (!ctrl || ctrl.status === "EXITED" || ctrl.status === "TERMINATED") return "";
  const totalSec = Math.floor(getPodElapsedMs(ctrl) / 1000);
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 1) return "<1 мин";
  if (totalMin < 60) return `${totalMin} мин`;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins > 0 ? `${hrs}ч ${mins}м` : `${hrs}ч`;
}

function formatPodSpentCents(ctrl) {
  if (!ctrl || ctrl.status === "EXITED" || ctrl.status === "TERMINATED") return "";
  const price = getPodHourlyPrice(ctrl);
  if (!price) return "";
  const elapsedHours = getPodElapsedMs(ctrl) / 3600000;
  const dollars = elapsedHours * price;
  return `$${dollars.toFixed(2)}`;
}

function formatPodReadyMetrics(ctrl) {
  const parts = [];
  const uptime = formatPodUptime(ctrl);
  const hourly = getPodHourlyPrice(ctrl);
  const spent = formatPodSpentCents(ctrl);
  if (uptime) parts.push(uptime);
  if (hourly > 0) parts.push(`$${hourly.toFixed(2)}/ч`);
  if (spent) parts.push(spent);
  return parts.length > 0 ? parts.join(" · ") : "Готов";
}

function updateAllPodSpentCounters() {
  const container = document.getElementById("pods-list");
  if (!container) return;
  for (const card of container.querySelectorAll(".pod-card")) {
    const podId = card.dataset.podId;
    const ctrl = podId ? state.podControllers.get(podId) : null;
    if (!ctrl) continue;
    const statusInfo = getPodLiveStatus(ctrl);
    if (statusInfo.tone === "ready" || statusInfo.tone === "active") {
      const statusTextEl = card.querySelector(".pod-status-text");
      if (statusTextEl && statusTextEl.textContent !== statusInfo.text) {
        statusTextEl.textContent = statusInfo.text;
      }
    }
  }
}

setInterval(updateAllPodSpentCounters, 1000);

function getOrCreatePodController(podId, initData = {}) {
  let ctrl = state.podControllers.get(podId);
  if (!ctrl) {
    const isOur = initData.isOurPod !== undefined ? initData.isOurPod : isPodCreatedByUs(initData.pod || initData);
    const savedMeta = getPodLaunchMeta(podId);
    ctrl = {
      podId,
      displayName: initData.displayName || (isOur ? "comfy-work" : "runpod"),
      gpuId: initData.gpuId || initData.pod?.gpu?.id || initData.pod?.machine?.gpuTypeId || savedMeta?.candidate?.gpuId || null,
      gpuName: initData.gpuName || savedMeta?.candidate?.displayName || "GPU",
      cloud: initData.cloud || savedMeta?.candidate?.cloud || "COMMUNITY",
      price: initData.price || savedMeta?.candidate?.price || 0,
      launchMode: initData.launchMode || savedMeta?.launchMode || (savedMeta ? "single" : null),
      huntMode: initData.huntMode ?? Boolean(savedMeta?.huntMode),
      launchCandidate: initData.launchCandidate || savedMeta?.candidate || null,
      startedAtMs: parsePodStartMs(initData.pod) || Date.now(),
      isOurPod: isOur,
      isExpanded: initData.isExpanded !== undefined ? initData.isExpanded : true,
      pod: initData.pod || null,
      status: initData.status || initData.pod?.status || "STARTING",
      containerStarted: isPodRuntimeActive(initData.pod),
      restoreBackup: initData.restoreBackup ?? (document.getElementById("opt-restore-backup")?.checked ?? true),
      stages: {
        provision: "active",
        container: "pending",
        cuda: "pending",
        update: "pending",
        ready: "pending"
      },
      subtitle: isOur ? "Подготовка хоста на RunPod..." : "",
      liveStepLabel: "",
      alert: null,
      logLines: [],
      logAbortController: null,
      logRetryTimerId: null,
      logsUserToggled: false,
      logsAutoCollapsed: false,
      cudaStagePassed: false,
      cudaFatalTriggered: false,
      initialProbeDone: initData.fromApiDiscovery ? !isOur : true,
      pollTimerId: null
    };
    if (initData.pod) syncPodStateFromApi(ctrl, initData.pod);
    state.podControllers.set(podId, ctrl);
    ctrl.pollTimerId = setInterval(() => pollHealthForPod(ctrl), 2500);
    pollHealthForPod(ctrl);
    if (isOur || ctrl.isExpanded) startLogStreamForPod(ctrl);
  }
  return ctrl;
}

function stopPodController(ctrl) {
  if (ctrl.pollTimerId) {
    clearInterval(ctrl.pollTimerId);
    ctrl.pollTimerId = null;
  }
  if (ctrl.logRetryTimerId) {
    clearTimeout(ctrl.logRetryTimerId);
    ctrl.logRetryTimerId = null;
  }
  if (ctrl.logAbortController) {
    ctrl.logAbortController.abort();
    ctrl.logAbortController = null;
  }
}

async function fetchActivePods() {
  if (!state.hasApiKey || state.isTransitioningToPod) return;
  const podsSection = document.getElementById("pods-section");
  const podsLoadingCard = document.getElementById("pods-loading-card");
  if (podsLoadingCard) podsLoadingCard.hidden = true;

  try {
    const res = await runpodFetch("/pods?includeMachine=true");
    const pods = Array.isArray(res) ? res : res?.pods || res?.data || [];
    state.activePods = pods;
    state.initialPodsLoaded = true;
    if (podsLoadingCard) podsLoadingCard.hidden = true;
    if (podsSection) podsSection.hidden = !state.initialProfileLoaded;

    const prevPodCount = state.podControllers.size;

    if (pods.length === 0 && !state.currentDeploySessionId) {
      for (const ctrl of state.podControllers.values()) stopPodController(ctrl);
      state.podControllers.clear();
      renderPodsList();
      if (prevPodCount > 0) fetchBalance();
      return;
    }

    const currentIds = new Set(pods.map((p) => p.id));
    for (const [id, ctrl] of state.podControllers.entries()) {
      if (!currentIds.has(id)) {
        stopPodController(ctrl);
        state.podControllers.delete(id);
      }
    }
    for (const id of state.heldBadPodIds) {
      if (!currentIds.has(id)) state.heldBadPodIds.delete(id);
    }
    for (const id of state.redeployTriggeredPodIds) {
      if (!currentIds.has(id)) state.redeployTriggeredPodIds.delete(id);
    }

    for (const pod of pods) {
      const gpuName = pod.gpu?.id ? cleanGpuName(pod.gpu.id, pod.gpu.displayName) : "GPU";
      let ctrl = state.podControllers.get(pod.id);
      const isOur = isPodCreatedByUs(pod);

      if (!ctrl) {
        ctrl = getOrCreatePodController(pod.id, {
          displayName: pod.name || (isOur ? "comfy-work" : "runpod"),
          gpuId: pod.gpu?.id || pod.machine?.gpuTypeId || null,
          gpuName,
          cloud: pod.cloud || "COMMUNITY",
          status: pod.status,
          pod,
          isOurPod: isOur,
          isExpanded: true,
          fromApiDiscovery: true
        });
      } else {
        ctrl.displayName = pod.name || ctrl.displayName;
        ctrl.gpuId = pod.gpu?.id || pod.machine?.gpuTypeId || ctrl.gpuId || null;
        ctrl.gpuName = gpuName;
        ctrl.cloud = pod.cloud || ctrl.cloud;
        ctrl.isOurPod = isOur;
        syncPodStateFromApi(ctrl, pod);
      }

      if ((ctrl.isOurPod || ctrl.isExpanded) && !ctrl.logAbortController) {
        startLogStreamForPod(ctrl);
      }

      const missingPorts = !Array.isArray(ctrl.pod?.runtime?.ports) || ctrl.pod.runtime.ports.length === 0;
      if ((!ctrl.speedText && !ctrl.machineSpeedFetched) || (isPodRuntimeActive(pod) && missingPorts)) {
        ctrl.machineSpeedFetched = true;
        runpodFetch(`/pods/${encodeURIComponent(ctrl.podId)}?includeMachine=true`)
          .then((fullPod) => {
            if (!fullPod) return;
            syncPodStateFromApi(ctrl, fullPod);
            const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
            if (card) updatePodCardElement(ctrl, card);
          })
          .catch(() => {});
      }
    }

    renderPodsList();
    if (state.podControllers.size !== prevPodCount) {
      fetchBalance();
    }
  } catch (err) {
    state.initialPodsLoaded = true;
    if (podsLoadingCard) podsLoadingCard.hidden = true;
    console.warn("fetchActivePods error:", err.message);
  }
}

function updateLeftColumnOrder() {
  const colLeft = document.querySelector(".col-left");
  if (!colLeft) return;
  const hasPodsOrDeploy =
    state.podControllers.size > 0 ||
    Boolean(state.currentDeploySessionId);
  colLeft.classList.toggle("has-pods-priority", hasPodsOrDeploy);
}

function renderPodsList() {
  const container = document.getElementById("pods-list");
  const emptyEl = document.getElementById("pods-empty-state");
  if (!container) return;

  if (emptyEl) {
    emptyEl.hidden =
      !state.initialPodsLoaded ||
      state.podControllers.size > 0 ||
      Boolean(state.currentDeploySessionId);
  }

  updateLeftColumnOrder();

  const existingCardEls = new Map();
  for (const card of container.querySelectorAll(".pod-card")) {
    const id = card.dataset.podId;
    if (id) existingCardEls.set(id, card);
  }

  for (const [id, el] of existingCardEls.entries()) {
    if (!state.podControllers.has(id)) el.remove();
  }

  for (const ctrl of state.podControllers.values()) {
    let cardEl = existingCardEls.get(ctrl.podId);
    if (!cardEl) {
      cardEl = createPodCardElement(ctrl);
      container.appendChild(cardEl);
    }
    updatePodCardElement(ctrl, cardEl);
  }
}

function isPodRestoreBackupEnabled(ctrl) {
  const envVal = ctrl?.pod?.env?.RESTORE_BACKUP;
  if (envVal !== undefined) return String(envVal) === "1";
  if (ctrl?.restoreBackup !== undefined) return Boolean(ctrl.restoreBackup);
  return document.getElementById("opt-restore-backup")?.checked ?? true;
}

function getPodDeployStageLabel(ctrl) {
  if (!ctrl.isOurPod) {
    return ctrl.status || "Запуск...";
  }
  if (!ctrl.initialProbeDone && !ctrl.cudaStagePassed) {
    return "Загрузка статуса...";
  }
  if (ctrl.liveStepLabel) {
    return ctrl.liveStepLabel;
  }
  if (ctrl.cudaStagePassed) {
    return isPodRestoreBackupEnabled(ctrl) ? "Загрузка бэкапа" : "Обновление нод";
  }
  if (ctrl.stages.cuda === "active") {
    return "Проверка CUDA";
  }
  if (ctrl.stages.container === "active") {
    return "Загрузка контейнера";
  }
  return "Подготовка хоста";
}

function getPodLiveStatus(ctrl) {
  if (!ctrl.isOurPod) {
    const rawStatus = ctrl.status || "UNKNOWN";
    const isErr = rawStatus === "ERROR" || rawStatus === "EXITED";
    const isRunning = rawStatus === "RUNNING";
    return {
      text: isErr ? rawStatus : formatPodReadyMetrics(ctrl),
      tone: isErr ? "error" : isRunning ? "ready" : "active",
      spinning: !isErr && !isRunning
    };
  }

  const isComfyReady = ctrl.stages.ready === "done";
  const isError =
    ctrl.status === "ERROR" ||
    ctrl.status === "EXITED" ||
    ctrl.stages.provision === "error" ||
    ctrl.stages.container === "error" ||
    ctrl.stages.cuda === "error";

  if (isError) {
    return {
      text: ctrl.status === "EXITED" ? "Под остановлен" : "Сбой запуска",
      tone: "error",
      spinning: false
    };
  }
  if (isComfyReady) {
    return {
      text: formatPodReadyMetrics(ctrl),
      tone: "ready",
      spinning: false
    };
  }
  return {
    text: formatPodReadyMetrics(ctrl),
    tone: "active",
    spinning: true
  };
}

function updatePodSpecsElement(ctrl, specsEl) {
  if (!specsEl) return;
  const gpuShort = getShortPodGpuName(ctrl.gpuId, ctrl.gpuName);
  const cloudLabel = String(ctrl.cloud || "COMMUNITY").toUpperCase() === "SECURE" ? "Secure" : "Community";

  const techLine = document.createElement("span");
  techLine.className = "pod-specs-line";
  const techParts = [gpuShort];
  if (Number.isFinite(ctrl.ramGb) && ctrl.ramGb > 0) techParts.push(`${Math.round(ctrl.ramGb)} ГБ`);
  techLine.appendChild(document.createTextNode(techParts.join(" · ")));

  if (ctrl.diskStatus === "fast") {
    techLine.appendChild(document.createTextNode(" · "));
    const diskSpan = document.createElement("span");
    diskSpan.className = "pod-disk-inline is-fast";
    diskSpan.innerHTML = `<svg class="pod-disk-icon pod-disk-icon-fast" viewBox="0 0 16 24" width="9" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2L3 13h5l-1.5 9L13 11H8l1.5-9Z"/></svg><span>Быстрый диск</span>`;
    techLine.appendChild(diskSpan);
  } else if (ctrl.diskStatus === "slow") {
    techLine.appendChild(document.createTextNode(" · "));
    const diskSpan = document.createElement("span");
    diskSpan.className = "pod-disk-inline is-slow";
    diskSpan.innerHTML = `<svg class="pod-disk-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span>Медленный диск</span>`;
    techLine.appendChild(diskSpan);
  }

  const sep = document.createElement("span");
  sep.className = "pod-specs-sep";
  sep.textContent = " · ";

  const hostLine = document.createElement("span");
  hostLine.className = "pod-specs-line";
  const hostParts = [cloudLabel];
  if (ctrl.locationText) hostParts.push(ctrl.locationText);
  if (ctrl.speedText) hostParts.push(ctrl.speedText);
  hostLine.textContent = hostParts.join(" · ");

  specsEl.classList.remove("is-multiline");
  specsEl.replaceChildren(techLine, sep, hostLine);
  specsEl.title = `${techLine.textContent} · ${hostLine.textContent}`;

  const fitSpecs = () => {
    if (!specsEl.isConnected) return;
    specsEl.classList.remove("is-multiline");
    if (specsEl.clientWidth > 0 && specsEl.scrollWidth > specsEl.clientWidth + 1) {
      specsEl.classList.add("is-multiline");
    }
  };
  if (specsEl.clientWidth > 0) fitSpecs();
  else requestAnimationFrame(fitSpecs);
}

function createReadyLinksBox(ctrl) {
  const secLinks = document.createElement("div");
  secLinks.className = "secondary-links pod-card-links";

  const tcpRow = document.createElement("div");
  tcpRow.className = "ports-row";
  const tcpTitle = document.createElement("span");
  tcpTitle.className = "ports-group-title";
  tcpTitle.textContent = "TCP:";

  const tcpComfy = document.createElement("a");
  tcpComfy.target = "_blank";
  tcpComfy.rel = "noopener noreferrer";
  tcpComfy.className = "link-subtle link-tcp-8188 link-disabled";
  tcpComfy.textContent = "ComfyUI";

  const tcpFilebrowser = document.createElement("a");
  tcpFilebrowser.target = "_blank";
  tcpFilebrowser.rel = "noopener noreferrer";
  tcpFilebrowser.className = "link-subtle link-tcp-8080 link-disabled";
  tcpFilebrowser.textContent = "FileBrowser";

  const tcpJupyter = document.createElement("a");
  tcpJupyter.target = "_blank";
  tcpJupyter.rel = "noopener noreferrer";
  tcpJupyter.className = "link-subtle link-tcp-8888 link-disabled";
  tcpJupyter.textContent = "JupyterLab";

  tcpRow.append(tcpTitle, tcpComfy, tcpFilebrowser, tcpJupyter);
  secLinks.append(tcpRow);
  return secLinks;
}

function createPodCardElement(ctrl) {
  const card = document.createElement("div");
  card.className = "pod-card is-expanded";
  card.dataset.podId = ctrl.podId;
  if (!ctrl.isOurPod) card.classList.add("pod-card-foreign");

  const glow = document.createElement("span");
  glow.className = "pod-card-glow";
  glow.setAttribute("aria-hidden", "true");

  const header = document.createElement("div");
  header.className = "pod-card-header";

  const iconBox = document.createElement("div");
  iconBox.className = "pod-card-icon";
  iconBox.setAttribute("aria-hidden", "true");
  iconBox.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;

  const headerContent = document.createElement("div");
  headerContent.className = "pod-header-content";

  const headerTop = document.createElement("div");
  headerTop.className = "pod-header-top";

  const statusWrap = document.createElement("div");
  statusWrap.className = "pod-status-wrap";

  const spinner = document.createElement("span");
  spinner.className = "pod-card-spinner";
  spinner.setAttribute("aria-hidden", "true");
  spinner.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

  const statusDot = document.createElement("span");
  statusDot.className = "pod-status-dot";
  statusDot.setAttribute("aria-hidden", "true");

  const statusText = document.createElement("span");
  statusText.className = "pod-status-text";

  statusWrap.append(spinner, statusDot, statusText);
  headerTop.append(statusWrap);

  const title = document.createElement("a");
  title.className = "pod-title pod-title-link";
  title.href = `https://console.runpod.io/pods?id=${encodeURIComponent(ctrl.podId)}`;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = ctrl.displayName;
  title.title = `${ctrl.displayName} — открыть в консоли RunPod (${ctrl.podId})`;

  const specsText = document.createElement("div");
  specsText.className = "pod-specs-text";
  updatePodSpecsElement(ctrl, specsText);

  headerContent.append(headerTop, title, specsText);
  header.append(iconBox, headerContent);

  const body = document.createElement("div");
  body.className = "pod-card-body";

  const alertBox = document.createElement("div");
  alertBox.className = "monitor-alert pod-card-alert";
  alertBox.hidden = true;

  const actionRow = document.createElement("div");
  actionRow.className = "pod-card-action-row";

  const deployMetrics = document.createElement("div");
  deployMetrics.className = "pod-deploy-metrics";
  deployMetrics.hidden = true;

  const mainActions = document.createElement("div");
  mainActions.className = "ready-actions pod-card-main-actions";
  mainActions.hidden = true;

  const comfyUrl = `https://${ctrl.podId}-7860.proxy.runpod.net/`;
  const openSplitGroup = document.createElement("div");
  openSplitGroup.className = "btn-split-group";

  const openComfyLink = document.createElement("a");
  openComfyLink.href = comfyUrl;
  openComfyLink.target = "_blank";
  openComfyLink.rel = "noopener noreferrer";
  openComfyLink.className = "btn-split-main btn-open-comfy";
  openComfyLink.textContent = "Открыть";

  const openCaretBtn = document.createElement("button");
  openCaretBtn.type = "button";
  openCaretBtn.className = "btn-split-caret";
  openCaretBtn.setAttribute("aria-label", "Дополнительные действия");
  openCaretBtn.setAttribute("aria-haspopup", "menu");
  openCaretBtn.setAttribute("aria-expanded", "false");
  openCaretBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

  const openMenu = document.createElement("div");
  openMenu.className = "btn-split-menu";
  openMenu.setAttribute("role", "menu");
  openMenu.hidden = true;

  const copyLinkBtn = document.createElement("button");
  copyLinkBtn.type = "button";
  copyLinkBtn.className = "btn-split-menu-item";
  copyLinkBtn.setAttribute("role", "menuitem");
  copyLinkBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Копировать ссылку</span>`;

  openCaretBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = openMenu.hidden;
    document.querySelectorAll(".btn-split-group.is-open").forEach((grp) => {
      grp.classList.remove("is-open");
      const m = grp.querySelector(".btn-split-menu");
      if (m) m.hidden = true;
      const c = grp.querySelector(".btn-split-caret");
      if (c) c.setAttribute("aria-expanded", "false");
    });
    openMenu.hidden = !willOpen;
    openSplitGroup.classList.toggle("is-open", willOpen);
    openCaretBtn.setAttribute("aria-expanded", String(willOpen));
  });

  copyLinkBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await copyTextToClipboard(comfyUrl);
    const labelSpan = copyLinkBtn.querySelector("span");
    if (ok && labelSpan) {
      copyLinkBtn.classList.add("is-copied");
      labelSpan.textContent = "Скопировано ✓";
      setTimeout(() => {
        copyLinkBtn.classList.remove("is-copied");
        labelSpan.textContent = "Копировать ссылку";
        openMenu.hidden = true;
        openSplitGroup.classList.remove("is-open");
        openCaretBtn.setAttribute("aria-expanded", "false");
      }, 900);
    } else {
      openMenu.hidden = true;
      openSplitGroup.classList.remove("is-open");
      openCaretBtn.setAttribute("aria-expanded", "false");
    }
  });

  openMenu.appendChild(copyLinkBtn);
  openSplitGroup.append(openComfyLink, openCaretBtn, openMenu);

  const mainFizgigLink = document.createElement("a");
  mainFizgigLink.href = `https://${ctrl.podId}-7862.proxy.runpod.net/`;
  mainFizgigLink.target = "_blank";
  mainFizgigLink.rel = "noopener noreferrer";
  mainFizgigLink.className = "btn btn-fizgig btn-link-fizgig";
  mainFizgigLink.textContent = "Fizgig ↗";

  const mainFileBrowserLink = document.createElement("a");
  mainFileBrowserLink.href = `https://${ctrl.podId}-7861.proxy.runpod.net/`;
  mainFileBrowserLink.target = "_blank";
  mainFileBrowserLink.rel = "noopener noreferrer";
  mainFileBrowserLink.className = "btn btn-secondary btn-link-filebrowser";
  mainFileBrowserLink.innerHTML = `<svg class="btn-icon-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg><span>FileBrowser</span>`;

  mainActions.append(openSplitGroup, mainFileBrowserLink, mainFizgigLink);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger-sm pod-delete-btn";
  deleteBtn.textContent = "Удалить";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (isHeldPodMergedWithRetry(ctrl)) {
      state.currentDeploySessionId = null;
      state.redeployInProgress = false;
      state.heldRetryInfo = null;
      const pc = document.getElementById("pending-deploy-card");
      if (pc) pc.hidden = true;
    } else if (!confirm(`Точно удалить под ${ctrl.podId}?`)) {
      return;
    }
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Удаление...";
    stopPodController(ctrl);
    unmarkPodAsOurs(ctrl.podId);
    removePodLaunchMeta(ctrl.podId);
    state.heldBadPodIds.delete(ctrl.podId);
    state.redeployTriggeredPodIds.delete(ctrl.podId);
    try {
      await runpodFetch(`/pods/${encodeURIComponent(ctrl.podId)}`, { method: "DELETE" });
      state.podControllers.delete(ctrl.podId);
      await Promise.all([fetchActivePods(), fetchBalance()]);
    } catch (err) {
      alert(`Ошибка при удалении пода: ${err.message}`);
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Удалить";
    }
  });

  actionRow.append(deployMetrics, mainActions, deleteBtn);

  const readyBox = createReadyLinksBox(ctrl);
  readyBox.hidden = true;

  const logDetails = document.createElement("details");
  logDetails.className = "logs-details";
  logDetails.open = false;

  const logSummary = document.createElement("summary");
  logSummary.className = "logs-summary";
  logSummary.innerHTML = `<svg class="logs-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg><span>Логи пода</span>`;
  logDetails.addEventListener("click", (e) => e.stopPropagation());
  logSummary.addEventListener("click", () => {
    ctrl.logsUserToggled = true;
  });

  const logPre = document.createElement("pre");
  logPre.className = "terminal-logs";
  logPre.tabIndex = 0;
  logPre.textContent = `Подключение к логам пода ${ctrl.podId}...\n`;
  logDetails.append(logSummary, logPre);

  body.append(alertBox, actionRow, readyBox, logDetails);
  card.append(glow, header, body);
  return card;
}

function updatePodCardElement(ctrl, cardEl) {
  ctrl.isExpanded = true;
  cardEl.classList.add("is-expanded");

  const titleEl = cardEl.querySelector(".pod-title");
  if (titleEl) {
    titleEl.textContent = ctrl.displayName;
    titleEl.title = `${ctrl.displayName} — открыть в консоли RunPod (${ctrl.podId})`;
    if (titleEl.tagName === "A") {
      titleEl.href = `https://console.runpod.io/pods?id=${encodeURIComponent(ctrl.podId)}`;
    }
  }

  updatePodSpecsElement(ctrl, cardEl.querySelector(".pod-specs-text"));

  const spentEl = cardEl.querySelector(".pod-spent-counter");
  if (spentEl) {
    const spentText = formatPodSpentCents(ctrl);
    spentEl.textContent = spentText;
    spentEl.hidden = !spentText;
  }

  const isHeldWithRetry = isHeldPodMergedWithRetry(ctrl);
  const deleteBtn = cardEl.querySelector(".pod-delete-btn");
  if (deleteBtn && !deleteBtn.disabled) {
    deleteBtn.textContent = isHeldWithRetry ? "Остановить и удалить" : "Удалить";
  }

  let retryBox = cardEl.querySelector(".pod-held-retry-box");
  if (isHeldWithRetry) {
    if (!retryBox) {
      retryBox = document.createElement("div");
      retryBox.className = "pod-held-retry-box";
      const retryTitle = document.createElement("div");
      retryTitle.className = "pod-held-retry-title";
      const retrySub = document.createElement("div");
      retrySub.className = "pod-held-retry-sub";
      const retryAlert = document.createElement("div");
      retryAlert.className = "pod-held-retry-alert monitor-alert";
      retryBox.append(retryTitle, retrySub, retryAlert);
      const headerEl = cardEl.querySelector(".pod-card-header");
      if (headerEl) headerEl.after(retryBox);
      else cardEl.appendChild(retryBox);
    }
    retryBox.hidden = false;
    const retryTitle = retryBox.querySelector(".pod-held-retry-title");
    const retrySub = retryBox.querySelector(".pod-held-retry-sub");
    const retryAlert = retryBox.querySelector(".pod-held-retry-alert");
    if (retryTitle) retryTitle.textContent = state.heldRetryInfo.title || "Поиск замены";
    if (retrySub) {
      retrySub.textContent = state.heldRetryInfo.sub || "";
      retrySub.hidden = !state.heldRetryInfo.sub;
    }
    if (retryAlert) {
      retryAlert.hidden = !state.heldRetryInfo.alertText;
      retryAlert.className = `pod-held-retry-alert ${state.heldRetryInfo.alertClass || "monitor-alert alert-info"}`;
      retryAlert.textContent = state.heldRetryInfo.alertText || "";
    }
  } else if (retryBox) {
    retryBox.hidden = true;
  }

  const statusInfo = getPodLiveStatus(ctrl);
  const isComfyReady = ctrl.isOurPod ? ctrl.stages.ready === "done" : ctrl.status === "RUNNING";
  const isError = statusInfo.tone === "error";

  cardEl.classList.toggle("pod-running", isComfyReady && !isError);
  cardEl.classList.toggle("pod-deploying", !isComfyReady && !isError);
  cardEl.classList.toggle("pod-error", isError);

  const spinnerEl = cardEl.querySelector(".pod-card-spinner");
  if (spinnerEl) spinnerEl.hidden = !statusInfo.spinning;

  const dotEl = cardEl.querySelector(".pod-status-dot");
  if (dotEl) {
    dotEl.hidden = statusInfo.spinning;
    dotEl.className = `pod-status-dot${statusInfo.tone === "ready" ? " is-ready" : isError ? " is-error" : ""}`;
  }

  const statusTextEl = cardEl.querySelector(".pod-status-text");
  if (statusTextEl) {
    statusTextEl.textContent = statusInfo.text;
    statusTextEl.className = `pod-status-text is-${statusInfo.tone}`;
  }

  const quickOpenBtn = cardEl.querySelector(".btn-quick-open");
  if (quickOpenBtn) {
    quickOpenBtn.hidden = !isComfyReady || ctrl.isExpanded;
  }

  const alertBox = cardEl.querySelector(".pod-card-alert");
  if (alertBox) {
    if (ctrl.alert) {
      alertBox.hidden = false;
      alertBox.className = `monitor-alert pod-card-alert alert-${ctrl.alert.level || "info"}`;
      alertBox.textContent = ctrl.alert.msg;
    } else if (isError && ctrl.subtitle && ctrl.subtitle.startsWith("✗")) {
      alertBox.hidden = false;
      alertBox.className = "monitor-alert pod-card-alert alert-error";
      alertBox.textContent = ctrl.subtitle;
    } else {
      alertBox.hidden = true;
    }
  }

  const mainActionsEl = cardEl.querySelector(".pod-card-main-actions");
  if (mainActionsEl) {
    mainActionsEl.hidden = !isComfyReady;
  }

  const deployMetricsEl = cardEl.querySelector(".pod-deploy-metrics");
  if (deployMetricsEl) {
    const showDeployStage = !isComfyReady && !isError;
    deployMetricsEl.hidden = !showDeployStage;
    if (showDeployStage) {
      deployMetricsEl.textContent = getPodDeployStageLabel(ctrl);
    }
  }

  const readyBox = cardEl.querySelector(".pod-card-links");
  if (readyBox) {
    readyBox.hidden = !isComfyReady;
  }

  const tcp8188 = getPodTcpPort(ctrl.pod, 8188);
  const tcp8080 = getPodTcpPort(ctrl.pod, 8080);
  const tcp8888 = getPodTcpPort(ctrl.pod, 8888);

  const updateTcpLink = (selector, tcpObj, label) => {
    const el = cardEl.querySelector(selector);
    if (!el) return;
    if (tcpObj) {
      el.textContent = `${label} ↗`;
      el.href = tcpObj.url;
      el.title = `${tcpObj.ip}:${tcpObj.port}`;
      el.classList.remove("link-disabled");
    } else {
      el.textContent = label;
      el.removeAttribute("href");
      el.title = "TCP-порт ещё запускается";
      el.classList.add("link-disabled");
    }
  };
  updateTcpLink(".link-tcp-8188", tcp8188, "ComfyUI");
  updateTcpLink(".link-tcp-8080", tcp8080, "FileBrowser");
  updateTcpLink(".link-tcp-8888", tcp8888, "JupyterLab");

  const logPre = cardEl.querySelector(".terminal-logs");
  if (logPre && ctrl.logLines.length > 0) {
    logPre.textContent = ctrl.logLines.join("\n");
  }
}

function togglePodExpanded(ctrl, cardEl) {
  ctrl.isExpanded = !ctrl.isExpanded;
  cardEl.classList.toggle("is-expanded", ctrl.isExpanded);

  if (ctrl.isExpanded) {
    if (!ctrl.logAbortController) startLogStreamForPod(ctrl);
    if (!ctrl.pollTimerId) {
      pollHealthForPod(ctrl);
      ctrl.pollTimerId = setInterval(() => pollHealthForPod(ctrl), 2500);
    }
  } else if (!ctrl.isOurPod && ctrl.stages.ready === "done") {
    if (ctrl.logRetryTimerId) {
      clearTimeout(ctrl.logRetryTimerId);
      ctrl.logRetryTimerId = null;
    }
    if (ctrl.logAbortController) {
      ctrl.logAbortController.abort();
      ctrl.logAbortController = null;
    }
  }
  updatePodCardElement(ctrl, cardEl);
}

function scheduleLogStreamRetry(ctrl, delayMs = 3000) {
  if (ctrl.logRetryTimerId) {
    clearTimeout(ctrl.logRetryTimerId);
    ctrl.logRetryTimerId = null;
  }
  if (!ctrl.isExpanded || !state.podControllers.has(ctrl.podId)) return;
  ctrl.logRetryTimerId = setTimeout(() => {
    ctrl.logRetryTimerId = null;
    if (ctrl.isExpanded && state.podControllers.has(ctrl.podId) && !ctrl.logAbortController) {
      startLogStreamForPod(ctrl);
    }
  }, delayMs);
}

function setLogPlaceholderMessage(ctrl, message) {
  if (ctrl.logLines.length > 0) return;
  const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
  const logPre = card?.querySelector(".terminal-logs");
  if (logPre) logPre.textContent = message;
}

async function startLogStreamForPod(ctrl) {
  if (ctrl.logRetryTimerId) {
    clearTimeout(ctrl.logRetryTimerId);
    ctrl.logRetryTimerId = null;
  }
  if (ctrl.logAbortController) ctrl.logAbortController.abort();
  const abortController = new AbortController();
  ctrl.logAbortController = abortController;

  let shouldRetry = false;
  let retryDelayMs = 3000;

  try {
    const res = await fetch(`${RUNPOD_API_BASE}/pods/${encodeURIComponent(ctrl.podId)}/logs?tail=200`, {
      headers: { Authorization: `Bearer ${state.apiKey}` },
      signal: abortController.signal
    });
    if (!res.ok || !res.body) {
      if (state.isTransitioningToPod) return;
      shouldRetry = true;
      if (res.status === 401 || res.status === 403) {
        if (!state.isTransitioningToPod) {
          setApiKeyPermissionError("Логи подов (/pods/{id}/logs)", res.status);
        }
        retryDelayMs = 10000;
        setLogPlaceholderMessage(
          ctrl,
          `[HTTP ${res.status}] Нет доступа к логам пода ${ctrl.podId}. Проверьте права API-ключа RunPod (Pods: Read & Write и GraphQL: Read only).\n`
        );
      } else {
        retryDelayMs = 2500;
        setLogPlaceholderMessage(
          ctrl,
          `Подключение к логам пода ${ctrl.podId}... (HTTP ${res.status || "error"}, повтор через 2.5с)\n`
        );
      }
      return;
    }

    clearApiKeyPermissionError("Логи подов (/pods/{id}/logs)");
    ctrl.logLines = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        shouldRetry = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let processedAny = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonPart = trimmed.slice(5).trim();
        if (!jsonPart) continue;
        processedAny = true;
        try {
          handlePodLog(ctrl, JSON.parse(jsonPart), true);
        } catch {
          handlePodLog(ctrl, { line: jsonPart, source: "system" }, true);
        }
      }
      if (processedAny) {
        const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
        const logPre = card?.querySelector(".terminal-logs");
        if (logPre) {
          logPre.textContent = ctrl.logLines.join("\n");
          logPre.scrollTop = logPre.scrollHeight;
        }
        if (card) updatePodCardElement(ctrl, card);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError" && !state.isTransitioningToPod) {
      shouldRetry = true;
      retryDelayMs = 4000;
      setLogPlaceholderMessage(
        ctrl,
        `Подключение к логам пода ${ctrl.podId}... (${err.message || "ошибка сети"}, повтор через 4с)\n`
      );
    }
  } finally {
    if (ctrl.logAbortController === abortController) ctrl.logAbortController = null;
    if (shouldRetry && !abortController.signal.aborted && !state.isTransitioningToPod) {
      scheduleLogStreamRetry(ctrl, retryDelayMs);
    }
  }
}

function formatLogTimestamp(rawTs) {
  const dateObj = rawTs ? new Date(rawTs) : new Date();
  if (Number.isNaN(dateObj.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}`;
}

function handlePodLog(ctrl, entry, deferUi = false) {
  const line = String(entry.line || "").trim();
  const source = entry.source || "log";
  if (!line) return;

  const ts = formatLogTimestamp(entry.ts || entry.timestamp || entry.time);
  const formattedLine = ts ? `[${ts}] [${source}] ${line}` : `[${source}] ${line}`;
  ctrl.logLines.push(formattedLine);
  if (ctrl.logLines.length > 250) ctrl.logLines.shift();

  const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
  if (!deferUi) {
    const logPre = card?.querySelector(".terminal-logs");
    if (logPre) {
      logPre.textContent = ctrl.logLines.join("\n");
      logPre.scrollTop = logPre.scrollHeight;
    }
  }

  if (!ctrl.isOurPod) return;

  const lowerLine = line.toLowerCase();

  const isFastDiskLine =
    (lowerLine.includes("xfs") && !lowerLine.includes("not xfs") && !lowerLine.includes("no xfs")) ||
    (lowerLine.includes("fast disk") &&
      !lowerLine.includes("not enabled") &&
      !lowerLine.includes("disabled") &&
      !lowerLine.includes("false") &&
      !lowerLine.includes("off") &&
      !lowerLine.includes("no fast disk"));
  const isSlowDiskLine =
    lowerLine.includes("moosefs") ||
    lowerLine.includes("fuse.mfs") ||
    lowerLine.includes("not xfs") ||
    lowerLine.includes("non-xfs") ||
    (lowerLine.includes("fstype") && !lowerLine.includes("xfs")) ||
    (lowerLine.includes("fast disk") &&
      (lowerLine.includes("not enabled") ||
        lowerLine.includes("disabled") ||
        lowerLine.includes("false") ||
        lowerLine.includes("off")));

  if (isFastDiskLine && ctrl.diskStatus !== "fast") {
    ctrl.diskStatus = "fast";
    if (card) updatePodCardElement(ctrl, card);
  } else if (
    (isSlowDiskLine ||
      lowerLine.includes("total vram") ||
      lowerLine.includes("to see the gui go to:") ||
      lowerLine.includes("comfyui is ready")) &&
    ctrl.diskStatus !== "fast" &&
    ctrl.diskStatus !== "slow"
  ) {
    ctrl.diskStatus = "slow";
    if (card) updatePodCardElement(ctrl, card);
  }

  const isPreflightWarn = line.includes("[cuda][warn]");
  const isNotEnoughGpu =
    lowerLine.includes("not enough gpus free") ||
    (lowerLine.includes("error creating container") && lowerLine.includes("gpu"));

  const isCudaFatal =
    !isPreflightWarn &&
    (line.includes("[fatal][gpu]") ||
      line.includes("STAGE: Host driver failure") ||
      line.includes("host_gpu_driver_corrupt") ||
      line.includes("CUDA runtime initialization failed") ||
      line.includes("torch.cuda.is_available() returned False") ||
      line.includes("Error 803:") ||
      line.includes("Error 804:") ||
      isNotEnoughGpu);

  if (isCudaFatal) {
    ctrl.stages.cuda = "error";
    if (isNotEnoughGpu) {
      ctrl.stages.container = "error";
      ctrl.subtitle = "✗ Ошибка хоста: not enough GPUs free (CUDA недоступна)";
    } else {
      ctrl.subtitle = "✗ Сбой драйвера CUDA на хосте";
    }
    if (card) updatePodCardElement(ctrl, card);
    if (!ctrl.cudaFatalTriggered) {
      ctrl.cudaFatalTriggered = true;
      triggerRedeploy(
        ctrl.podId,
        isNotEnoughGpu ? "Сбой GPU на хосте (not enough GPUs free)" : "Сбой драйвера CUDA на хосте"
      );
    }
    return;
  }

  if (line.includes("CPU Overload Detected") || line.includes("cpu_confirm") || line.includes("[fatal][cpu]")) {
    ctrl.stages.cuda = "error";
    ctrl.subtitle = "✗ Критическая перегрузка CPU хоста";
    if (card) updatePodCardElement(ctrl, card);
    if (!ctrl.cudaFatalTriggered) {
      ctrl.cudaFatalTriggered = true;
      triggerRedeploy(ctrl.podId, "Критическая перегрузка CPU хоста");
    }
    return;
  }

  const containerFatalReason = getContainerFatalReason(lowerLine, source);
  if (containerFatalReason) {
    ctrl.stages.provision = "done";
    ctrl.stages.container = "error";
    ctrl.subtitle = `✗ ${containerFatalReason}`;
    if (card) updatePodCardElement(ctrl, card);
    if (!ctrl.cudaFatalTriggered) {
      ctrl.cudaFatalTriggered = true;
      triggerRedeploy(ctrl.podId, containerFatalReason);
    }
    return;
  }

  if (source === "system") {
    const hasErrorStage =
      ctrl.stages.provision === "error" ||
      ctrl.stages.container === "error" ||
      ctrl.stages.cuda === "error";

    if (!ctrl.containerStarted && !ctrl.cudaStagePassed && ctrl.stages.ready !== "done" && !hasErrorStage) {
      const isContainerDownloading =
        lowerLine.includes("create container") ||
        lowerLine.includes("creating container") ||
        lowerLine.includes("created container") ||
        lowerLine.includes("starting container") ||
        lowerLine.includes("started container") ||
        lowerLine.includes("extracting") ||
        lowerLine.includes("pull complete") ||
        lowerLine.includes("downloading") ||
        lowerLine.includes("pulling") ||
        lowerLine.includes("waiting") ||
        lowerLine.includes("verifying checksum") ||
        lowerLine.includes("download complete") ||
        lowerLine.includes("already exists") ||
        lowerLine.includes("downloaded newer image") ||
        lowerLine.includes("image is up to date") ||
        lowerLine.includes("digest:");

      if (isContainerDownloading) {
        const prevContainer = ctrl.stages.container;
        const prevLabel = ctrl.liveStepLabel;
        ctrl.stages.provision = "done";
        ctrl.stages.container = "active";
        ctrl.stages.cuda = "pending";
        ctrl.stages.ready = "pending";
        ctrl.liveStepLabel = "Загрузка контейнера";
        ctrl.subtitle = "Загрузка Docker-контейнера...";
        if (!deferUi && card && (prevContainer !== "active" || prevLabel !== "Загрузка контейнера")) {
          updatePodCardElement(ctrl, card);
        }
      } else if (
        ctrl.stages.container === "pending" &&
        (lowerLine.includes("assigning") ||
          lowerLine.includes("scheduling") ||
          lowerLine.includes("allocating") ||
          lowerLine.includes("mounting") ||
          lowerLine.includes("volume"))
      ) {
        ctrl.stages.provision = "active";
        ctrl.liveStepLabel = "Подготовка хоста";
        ctrl.subtitle = "Подготовка хоста и диска...";
        if (!deferUi && card) updatePodCardElement(ctrl, card);
      }
    }
    return;
  }

  if (source === "container") {
    ctrl.containerStarted = true;
    ctrl.stages.provision = "done";
    ctrl.stages.container = "done";

    if (!ctrl.cudaStagePassed && ctrl.stages.cuda !== "error" && ctrl.stages.ready !== "done") {
      if (ctrl.stages.cuda !== "active") {
        ctrl.stages.cuda = "active";
        ctrl.liveStepLabel = "Проверка CUDA";
        ctrl.subtitle = "Инициализация и проверка CUDA 13.0...";
      }
    }

    if (line.includes("Checking CUDA initialization") || line.includes("[cuda][warn] preflight")) {
      if (ctrl.stages.cuda !== "error") {
        ctrl.stages.cuda = "active";
        const attemptMatch = line.match(/preflight attempt (\d+\/\d+)/i);
        ctrl.liveStepLabel = attemptMatch
          ? `Проверка CUDA (${attemptMatch[1]})`
          : "Проверка CUDA";
        ctrl.subtitle = attemptMatch
          ? `Проверка CUDA 13.0 (попытка ${attemptMatch[1]})...`
          : "Инициализация и проверка CUDA 13.0...";
      }
    }

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
      if (ctrl.stages.ready !== "done") ctrl.stages.update = "active";
      ctrl.liveStepLabel = isPodRestoreBackupEnabled(ctrl) ? "Загрузка бэкапа" : "Обновление нод";
      ctrl.subtitle = isPodRestoreBackupEnabled(ctrl)
        ? "✓ Проверки пройдены. Обновление и загрузка бэкапа..."
        : "✓ Проверки пройдены. Обновление ComfyUI и нодов...";
    }

    if (ctrl.cudaStagePassed && ctrl.stages.ready !== "done") {
      if (line.includes("STAGE: Starting ComfyUI") || line.includes("Starting ComfyUI")) {
        ctrl.liveStepLabel = "Запуск ComfyUI";
        ctrl.subtitle = "Запуск ComfyUI...";
      } else if (line.includes("STAGE: Ensuring ComfyUI Manager") || line.includes("comfyui-manager")) {
        ctrl.liveStepLabel = "Настройка Manager";
        ctrl.subtitle = "Подготовка ComfyUI Manager...";
      } else if (line.includes("STAGE: Installing sageattention") || line.includes("sageattention")) {
        ctrl.liveStepLabel = "Установка SageAttention";
        ctrl.subtitle = "Установка оптимизаций SageAttention...";
      } else if (line.includes("STAGE: Updating ComfyUI and custom nodes") || line.includes("Updating:")) {
        ctrl.liveStepLabel = "Обновление нод";
        ctrl.subtitle = "Обновление ComfyUI и кастомных нод...";
      } else if (line.includes("STAGE: Restoring") || line.includes("[restore]")) {
        ctrl.liveStepLabel = "Восстановление бэкапа";
        ctrl.subtitle = "Восстановление бэкапа нод...";
      }
    }

    if (line.includes("To see the GUI go to:") || line.includes("ComfyUI is ready")) {
      ctrl.cudaStagePassed = true;
      ctrl.stages.cuda = "done";
      ctrl.stages.update = "done";
      ctrl.stages.ready = "done";
      ctrl.initialProbeDone = true;
      ctrl.liveStepLabel = "";
      ctrl.subtitle = "ComfyUI и Fizgig готовы к работе!";
      ctrl.status = "RUNNING";
    }

    if (!deferUi && card) updatePodCardElement(ctrl, card);
  }
}

async function pollHealthForPod(ctrl) {
  if (state.redeployInProgress || state.isTransitioningToPod) return;
  try {
    const pod = await runpodFetch(`/pods/${encodeURIComponent(ctrl.podId)}?includeMachine=true`);
    if (!pod || state.isTransitioningToPod) return;

    syncPodStateFromApi(ctrl, pod);

    if (!ctrl.isOurPod) {
      ctrl.initialProbeDone = true;
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
      return;
    }

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
      if (!ctrl.cudaFatalTriggered) {
        ctrl.cudaFatalTriggered = true;
        triggerRedeploy(ctrl.podId, "Сбой GPU на хосте (not enough GPUs free)");
      }
      return;
    }

    const podErrContainerReason = getContainerFatalReason(podErrStr, "system");
    if (podErrContainerReason) {
      ctrl.stages.provision = "done";
      ctrl.stages.container = "error";
      ctrl.subtitle = `✗ ${podErrContainerReason}`;
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
      if (!ctrl.cudaFatalTriggered) {
        ctrl.cudaFatalTriggered = true;
        triggerRedeploy(ctrl.podId, podErrContainerReason);
      }
      return;
    }

    if (pod.status === "TERMINATED") {
      stopPodController(ctrl);
      unmarkPodAsOurs(ctrl.podId);
      removePodLaunchMeta(ctrl.podId);
      state.podControllers.delete(ctrl.podId);
      renderPodsList();
      return;
    }

    if (pod.status === "EXITED") {
      ctrl.subtitle = "Под остановлен или удалён (EXITED).";
      const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
      if (card) updatePodCardElement(ctrl, card);
      return;
    }

    if (pod.status === "ERROR") {
      if (!ctrl.cudaFatalTriggered) {
        ctrl.cudaFatalTriggered = true;
        triggerRedeploy(ctrl.podId, `Статус пода: ${pod.status}`);
      }
      return;
    }

    syncPodStateFromApi(ctrl, pod);

    if (isPodRuntimeActive(pod)) {
      try {
        const statsRes = await fetch(`https://${ctrl.podId}-7860.proxy.runpod.net/system_stats`, {
          cache: "no-store"
        });
        if (statsRes.ok && ctrl.stages.cuda !== "error") {
          const statsData = await statsRes.json().catch(() => null);
          const argv = statsData?.system?.argv;
          if (Array.isArray(argv)) {
            const hasFastDisk = argv.some((arg) => String(arg).includes("fast-disk"));
            ctrl.diskStatus = hasFastDisk ? "fast" : "slow";
          } else if (!ctrl.diskStatus) {
            ctrl.diskStatus = "slow";
          }
          ctrl.containerStarted = true;
          ctrl.stages.provision = "done";
          ctrl.stages.container = "done";
          ctrl.cudaStagePassed = true;
          ctrl.stages.cuda = "done";
          ctrl.stages.update = "done";
          ctrl.stages.ready = "done";
          ctrl.liveStepLabel = "";
          ctrl.status = "RUNNING";
          ctrl.subtitle = "ComfyUI и Fizgig доступны и готовы к работе!";
        }
      } catch {
      } finally {
        ctrl.initialProbeDone = true;
      }
    } else {
      ctrl.initialProbeDone = true;
    }

    const card = document.querySelector(`.pod-card[data-pod-id="${ctrl.podId}"]`);
    if (card) updatePodCardElement(ctrl, card);
  } catch {}
}

function buildPayload(candidate) {
  const newManager = document.getElementById("opt-new-manager")?.checked ? "1" : "0";
  const restoreBackup = document.getElementById("opt-restore-backup")?.checked ? "1" : "0";
  const timerEnabled = document.getElementById("opt-shutdown-timer")?.checked ?? true;
  const rawMinutes = document.getElementById("opt-shutdown-minutes")
    ? parseInt(document.getElementById("opt-shutdown-minutes").value, 10)
    : 30;
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 30;
  const rawName = candidate.displayName || candidate.gpuId || candidate.tierKey || "gpu";
  const slug = String(rawName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "gpu";
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

  const minRamGb = normalizeMinRamGb(state.minRamGb);
  const gpuConfig = {
    id: candidate.gpuId,
    count: 1,
    allowedCudaVersions: tpl.allowedCudaVersions || ["13.0", "13.1", "13.2", "13.3", "13.4"]
  };
  if (minRamGb > 0) gpuConfig.minRamPerGpu = minRamGb;

  const payload = {
    name: `comfy-work-${slug}`,
    cloud: candidate.cloud,
    gpu: gpuConfig,
    disk: tpl.containerDiskGb || 15,
    mounts: {
      persistent: {
        size: tpl.volumeDiskGb || 200,
        path: tpl.volumeMountPath || "/workspace"
      }
    },
    env
  };

  if (tpl.templateId) {
    payload.templateId = tpl.templateId;
  } else {
    if (tpl.image) payload.image = tpl.image;
    payload.ports = tpl.ports?.length ? tpl.ports : DEFAULT_TEMPLATE.ports;
  }

  return payload;
}

async function deleteHeldBadPods(excludePodId = null) {
  const ids = [...state.heldBadPodIds].filter((id) => id && id !== excludePodId);
  for (const badId of ids) {
    state.heldBadPodIds.delete(badId);
    state.redeployTriggeredPodIds.delete(badId);
    unmarkPodAsOurs(badId);
    removePodLaunchMeta(badId);
    const badCtrl = state.podControllers.get(badId);
    if (badCtrl) {
      stopPodController(badCtrl);
      state.podControllers.delete(badId);
    }
    try {
      await runpodFetch(`/pods/${encodeURIComponent(badId)}`, { method: "DELETE" });
    } catch (delErr) {
      console.warn(`Предупреждение при удалении старого пода ${badId}:`, delErr);
    }
  }
}

function formatElapsedShort(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function startDeploymentSequence(candidates, oldBadPodId = null, { singleGpuOnly = false, huntMode = false } = {}) {
  if (singleGpuOnly && !state.deployCreateInFlight) {
    state.currentDeploySessionId = null;
    state.redeployInProgress = false;
  }
  if (state.deployCreateInFlight) {
    if (singleGpuOnly) alert("Сейчас уже выполняется запрос создания пода. Подождите пару секунд.");
    return;
  }

  if (!oldBadPodId) {
    state.redeployCount = 0;
  }

  const podsSection = document.getElementById("pods-section");
  if (podsSection) podsSection.hidden = false;

  const pendingCard = document.getElementById("pending-deploy-card");
  const pendingTitle = document.getElementById("pending-deploy-title");
  const pendingSub = document.getElementById("pending-deploy-subtitle");
  const pendingGpus = document.getElementById("pending-deploy-gpus");
  const pendingAlert = document.getElementById("pending-deploy-alert");
  const cancelBtn = document.getElementById("cancel-pending-deploy-btn");

  if (oldBadPodId) state.heldBadPodIds.add(oldBadPodId);

  const sessionId = Symbol("deploy-session");
  const sessionStartedAt = Date.now();
  state.currentDeploySessionId = sessionId;
  updateLeftColumnOrder();

  const isSingleCandidate = Boolean(singleGpuOnly && candidates.length === 1);
  let lastGpuKey = null;
  let lastWasHidden = null;

  const getHuntTitle = (list, isSingle, isHunt, hasHeld) => {
    if (hasHeld) return "Поиск замены";
    if (isHunt && list.length > 1) return "Охота за GPU";
    if (isHunt && list[0]) return `Охота: ${list[0].displayName}`;
    if (isSingle && list[0]) return `Запуск: ${list[0].displayName}`;
    return "Поиск свободной GPU";
  };

  const formatHuntMeta = () => `Попытка ${Math.max(1, state.redeployCount)} · ${formatElapsedShort(Date.now() - sessionStartedAt)}`;

  const syncPendingRetryUI = ({ title, sub, alertText, alertClass, candidatesList }) => {
    let sourceList = candidatesList?.length ? candidatesList : candidates;
    if (!sourceList?.length && !isSingleCandidate) {
      sourceList = state.catalogRows.filter((r) => isGpuDesiredByUser(r));
    }
    const gpuIds = new Set((sourceList || []).map((c) => c.gpuId).filter(Boolean));
    const gpuNames = new Set((sourceList || []).map((c) => c.displayName).filter(Boolean));
    const badPodIds = new Set(oldBadPodId ? [oldBadPodId] : []);
    state.heldRetryInfo = { title, sub, alertText, alertClass, gpuIds, gpuNames, badPodIds };

    let hasMergedHeldPod = false;
    for (const heldCtrl of state.podControllers.values()) {
      if (isHeldPodMergedWithRetry(heldCtrl)) {
        hasMergedHeldPod = true;
        break;
      }
    }

    if (pendingCard) pendingCard.hidden = hasMergedHeldPod;
    if (pendingTitle && title) pendingTitle.textContent = title;
    if (pendingSub) pendingSub.textContent = sub || "";

    if (pendingGpus) {
      const gpuKey = (sourceList || []).map((c) => `${c.gpuId}:${c.cloud}:${c.price}`).join("|");
      if (gpuKey !== lastGpuKey) {
        lastGpuKey = gpuKey;
        pendingGpus.replaceChildren();
        if (sourceList?.length) {
          pendingGpus.hidden = false;
          for (const c of sourceList) {
            const pill = document.createElement("span");
            pill.className = "badge badge-subtle";
            const cloudLabel = String(c.cloud || "COMMUNITY").toUpperCase() === "SECURE" ? "Secure" : "Community";
            pill.textContent = `${c.displayName} · ${cloudLabel}`;
            pendingGpus.appendChild(pill);
          }
        } else {
          pendingGpus.hidden = true;
        }
      }
    }

    if (pendingAlert) {
      pendingAlert.hidden = !alertText;
      if (alertText) {
        pendingAlert.className = alertClass || "monitor-alert alert-error";
        pendingAlert.textContent = alertText;
      } else {
        pendingAlert.textContent = "";
      }
    }

    updateLeftColumnOrder();
    if (hasMergedHeldPod || lastWasHidden !== hasMergedHeldPod) {
      lastWasHidden = hasMergedHeldPod;
      renderPodsList();
    }
  };

  syncPendingRetryUI({
    title: getHuntTitle(candidates, isSingleCandidate, huntMode, Boolean(oldBadPodId)),
    sub: candidates[0] && isSingleCandidate && !huntMode
      ? `Запуск · ${candidates[0].price.toFixed(2)} $/ч`
      : formatHuntMeta(),
    alertText: "",
    alertClass: "monitor-alert",
    candidatesList: candidates
  });

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      state.currentDeploySessionId = null;
      state.redeployInProgress = false;
      state.heldRetryInfo = null;
      if (pendingCard) pendingCard.hidden = true;
      updateLeftColumnOrder();
      renderPodsList();
    };
  }

  while (state.currentDeploySessionId === sessionId) {
    let currentCandidates = candidates;
    if (huntMode && !isSingleCandidate) {
      const avail = getSelectedCandidatesQueue();
      const unavail = getSelectedUnavailableCandidates();
      currentCandidates = avail.length > 0 ? avail : (unavail.length > 0 ? unavail : candidates);
    } else if (!isSingleCandidate) {
      currentCandidates = getSelectedCandidatesQueue();
    }

    let lastErrorMessage = "";
    let isFatalAuthOrBilling = false;

    if (huntMode && currentCandidates.length > 1) {
      if (state.currentDeploySessionId !== sessionId || state.deployCreateInFlight) return;
      state.redeployCount += 1;
      state.deployCreateInFlight = true;

      syncPendingRetryUI({
        title: getHuntTitle(currentCandidates, isSingleCandidate, huntMode, Boolean(oldBadPodId || state.heldBadPodIds.size > 0)),
        sub: formatHuntMeta(),
        alertText: "",
        alertClass: "monitor-alert",
        candidatesList: currentCandidates
      });

      let winner = null;
      try {
        await Promise.all(
          currentCandidates.map(async (candidate) => {
            if (state.currentDeploySessionId !== sessionId || winner) return;
            try {
              const payload = buildPayload(candidate);
              const created = await runpodFetch("/pods", { method: "POST", body: JSON.stringify(payload) });
              const newPodId = created?.id;
              if (!newPodId) throw new Error("пустой ID");
              if (!winner && state.currentDeploySessionId === sessionId) {
                winner = { candidate, created };
              } else {
                runpodFetch(`/pods/${encodeURIComponent(newPodId)}`, { method: "DELETE" }).catch(() => {});
              }
            } catch (err) {
              const msg = err.message || "ошибка";
              lastErrorMessage = msg;
              const lowerErr = msg.toLowerCase();
              if (
                msg.includes("401") || msg.includes("402") || msg.includes("403") ||
                lowerErr.includes("unauthorized") || lowerErr.includes("payment") || lowerErr.includes("balance")
              ) {
                isFatalAuthOrBilling = true;
              }
            }
          })
        );
      } finally {
        state.deployCreateInFlight = false;
      }

      if (state.currentDeploySessionId !== sessionId) return;

      if (winner) {
        const { candidate, created } = winner;
        const newPodId = created.id;
        markPodAsOurs(newPodId);
        savePodLaunchMeta(newPodId, { launchMode: "queue", huntMode, candidate });
        await deleteHeldBadPods(newPodId);
        if (pendingCard) pendingCard.hidden = true;
        if (state.currentDeploySessionId === sessionId) state.currentDeploySessionId = null;
        state.heldRetryInfo = null;

        const ctrl = getOrCreatePodController(newPodId, {
          displayName: candidate.displayName,
          gpuId: candidate.gpuId,
          gpuName: candidate.displayName,
          cloud: candidate.cloud,
          price: candidate.price,
          status: created.status || "CREATED",
          pod: created,
          isOurPod: true,
          isExpanded: true
        });
        ctrl.launchMode = "queue";
        ctrl.huntMode = Boolean(huntMode);
        ctrl.launchCandidate = candidate;
        updateLeftColumnOrder();
        await Promise.all([fetchActivePods(), fetchBalance()]);
        if (!ctrl.logAbortController) startLogStreamForPod(ctrl);
        return;
      }

      if (isFatalAuthOrBilling) {
        if (state.currentDeploySessionId === sessionId) state.currentDeploySessionId = null;
        syncPendingRetryUI({
          title: "Охота остановлена",
          sub: formatHuntMeta(),
          alertText: `Критическая ошибка: ${lastErrorMessage}`,
          alertClass: "monitor-alert alert-error",
          candidatesList: currentCandidates
        });
        return;
      }

      for (let sec = 3; sec > 0; sec--) {
        if (state.currentDeploySessionId !== sessionId) return;
        syncPendingRetryUI({
          title: getHuntTitle(currentCandidates, isSingleCandidate, huntMode, Boolean(oldBadPodId || state.heldBadPodIds.size > 0)),
          sub: formatHuntMeta(),
          alertText: "",
          alertClass: "monitor-alert",
          candidatesList: currentCandidates
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      continue;
    }

    for (const candidate of currentCandidates) {
      if (state.currentDeploySessionId !== sessionId) return;
      state.redeployCount += 1;

      const heldList = [...state.heldBadPodIds];
      const hasHeld = heldList.length > 0;
      syncPendingRetryUI({
        title: getHuntTitle(currentCandidates, isSingleCandidate, huntMode, hasHeld),
        sub: state.redeployCount === 1 && !huntMode && !hasHeld
          ? `Запуск · ${candidate.price.toFixed(2)} $/ч`
          : formatHuntMeta(),
        alertText: "",
        alertClass: "monitor-alert",
        candidatesList: currentCandidates
      });

      if (state.currentDeploySessionId !== sessionId || state.deployCreateInFlight) return;
      state.deployCreateInFlight = true;
      let created = null;
      try {
        created = await runpodFetch("/pods", { method: "POST", body: JSON.stringify(buildPayload(candidate)) });
      } catch (err) {
        state.deployCreateInFlight = false;
        lastErrorMessage = err.message || "";
        const lowerErr = lastErrorMessage.toLowerCase();
        if (
          lastErrorMessage.includes("401") || lastErrorMessage.includes("402") || lastErrorMessage.includes("403") ||
          lowerErr.includes("unauthorized") || lowerErr.includes("payment") || lowerErr.includes("balance")
        ) {
          isFatalAuthOrBilling = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      state.deployCreateInFlight = false;

      try {
        const newPodId = created?.id;
        if (!newPodId) throw new Error("RunPod вернул пустой ID.");

        markPodAsOurs(newPodId);
        savePodLaunchMeta(newPodId, {
          launchMode: isSingleCandidate ? "single" : "queue",
          huntMode,
          candidate
        });
        await deleteHeldBadPods(newPodId);
        if (pendingCard) pendingCard.hidden = true;
        if (state.currentDeploySessionId === sessionId) state.currentDeploySessionId = null;
        state.heldRetryInfo = null;

        const ctrl = getOrCreatePodController(newPodId, {
          displayName: candidate.displayName,
          gpuId: candidate.gpuId,
          gpuName: candidate.displayName,
          cloud: candidate.cloud,
          price: candidate.price,
          status: created.status || "CREATED",
          pod: created,
          isOurPod: true,
          isExpanded: true
        });
        ctrl.launchMode = isSingleCandidate ? "single" : "queue";
        ctrl.huntMode = Boolean(huntMode);
        ctrl.launchCandidate = candidate;
        updateLeftColumnOrder();

        await Promise.all([fetchActivePods(), fetchBalance()]);
        if (!ctrl.logAbortController) startLogStreamForPod(ctrl);
        return;
      } catch (err) {
        lastErrorMessage = err.message || "";
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (state.currentDeploySessionId !== sessionId) return;

    if (isFatalAuthOrBilling) {
      if (state.currentDeploySessionId === sessionId) state.currentDeploySessionId = null;
      syncPendingRetryUI({
        title: "Запуск остановлен",
        sub: formatHuntMeta(),
        alertText: `Критическая ошибка: ${lastErrorMessage}`,
        alertClass: "monitor-alert alert-error",
        candidatesList: currentCandidates
      });
      return;
    }

    const autoRedeploy = document.getElementById("opt-auto-redeploy")?.checked;
    if (!huntMode && !autoRedeploy) {
      if (state.currentDeploySessionId === sessionId) state.currentDeploySessionId = null;
      await deleteHeldBadPods();
      await fetchActivePods();
      syncPendingRetryUI({
        title: getHuntTitle(currentCandidates, isSingleCandidate, huntMode, false),
        sub: formatHuntMeta(),
        alertText: `Выбранные видеокарты недоступны: ${lastErrorMessage || "нет свободных машин"}.`,
        alertClass: "monitor-alert alert-error",
        candidatesList: currentCandidates
      });
      return;
    }

    const waitSeconds = huntMode ? 3 : 5;
    for (let sec = waitSeconds; sec > 0; sec--) {
      if (state.currentDeploySessionId !== sessionId) return;
      syncPendingRetryUI({
        title: getHuntTitle(currentCandidates, isSingleCandidate, huntMode, Boolean(oldBadPodId || state.heldBadPodIds.size > 0)),
        sub: formatHuntMeta(),
        alertText: "",
        alertClass: "monitor-alert",
        candidatesList: currentCandidates
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (state.currentDeploySessionId !== sessionId) return;
    if (!huntMode) {
      try { await fetchGpuCatalog(true); } catch {}
    }
  }
}

async function triggerRedeploy(badPodId, reason) {
  if (!badPodId || state.redeployTriggeredPodIds.has(badPodId)) return;
  state.redeployTriggeredPodIds.add(badPodId);

  const ctrl = state.podControllers.get(badPodId);
  if (ctrl) ctrl.cudaFatalTriggered = true;

  const alreadyDeployed = Boolean(ctrl && (ctrl.cudaStagePassed || ctrl.stages.ready === "done"));
  const autoRetryDeploy = document.getElementById("opt-auto-redeploy")?.checked;

  if (alreadyDeployed || !autoRetryDeploy) {
    if (ctrl) {
      ctrl.alert = {
        msg: alreadyDeployed
          ? `Ошибка работающего пода (${reason}). Авто-перезапуск отключён.`
          : `Ошибка деплоя (${reason}). Повторные попытки отключены.`,
        level: "error"
      };
      const card = document.querySelector(`.pod-card[data-pod-id="${badPodId}"]`);
      if (card) updatePodCardElement(ctrl, card);
    }
    return;
  }

  state.heldBadPodIds.add(badPodId);
  if (ctrl) {
    ctrl.alert = { msg: `Ошибка деплоя (${reason}). Перезапуск пода...`, level: "warn" };
    const card = document.querySelector(`.pod-card[data-pod-id="${badPodId}"]`);
    if (card) updatePodCardElement(ctrl, card);
  }

  if (state.redeployInProgress || state.currentDeploySessionId !== null) return;

  state.redeployInProgress = true;
  try {
    if (ctrl?.launchMode === "queue") {
      await fetchGpuCatalog(true);
      await startDeploymentSequence(getSelectedCandidatesQueue(), badPodId, {
        singleGpuOnly: false,
        huntMode: Boolean(ctrl.huntMode)
      });
    } else {
      const pinnedCandidate = ctrl?.launchCandidate || (ctrl?.gpuId
        ? {
            gpuId: ctrl.gpuId,
            displayName: ctrl.gpuName || cleanGpuName(ctrl.gpuId, ""),
            cloud: ctrl.cloud || "COMMUNITY",
            price: getPodHourlyPrice(ctrl)
          }
        : null);
      if (pinnedCandidate?.gpuId) {
        await startDeploymentSequence([pinnedCandidate], badPodId, {
          singleGpuOnly: true,
          huntMode: Boolean(ctrl?.huntMode)
        });
      } else {
        await fetchGpuCatalog(true);
        await startDeploymentSequence(getSelectedCandidatesQueue(), badPodId, { singleGpuOnly: false });
      }
    }
  } finally {
    state.redeployInProgress = false;
  }
}

function getSelectedCandidatesQueue() {
  const maxPrice = getMaxPriceFromSlider();
  const minRamGb = normalizeMinRamGb(state.minRamGb);
  return state.catalogRows.filter((r) => {
    if (r.price > maxPrice) return false;
    if (rowFailsRamFilter(r, minRamGb)) return false;
    if (!isGpuDesiredByUser(r)) return false;
    if (r.availability === "NONE") return false;
    if (state.secureOnly && r.cloud !== "SECURE") return false;
    return true;
  });
}

function getSelectedUnavailableCandidates() {
  const maxPrice = getMaxPriceFromSlider();
  const minRamGb = normalizeMinRamGb(state.minRamGb);
  return state.catalogRows.filter((r) => {
    if (r.price > maxPrice) return false;
    if (rowFailsRamFilter(r, minRamGb)) return false;
    if (!isGpuDesiredByUser(r)) return false;
    if (r.availability !== "NONE") return false;
    if (state.secureOnly && r.cloud !== "SECURE") return false;
    return true;
  });
}

function hasAnyDesiredGpuMatchingFilters() {
  const maxPrice = getMaxPriceFromSlider();
  const minRamGb = normalizeMinRamGb(state.minRamGb);
  return state.catalogRows.some((r) => {
    if (r.price > maxPrice) return false;
    if (rowFailsRamFilter(r, minRamGb)) return false;
    if (!isGpuDesiredByUser(r)) return false;
    if (state.secureOnly && r.cloud !== "SECURE") return false;
    return true;
  });
}

/* ==========================================================================
   6. Auto-Refresh Loop
   ========================================================================== */

function startAutoRefreshLoop() {
  if (state.catalogRefreshTimerId) clearInterval(state.catalogRefreshTimerId);
  state.catalogRefreshTimerId = setInterval(() => {
    if (!document.hidden && state.hasApiKey && !state.redeployInProgress && !state.isTransitioningToPod) {
      fetchGpuCatalog(true);
      fetchActivePods();
      fetchBalance();
    }
  }, CATALOG_AUTO_REFRESH_MS);

  const refreshOnWake = () => {
    if (!document.hidden && state.hasApiKey && !state.redeployInProgress && !state.isTransitioningToPod) {
      if (Date.now() - state.catalogLastFetchedAt > 2500) fetchGpuCatalog(true);
      fetchActivePods();
      fetchBalance();
    }
  };

  document.addEventListener("visibilitychange", refreshOnWake);
  window.addEventListener("focus", refreshOnWake);
  window.addEventListener("pageshow", refreshOnWake);
  window.addEventListener("online", refreshOnWake);
  window.addEventListener("beforeunload", () => {
    state.isTransitioningToPod = true;
  });
}

/* ==========================================================================
   7. Event Wiring & Init
   ========================================================================== */

async function init() {
  initExternalLinkDelegation();
  initTemplateControls();
  initOurPodIds();

  try {
    if (localStorage.getItem(STORAGE_KEYS.HAD_KEY_HINT) === "1") {
      const dashboardMain = document.getElementById("dashboard-main");
      if (dashboardMain) dashboardMain.hidden = false;
      const podsSection = document.getElementById("pods-section");
      const podsLoading = document.getElementById("pods-loading-card");
      const authCard = document.getElementById("auth-card");
      if (podsSection) podsSection.hidden = true;
      if (podsLoading) podsLoading.hidden = true;
      if (authCard) authCard.hidden = true;
      setBalanceLoading(true);
      updateLeftColumnOrder();
    }
  } catch {}

  // Price Slider
  const slider = document.getElementById("max-price-slider");
  const priceVal = document.getElementById("max-price-val");
  slider.min = "0";
  slider.max = String(PRICE_STEPS.length - 1);
  slider.step = "1";

  const savedPrice = localStorage.getItem(STORAGE_KEYS.MAX_PRICE);
  const updateRangeTrackFill = (el) => {
    if (!el) return;
    const min = Number.parseFloat(el.min || "0");
    const max = Number.parseFloat(el.max || "100");
    const val = Number.parseFloat(el.value || "0");
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    el.style.setProperty("--range-pct", `${Math.max(0, Math.min(100, pct))}%`);
  };

  const initIdx = savedPrice !== null ? findClosestPriceStepIndex(savedPrice) : DEFAULT_PRICE_STEP_INDEX;
  slider.value = String(initIdx);
  const initPrice = PRICE_STEPS[initIdx];
  priceVal.textContent = `${initPrice.toFixed(2)} $/ч`;
  updateRangeTrackFill(slider);

  const onPriceChange = () => {
    const price = getMaxPriceFromSlider();
    const val = price.toFixed(2);
    priceVal.textContent = `${val} $/ч`;
    updateRangeTrackFill(slider);
    localStorage.setItem(STORAGE_KEYS.MAX_PRICE, val);
    renderGpuTable();
  };
  slider.addEventListener("input", onPriceChange);
  slider.addEventListener("change", onPriceChange);

  // Min System RAM Filter
  const minRamInput = document.getElementById("min-ram-input");
  const minRamVal = document.getElementById("min-ram-val");
  const ramSliderBox = document.getElementById("ram-slider-box");
  const resetRamBtn = document.getElementById("reset-ram-btn");
  if (minRamInput) {
    const savedMinRam = localStorage.getItem(STORAGE_KEYS.MIN_RAM);
    state.minRamGb = Math.min(128, Math.round(normalizeMinRamGb(savedMinRam) / 4) * 4);
    minRamInput.value = String(state.minRamGb);

    const updateRamLabel = () => {
      const isActive = state.minRamGb > 0;
      if (minRamVal) {
        minRamVal.textContent = isActive ? `${state.minRamGb} ГБ` : "любое";
        minRamVal.classList.toggle("is-active", isActive);
      }
      if (ramSliderBox) ramSliderBox.classList.toggle("is-filtered", isActive);
      if (resetRamBtn) resetRamBtn.hidden = !isActive;
      updateRangeTrackFill(minRamInput);
    };
    updateRamLabel();

    const onRamInput = () => {
      state.minRamGb = Math.min(128, Math.round(normalizeMinRamGb(minRamInput.value) / 4) * 4);
      localStorage.setItem(STORAGE_KEYS.MIN_RAM, String(state.minRamGb));
      updateRamLabel();
      renderGpuTable();
    };
    minRamInput.addEventListener("input", onRamInput);
    minRamInput.addEventListener("change", () => {
      onRamInput();
      minRamInput.value = String(state.minRamGb);
    });
    if (resetRamBtn) {
      resetRamBtn.addEventListener("click", () => {
        state.minRamGb = 0;
        minRamInput.value = "0";
        localStorage.setItem(STORAGE_KEYS.MIN_RAM, "0");
        updateRamLabel();
        renderGpuTable();
      });
    }
  }

  // Key Visibility & Safety Info
  const keyInput = document.getElementById("runpod-api-key");
  const toggleKeyBtn = document.getElementById("toggle-key-btn");
  const saveKeyBtn = document.getElementById("save-key-btn");

  toggleKeyBtn.addEventListener("click", () => {
    const isPw = keyInput.type === "password";
    keyInput.type = isPw ? "text" : "password";
    toggleKeyBtn.textContent = isPw ? "Скрыть" : "Показать";
  });

  const safetyToggleBtn = document.getElementById("api-safety-toggle");
  const onboardingSafetyBtn = document.getElementById("onboarding-safety-btn");
  const safetyModalEl = document.getElementById("api-safety-modal");
  const safetyCloseBtn = document.getElementById("api-safety-close");
  if (safetyModalEl) {
    const closeSafetyModal = () => {
      safetyModalEl.hidden = true;
    };
    const openSafetyModal = () => {
      safetyModalEl.hidden = false;
    };
    safetyToggleBtn?.addEventListener("click", openSafetyModal);
    onboardingSafetyBtn?.addEventListener("click", openSafetyModal);
    safetyCloseBtn?.addEventListener("click", closeSafetyModal);
    safetyModalEl.addEventListener("click", (e) => {
      if (e.target === safetyModalEl) closeSafetyModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !safetyModalEl.hidden) {
        closeSafetyModal();
      }
    });
  }

  // Centered Onboarding API Key Probe & Sign-In
  const onbKeyInput = document.getElementById("onboarding-api-key");
  const onbPanel = document.getElementById("onboarding-panel");
  const onbToggleKeyBtn = document.getElementById("onboarding-toggle-key");
  const onbClearBtn = document.getElementById("onboarding-clear-btn");
  const onbHeroCard = document.getElementById("onboarding-hero-card");
  const onbGuideView = document.getElementById("onboarding-guide-view");
  const onbProbeView = document.getElementById("onboarding-probe-view");
  const onbHeroStatus = document.getElementById("onboarding-hero-status");
  const onbProbeSpinner = document.getElementById("onboarding-probe-spinner");
  const onbHeroStatusText = document.getElementById("onboarding-hero-status-text");
  const onbHeroTitle = document.getElementById("onboarding-hero-title");
  const onbHeroSub = document.getElementById("onboarding-hero-sub");
  const onbRestDesc = document.getElementById("probe-rest-desc");
  const onbRestStatus = document.getElementById("probe-rest-status");
  const onbGqlDesc = document.getElementById("probe-gql-desc");
  const onbGqlStatus = document.getElementById("probe-gql-status");
  const onbExpDesc = document.getElementById("probe-exp-desc");
  const onbExpStatus = document.getElementById("probe-exp-status");
  const onbLoginBtn = document.getElementById("onboarding-login-btn");

  let onboardingProbeTimer = null;
  let onboardingProbeSeq = 0;
  let lastProbedKey = "";

  const setToneClass = (el, tone) => {
    if (!el) return;
    el.classList.remove("is-ok", "is-warn", "is-error", "is-muted");
    if (tone) el.classList.add(tone);
  };

  const resetOnboardingState = (clearValue = true) => {
    onboardingProbeSeq += 1;
    if (onboardingProbeTimer) {
      clearTimeout(onboardingProbeTimer);
      onboardingProbeTimer = null;
    }
    lastProbedKey = "";
    if (clearValue && onbKeyInput) {
      onbKeyInput.value = "";
      onbKeyInput.type = "password";
    }
    if (onbToggleKeyBtn) onbToggleKeyBtn.textContent = "Показать";
    if (onbPanel) onbPanel.classList.remove("has-verified-key");
    if (onbGuideView) onbGuideView.hidden = false;
    if (onbProbeView) onbProbeView.hidden = true;
    setToneClass(onbHeroCard, "");
    setToneClass(onbHeroStatus, "");
    if (onbProbeSpinner) onbProbeSpinner.hidden = true;
    if (onbHeroStatusText) onbHeroStatusText.textContent = "Проверка ключа...";
    if (onbHeroTitle) onbHeroTitle.textContent = "—";
    if (onbHeroSub) onbHeroSub.textContent = "Запрашиваем баланс и email аккаунта...";
    if (onbRestDesc) onbRestDesc.textContent = "All resources: Read + Write";
    if (onbRestStatus) onbRestStatus.textContent = "Ожидает ключ";
    setToneClass(onbRestStatus, "is-muted");
    if (onbGqlDesc) onbGqlDesc.textContent = "Read & Write (достаточно Read only)";
    if (onbGqlStatus) onbGqlStatus.textContent = "Ожидает ключ";
    setToneClass(onbGqlStatus, "is-muted");
    if (onbExpDesc) onbExpDesc.textContent = "Дата окончания работы ключа";
    if (onbExpStatus) onbExpStatus.textContent = "Ожидает ключ";
    setToneClass(onbExpStatus, "is-muted");
    if (onbLoginBtn) {
      onbLoginBtn.disabled = true;
      onbLoginBtn.textContent = "Войти";
    }
  };

  const renderProbeResult = (data) => {
    if (onbGuideView) onbGuideView.hidden = true;
    if (onbProbeView) onbProbeView.hidden = false;
    if (onbProbeSpinner) onbProbeSpinner.hidden = true;

    const checks = data?.checks || {};
    const rest = checks.rest || {};
    const gql = checks.graphql || {};
    const expiryInfo = formatKeyExpiryInfo(data?.keyInfo);

    if (data?.authValid) {
      const isExpired = Boolean(expiryInfo?.expired);
      if (onbPanel) onbPanel.classList.toggle("has-verified-key", !isExpired);
      const allReady = Boolean(rest.ok && gql.ok);
      const heroTone = isExpired ? "is-error" : (allReady ? "is-ok" : "is-warn");
      setToneClass(onbHeroCard, heroTone);
      setToneClass(onbHeroStatus, heroTone);
      if (onbHeroStatusText) {
        const keyName = data?.keyInfo?.name ? ` · ${data.keyInfo.name}` : "";
        onbHeroStatusText.textContent = isExpired
          ? `✕ Срок действия ключа истёк${keyName}`
          : (allReady
              ? `✓ Ключ подтверждён${keyName}`
              : `⚠ Ключ принят (неполные права)${keyName}`);
      }
      const balNum = Number(data.clientBalance);
      const emailStr = typeof data.email === "string" && data.email.trim() ? data.email.trim() : "";
      if (onbHeroTitle) {
        onbHeroTitle.textContent = isExpired
          ? "Ключ просрочен"
          : (Number.isFinite(balNum)
              ? `$${balNum.toFixed(2)}`
              : (emailStr || "Ключ принят"));
      }
      const subParts = [];
      if (isExpired) {
        subParts.push("Перевыпустите ключ в RunPod API Keys и вставьте новый");
      } else {
        if (emailStr && Number.isFinite(balNum)) subParts.push(emailStr);
        const spend = Number(data.currentSpendPerHr);
        if (Number.isFinite(spend) && spend > 0) {
          subParts.push(`расход $${spend.toFixed(2)}/ч`);
        } else if (!gql.ok) {
          subParts.push("баланс недоступен без GraphQL Read");
        }
      }
      if (onbHeroSub) {
        onbHeroSub.textContent = subParts.join(" · ") || "Аккаунт RunPod подключён";
      }

      if (onbRestDesc) {
        onbRestDesc.textContent = rest.ok
          ? (rest.allResources ? "All resources (Read + Write)" : "Pods · Templates · Catalog доступны")
          : `Не хватает: ${(rest.missing || []).join(", ") || "доступа REST"}`;
      }
      if (onbRestStatus) onbRestStatus.textContent = isExpired ? "Недоступно" : (rest.ok ? "Подтверждено" : "Неполные права");
      setToneClass(onbRestStatus, isExpired ? "is-muted" : (rest.ok ? "is-ok" : "is-warn"));

      if (onbGqlDesc) {
        const permLabel = gql.permissions === "RW"
          ? "Read & Write"
          : (gql.permissions === "R" ? "Read only (достаточно)" : "Баланс и email");
        onbGqlDesc.textContent = gql.ok
          ? permLabel
          : "Включите Read или Read, Write в GraphQL";
      }
      if (onbGqlStatus) onbGqlStatus.textContent = isExpired ? "Недоступно" : (gql.ok ? "Подтверждено" : "Нет доступа");
      setToneClass(onbGqlStatus, isExpired ? "is-muted" : (gql.ok ? "is-ok" : "is-warn"));

      if (onbExpDesc) {
        if (!gql.ok) {
          onbExpDesc.textContent = "Недоступно без GraphQL";
        } else if (!data?.keyInfo) {
          onbExpDesc.textContent = "Данные ключа недоступны";
        } else if (!data.keyInfo.expiresAt) {
          onbExpDesc.textContent = "Без ограничения по времени";
        } else {
          const ms = Date.parse(data.keyInfo.expiresAt);
          const formatted = Number.isFinite(ms)
            ? new Intl.DateTimeFormat("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric"
              }).format(ms).replace(/\s?г\.?$/, "")
            : data.keyInfo.expiresAt;
          onbExpDesc.textContent = isExpired ? `Истёк ${formatted}` : `Активен до ${formatted}`;
        }
      }
      if (onbExpStatus) {
        if (!gql.ok || !expiryInfo) {
          onbExpStatus.textContent = gql.ok ? "Активен" : "Нет доступа";
          setToneClass(onbExpStatus, gql.ok ? "is-ok" : "is-muted");
        } else if (expiryInfo.expired) {
          onbExpStatus.textContent = expiryInfo.daysText;
          setToneClass(onbExpStatus, "is-error");
        } else if (!data.keyInfo.expiresAt) {
          onbExpStatus.textContent = expiryInfo.daysText;
          setToneClass(onbExpStatus, "is-ok");
        } else {
          onbExpStatus.textContent = expiryInfo.daysText;
          setToneClass(onbExpStatus, expiryInfo.expiringSoon ? "is-warn" : "is-ok");
        }
      }
      if (onbLoginBtn) onbLoginBtn.disabled = isExpired;
      return;
    }

    if (onbPanel) onbPanel.classList.remove("has-verified-key");

    if (data?.backendNeedsRestart) {
      setToneClass(onbHeroCard, "is-warn");
      setToneClass(onbHeroStatus, "is-warn");
      if (onbHeroStatusText) onbHeroStatusText.textContent = "⚠ Бэкенд плагина ждёт перезапуска";
      if (onbHeroTitle) onbHeroTitle.textContent = "Можно войти сразу";
      if (onbHeroSub) {
        onbHeroSub.textContent = "Для предпроверки баланса и прав до входа перезапустите билд в Comfy Desktop, либо нажмите «Войти».";
      }
      if (onbRestStatus) onbRestStatus.textContent = "После входа";
      setToneClass(onbRestStatus, "is-muted");
      if (onbGqlStatus) onbGqlStatus.textContent = "После входа";
      setToneClass(onbGqlStatus, "is-muted");
      if (onbExpStatus) onbExpStatus.textContent = "После входа";
      setToneClass(onbExpStatus, "is-muted");
      if (onbLoginBtn) onbLoginBtn.disabled = false;
      return;
    }

    // Invalid key or network error
    const isNetErr = Boolean(data?.networkError);
    setToneClass(onbHeroCard, isNetErr ? "is-warn" : "is-error");
    setToneClass(onbHeroStatus, isNetErr ? "is-warn" : "is-error");
    if (onbHeroStatusText) {
      onbHeroStatusText.textContent = isNetErr ? "⚠ Ошибка сети" : "✕ Ключ отклонён";
    }
    if (onbHeroTitle) {
      onbHeroTitle.textContent = isNetErr ? "Не удалось связаться с RunPod" : "Недействительный или просроченный ключ";
    }
    if (onbHeroSub) {
      onbHeroSub.textContent = data?.error || "Проверьте ключ или перевыпустите его в RunPod API Keys";
    }
    if (onbRestStatus) onbRestStatus.textContent = isNetErr ? "Нет ответа" : "Отклонён";
    setToneClass(onbRestStatus, isNetErr ? "is-warn" : "is-error");
    if (onbGqlStatus) onbGqlStatus.textContent = isNetErr ? "Нет ответа" : "Отклонён";
    setToneClass(onbGqlStatus, isNetErr ? "is-warn" : "is-error");
    if (onbExpStatus) onbExpStatus.textContent = isNetErr ? "Нет ответа" : "Отклонён";
    setToneClass(onbExpStatus, isNetErr ? "is-warn" : "is-error");
    if (onbLoginBtn) onbLoginBtn.disabled = !isNetErr;
  };

  const runOnboardingProbe = async (rawKey) => {
    const trimmed = String(rawKey || "").trim();
    if (!trimmed) {
      resetOnboardingState(false);
      return;
    }
    if (trimmed.length < 10) {
      onboardingProbeSeq += 1;
      if (onbPanel) onbPanel.classList.remove("has-verified-key");
      if (onbGuideView) onbGuideView.hidden = false;
      if (onbProbeView) onbProbeView.hidden = true;
      setToneClass(onbHeroCard, "");
      if (onbRestStatus) onbRestStatus.textContent = "Ожидает полный ключ";
      setToneClass(onbRestStatus, "is-muted");
      if (onbGqlStatus) onbGqlStatus.textContent = "Ожидает полный ключ";
      setToneClass(onbGqlStatus, "is-muted");
      if (onbExpStatus) onbExpStatus.textContent = "Ожидает полный ключ";
      setToneClass(onbExpStatus, "is-muted");
      if (onbLoginBtn) onbLoginBtn.disabled = true;
      return;
    }
    if (trimmed === lastProbedKey) return;

    const seq = ++onboardingProbeSeq;
    if (onbGuideView) onbGuideView.hidden = true;
    if (onbProbeView) onbProbeView.hidden = false;
    setToneClass(onbHeroCard, "");
    setToneClass(onbHeroStatus, "");
    if (onbProbeSpinner) onbProbeSpinner.hidden = false;
    if (onbHeroStatusText) onbHeroStatusText.textContent = "Проверка ключа на RunPod...";
    if (onbHeroTitle) onbHeroTitle.textContent = "Подключение...";
    if (onbHeroSub) onbHeroSub.textContent = "Проверяем баланс, email и права доступа...";
    if (onbRestStatus) onbRestStatus.textContent = "Проверка...";
    setToneClass(onbRestStatus, "is-muted");
    if (onbGqlStatus) onbGqlStatus.textContent = "Проверка...";
    setToneClass(onbGqlStatus, "is-muted");
    if (onbExpStatus) onbExpStatus.textContent = "Проверка...";
    setToneClass(onbExpStatus, "is-muted");
    if (onbLoginBtn) onbLoginBtn.disabled = true;

    try {
      const tplId = state.currentTemplate?.templateId || DEFAULT_TEMPLATE.templateId;
      const headers = { Authorization: `Bearer ${trimmed}` };
      const endpoints = [
        { key: "Pods", url: `${RUNPOD_API_BASE}/pods` },
        { key: "Templates", url: `${RUNPOD_API_BASE}/templates/${encodeURIComponent(tplId)}` },
        { key: "Secrets", url: `${RUNPOD_API_BASE}/account/secrets` },
        { key: "Catalog", url: `${RUNPOD_API_BASE}/catalog/gpus` }
      ];
      const results = await Promise.all(
        endpoints.map(async (ep) => {
          try {
            const r = await fetch(ep.url, { headers, cache: "no-store" });
            const json = r.ok ? await r.json().catch(() => null) : null;
            return { key: ep.key, ok: r.ok, status: r.status, json };
          } catch {
            return { key: ep.key, ok: false, status: 0, json: null };
          }
        })
      );
      if (seq !== onboardingProbeSeq) return;
      const all401 = results.every((r) => r.status === 401);
      const anyNetErr = results.every((r) => r.status === 0);
      const missing = results.filter((r) => !r.ok).map((r) => r.key);
      const secretsRes = results.find((r) => r.key === "Secrets");
      const rawSecrets = Array.isArray(secretsRes?.json) ? secretsRes.json : (secretsRes?.json?.secrets || []);
      const configured = rawSecrets.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
      const authValid = !all401 && !anyNetErr && results.some((r) => r.ok || r.status === 403);
      const data = {
        ok: authValid && missing.length === 0,
        authValid,
        networkError: anyNetErr,
        error: all401 ? "Недействительный или просроченный API-ключ (HTTP 401)." : (anyNetErr ? "Не удалось подключиться к api.runpod.io." : null),
        email: "RunPod REST API",
        checks: {
          rest: { ok: missing.length === 0, missing, allResources: missing.length === 0 },
          graphql: { ok: Boolean(secretsRes?.ok), status: secretsRes?.status || 0, permissions: configured.length ? `${configured.length}/3` : "0/3" },
          secrets: { ok: Boolean(secretsRes?.ok), status: secretsRes?.status || 0, configured }
        }
      };
      lastProbedKey = trimmed;
      renderProbeResult(data);
      if (onbGqlDesc && onbGqlStatus && authValid) {
        const expected = ["HF_TOKEN", "CIVITAI_API_KEY", "COMFYUI_BACKUP"];
        const found = expected.filter((k) => configured.includes(k));
        onbGqlDesc.textContent = found.length ? found.join(", ") : "Секреты не настроены (необязательно)";
        onbGqlStatus.textContent = `${found.length}/3`;
        setToneClass(onbGqlStatus, found.length === 3 ? "is-ok" : "is-muted");
      }
      if (onbHeroTitle && authValid) {
        onbHeroTitle.textContent = missing.length === 0 ? "Ключ подтверждён" : "Недостаточно прав";
      }
      if (onbHeroSub && authValid) {
        onbHeroSub.textContent = missing.length === 0
          ? "REST API доступен — можно войти и запускать поды"
          : `Нет доступа: ${missing.join(", ")}`;
      }
    } catch {
      if (seq !== onboardingProbeSeq) return;
      renderProbeResult({
        authValid: false,
        networkError: true,
        error: "Не удалось подключиться к api.runpod.io."
      });
    }
  };

  if (onbKeyInput) {
    onbToggleKeyBtn?.addEventListener("click", () => {
      const isPw = onbKeyInput.type === "password";
      onbKeyInput.type = isPw ? "text" : "password";
      if (onbToggleKeyBtn) onbToggleKeyBtn.textContent = isPw ? "Скрыть" : "Показать";
    });

    onbClearBtn?.addEventListener("click", () => {
      resetOnboardingState(true);
      onbKeyInput.focus();
    });

    onbKeyInput.addEventListener("input", () => {
      if (onboardingProbeTimer) clearTimeout(onboardingProbeTimer);
      const val = onbKeyInput.value.trim();
      if (!val) {
        resetOnboardingState(false);
        return;
      }
      onboardingProbeTimer = setTimeout(() => runOnboardingProbe(val), 280);
    });

    onbKeyInput.addEventListener("paste", () => {
      if (onboardingProbeTimer) clearTimeout(onboardingProbeTimer);
      onboardingProbeTimer = setTimeout(() => runOnboardingProbe(onbKeyInput.value), 30);
    });

    onbKeyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (onbLoginBtn && !onbLoginBtn.disabled) {
          onbLoginBtn.click();
        } else {
          runOnboardingProbe(onbKeyInput.value);
        }
      }
    });
  }

  const saveEnteredApiKey = async (entered, triggerBtn, idleLabel) => {
    if (entered.length < 10) return;
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Вход...";
    }
    try {
      state.apiKey = entered;
      state.statusLoaded = true;
      state.hasApiKey = true;
      state.maskedKey = `${entered.slice(0, 6)}...${entered.slice(-2)}`;
      state.apiKeyInfo = null;
      state.initialPodsLoaded = false;
      state.initialProfileLoaded = false;
      state.apiKeyPermissionErrors.clear();
      try {
        localStorage.setItem(STORAGE_KEYS.API_KEY, entered);
        localStorage.setItem(STORAGE_KEYS.HAD_KEY_HINT, "1");
      } catch {}
      keyInput.value = "";
      keyInput.type = "password";
      toggleKeyBtn.textContent = "Показать";
      resetOnboardingState(true);
      updateApiKeyRequirementsBanner();
      updateLeftColumnOrder();
      await Promise.allSettled([fetchAccountInfo(), fetchActivePods(), fetchGpuCatalog()]);
      state.initialProfileLoaded = true;
      setBalanceLoading(false);
      updateApiKeyRequirementsBanner();
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = idleLabel;
      }
    }
  };

  const submitApiKey = () => saveEnteredApiKey(keyInput.value.trim(), saveKeyBtn, "Сохранить");
  onbLoginBtn?.addEventListener("click", () => {
    const entered = onbKeyInput?.value.trim() || "";
    saveEnteredApiKey(entered, onbLoginBtn, "Войти");
  });

  saveKeyBtn.addEventListener("click", submitApiKey);
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitApiKey();
    }
  });
  keyInput.addEventListener("change", () => {
    if (keyInput.value.trim().length >= 20) submitApiKey();
  });

  // Forget Key
  document.getElementById("forget-key-btn").addEventListener("click", async () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.API_KEY);
      localStorage.removeItem(STORAGE_KEYS.HAD_KEY_HINT);
    } catch {}

    state.apiKey = "";
    state.statusLoaded = true;
    state.hasApiKey = false;
    state.maskedKey = "";
    state.accountEmail = "";
    state.apiKeyInfo = null;
    state.initialPodsLoaded = false;
    state.initialProfileLoaded = true;
    state.currentDeploySessionId = null;
    state.heldRetryInfo = null;
    state.apiKeyPermissionErrors.clear();
    state.catalogRows = [];
    try {
      localStorage.removeItem(STORAGE_KEYS.HAD_KEY_HINT);
    } catch {}
    for (const ctrl of state.podControllers.values()) stopPodController(ctrl);
    state.podControllers.clear();

    keyInput.value = "";
    resetOnboardingState(true);
    updateApiKeyRequirementsBanner();
    updateLeftColumnOrder();
    fetchBalance();
    const podsLoadingCard = document.getElementById("pods-loading-card");
    if (podsLoadingCard) podsLoadingCard.hidden = true;
    document.getElementById("account-info-panel").hidden = true;
    document.getElementById("pods-section").hidden = true;
    document.getElementById("pods-list").replaceChildren();

    const tbody = document.getElementById("gpu-tbody");
    tbody.replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-cell";
    td.textContent = "Ключ удалён. Введите RunPod API Secret Key слева.";
    tr.appendChild(td);
    tbody.appendChild(tr);

    updateSelectedGpuCount();
    onbKeyInput?.focus();
  });

  // Secure Only & Show Unavailable
  const btnSecureOnly = document.getElementById("btn-secure-only");
  if (btnSecureOnly) {
    if (localStorage.getItem(STORAGE_KEYS.SECURE_ONLY) === "true") {
      state.secureOnly = true;
      btnSecureOnly.checked = true;
    }
    btnSecureOnly.addEventListener("change", () => {
      state.secureOnly = Boolean(btnSecureOnly.checked);
      localStorage.setItem(STORAGE_KEYS.SECURE_ONLY, state.secureOnly ? "true" : "false");
      renderGpuTable();
    });
  }

  const gpuCardEl = document.querySelector(".gpu-card");
  const btnShowUnavailable = document.getElementById("btn-show-unavailable");
  if (btnShowUnavailable) {
    if (localStorage.getItem(STORAGE_KEYS.SHOW_UNAVAILABLE) === "true") {
      state.showUnavailable = true;
      btnShowUnavailable.checked = true;
    }
    if (gpuCardEl) gpuCardEl.classList.toggle("show-unavailable-mode", state.showUnavailable);
    btnShowUnavailable.addEventListener("change", () => {
      state.showUnavailable = Boolean(btnShowUnavailable.checked);
      if (gpuCardEl) gpuCardEl.classList.toggle("show-unavailable-mode", state.showUnavailable);
      localStorage.setItem(STORAGE_KEYS.SHOW_UNAVAILABLE, state.showUnavailable ? "true" : "false");
      renderGpuTable();
    });
  }

  // Options
  loadOptions();
  for (const id of ["opt-new-manager", "opt-restore-backup", "opt-auto-redeploy"]) {
    document.getElementById(id)?.addEventListener("change", saveOptions);
  }
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

  document.getElementById("btn-select-none")?.addEventListener("click", () => {
    state.userSelectionOverrides.clear();
    for (const row of state.catalogRows) {
      state.userSelectionOverrides.set(row.rowId, false);
    }
    persistSelections();
    renderGpuTable();
  });

  document.getElementById("deploy-best-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const origText = btn.textContent;
    const isCatalogStale = !state.catalogLastFetchedAt
      || Date.now() - state.catalogLastFetchedAt > 3000
      || !!state.catalogFetchPromise
      || state.catalogRows.length === 0;

    if (isCatalogStale) {
      btn.disabled = true;
      btn.textContent = "Обновление списка GPU...";
      try { await fetchGpuCatalog(true); } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }

    const queue = getSelectedCandidatesQueue();
    if (queue.length === 0) {
      const unavailableQueue = getSelectedUnavailableCandidates();
      if (unavailableQueue.length > 0) {
        startDeploymentSequence(unavailableQueue, null, { singleGpuOnly: false, huntMode: true });
        return;
      }
      const autoRedeployChecked = document.getElementById("opt-auto-redeploy")?.checked;
      if (autoRedeployChecked && hasAnyDesiredGpuMatchingFilters()) {
        startDeploymentSequence([], null, { singleGpuOnly: false });
        return;
      }
      alert("Нет доступных видеокарт среди выбранных по текущим фильтрам.");
      return;
    }
    startDeploymentSequence(queue, null, { singleGpuOnly: false });
  });

  const refreshPodsBtn = document.getElementById("refresh-pods-btn");
  if (refreshPodsBtn) {
    refreshPodsBtn.addEventListener("click", async () => {
      refreshPodsBtn.classList.add("is-spinning");
      try {
        await Promise.all([fetchActivePods(), fetchBalance()]);
      } finally {
        refreshPodsBtn.classList.remove("is-spinning");
      }
    });
  }

  // Load saved API key & custom template from browser localStorage
  let savedTemplateId = null;
  try {
    const storedKey = (localStorage.getItem(STORAGE_KEYS.API_KEY) || "").trim();
    if (storedKey) {
      state.apiKey = storedKey;
      state.hasApiKey = true;
      state.maskedKey = `${storedKey.slice(0, 6)}...${storedKey.slice(-2)}`;
    }
    savedTemplateId = (localStorage.getItem(STORAGE_KEYS.CUSTOM_TEMPLATE_ID) || "").trim() || null;
  } catch {
  } finally {
    state.statusLoaded = true;
  }

  try {
    if (state.hasApiKey) localStorage.setItem(STORAGE_KEYS.HAD_KEY_HINT, "1");
    else localStorage.removeItem(STORAGE_KEYS.HAD_KEY_HINT);
  } catch {}

  updateApiKeyRequirementsBanner();
  startAutoRefreshLoop();

  if (state.hasApiKey) {
    state.initialProfileLoaded = false;
    updateApiKeyRequirementsBanner();
    if (savedTemplateId) {
      await loadTemplate(savedTemplateId);
    } else {
      updateTemplateUI();
    }
    const profileTasks = [fetchBalance(), fetchAccountInfo(), fetchActivePods()];
    fetchGpuCatalog();
    Promise.allSettled(profileTasks).finally(() => {
      state.initialProfileLoaded = true;
      setBalanceLoading(false);
      updateApiKeyRequirementsBanner();
      renderPodsList();
    });
  } else {
    state.initialProfileLoaded = true;
    const podsLoading = document.getElementById("pods-loading-card");
    const podsSection = document.getElementById("pods-section");
    if (podsLoading) podsLoading.hidden = true;
    if (podsSection) podsSection.hidden = true;
    updateApiKeyRequirementsBanner();
    updateLeftColumnOrder();
    updateTemplateUI();
    fetchBalance();
  }
  updateSelectedGpuCount();
}

document.addEventListener("DOMContentLoaded", init);
