import {
  GPU_POWER_RATINGS,
  GPU_SCORE_TABLE_ROWS,
  getGpuArchitecture,
  buildSegmentedPowerBars,
  isAnomalousGpuPrice,
  GPU_FALLBACK_PRICES
} from "../deploy/gpu_data.js?v=20261123_24";

const STORAGE_KEYS = Object.freeze({
  API_KEY: "yakushev_runpod_api_key_v1",
  COLOR_SCHEME: "color-scheme"
});

const RUNPOD_API_BASE = "https://api.runpod.io/v2";

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const meta = document.querySelector('meta[name="color-scheme"]');

  const getCurrentTheme = () => {
    const saved = localStorage.getItem(STORAGE_KEYS.COLOR_SCHEME);
    return saved === "light" ? "light" : "dark";
  };

  const applySavedTheme = () => {
    const theme = getCurrentTheme();
    document.documentElement.classList.remove("theme-light", "theme-dark");
    if (meta) meta.content = theme;
    if (theme === "light") {
      document.documentElement.classList.add("theme-light");
    }
  };

  const updateLabel = () => {
    const theme = getCurrentTheme();
    btn.textContent = `Тема: ${theme === "light" ? "Светлая" : "Тёмная"}`;
  };

  btn.addEventListener("click", () => {
    const next = getCurrentTheme() === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEYS.COLOR_SCHEME, next);
    applySavedTheme();
    updateLabel();
  });

  applySavedTheme();
  updateLabel();
}

function renderScoreTable(priceMap = new Map()) {
  const tbody = document.getElementById("gpu-score-tbody");
  if (!tbody) return;
  tbody.replaceChildren();

  for (const item of GPU_SCORE_TABLE_ROWS) {
    const rating = GPU_POWER_RATINGS[item.gpuId];
    if (!rating) continue;

    const tr = document.createElement("tr");

    // 1. Название видеокарты + VRAM + архитектура
    const tdName = document.createElement("td");
    tdName.className = "col-name";
    const cell = document.createElement("div");
    cell.className = "score-gpu-cell";

    const rankEl = document.createElement("span");
    rankEl.className = "score-rank";
    rankEl.textContent = `${item.rank}.`;

    const nameEl = document.createElement("span");
    nameEl.className = "gpu-title";
    nameEl.textContent = item.name;

    const vramEl = document.createElement("span");
    vramEl.className = "vram-inline";
    vramEl.textContent = `${item.vramGb} GB`;

    cell.append(rankEl, nameEl, vramEl);

    const arch = getGpuArchitecture(item.gpuId, item.name);
    if (arch) {
      const archBadge = document.createElement("span");
      archBadge.className = `arch-pill ${arch.tierClass}`;
      archBadge.textContent = arch.label;
      archBadge.title = arch.title;
      cell.appendChild(archBadge);
    }

    tdName.appendChild(cell);

    // 2. Полоски скорости (из общего модуля с deploy)
    const tdPower = document.createElement("td");
    tdPower.className = "col-power";
    tdPower.appendChild(buildSegmentedPowerBars(rating));

    // 3. Время генерации изображения (оранжевый)
    const tdPicTime = document.createElement("td");
    tdPicTime.className = "col-pic";
    tdPicTime.textContent = `${rating.picSec.toFixed(2)} с`;

    // 4. Скорость шага изображения (оранжевый)
    const tdPicSit = document.createElement("td");
    tdPicSit.className = "col-pic";
    tdPicSit.textContent = `${rating.picSit} s/it`;

    // 5. Время генерации видео (фиолетовый)
    const tdVidTime = document.createElement("td");
    tdVidTime.className = "col-vid";
    tdVidTime.textContent = `${rating.vidSec.toFixed(2)} с`;

    // 6. Скорость шага видео (фиолетовый)
    const tdVidSit = document.createElement("td");
    tdVidSit.className = "col-vid";
    tdVidSit.textContent = `${rating.vidSit} s/it`;

    // 7-8. Цены на Secure и Community
    const idsToCheck = item.matchIds || [item.gpuId];
    let securePrice = null;
    let communityPrice = null;
    for (const id of idsToCheck) {
      const entry = priceMap.get(id);
      if (!entry) continue;
      if (entry.secure > 0 && (securePrice === null || entry.secure < securePrice)) {
        securePrice = entry.secure;
      }
      if (entry.community > 0 && (communityPrice === null || entry.community < communityPrice)) {
        communityPrice = entry.community;
      }
    }

    const tdSecure = document.createElement("td");
    tdSecure.className = "col-price-col";
    tdSecure.textContent = securePrice !== null ? `${securePrice.toFixed(2)} $/ч` : "—";

    const tdCommunity = document.createElement("td");
    tdCommunity.className = "col-price-col";
    tdCommunity.textContent = communityPrice !== null ? `${communityPrice.toFixed(2)} $/ч` : "—";

    tr.append(tdName, tdPower, tdPicTime, tdPicSit, tdVidTime, tdVidSit, tdSecure, tdCommunity);
    tbody.appendChild(tr);
  }
}

function getFallbackPriceMap() {
  const map = new Map();
  for (const [gpuId, entry] of Object.entries(GPU_FALLBACK_PRICES)) {
    map.set(gpuId, { ...entry });
  }
  return map;
}

async function fetchLivePrices() {
  const statusEl = document.getElementById("score-prices-status");
  const apiKey = (localStorage.getItem(STORAGE_KEYS.API_KEY) || "").trim();
  if (!apiKey) {
    if (statusEl) {
      statusEl.textContent = "Цены RunPod на 23.11.2026 (введите API-ключ на deploy для живого обновления)";
    }
    return;
  }

  if (statusEl) statusEl.textContent = "Обновление цен с RunPod...";
  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [commRes, secRes] = await Promise.all([
      fetch(`${RUNPOD_API_BASE}/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=COMMUNITY`, { headers }),
      fetch(`${RUNPOD_API_BASE}/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE`, { headers })
    ]);
    if (!commRes.ok || !secRes.ok) {
      throw new Error(`HTTP ${commRes.status}/${secRes.status}`);
    }
    const [commData, secData] = await Promise.all([commRes.json(), secRes.json()]);
    const priceMap = getFallbackPriceMap();

    for (const gpu of commData?.gpus || []) {
      const p = Number(gpu.price?.community);
      if (p > 0 && !isAnomalousGpuPrice(gpu.id, p)) {
        const prev = priceMap.get(gpu.id) || {};
        priceMap.set(gpu.id, { ...prev, community: p });
      }
    }
    for (const gpu of secData?.gpus || []) {
      const p = Number(gpu.price?.secure);
      if (p > 0 && !isAnomalousGpuPrice(gpu.id, p)) {
        const prev = priceMap.get(gpu.id) || {};
        priceMap.set(gpu.id, { ...prev, secure: p });
      }
    }

    renderScoreTable(priceMap);
    if (statusEl) statusEl.textContent = "Цены обновлены с RunPod";
  } catch (err) {
    if (statusEl) statusEl.textContent = `Цены RunPod на 23.11.2026 (не удалось обновить: ${err.message})`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  renderScoreTable(getFallbackPriceMap());
  fetchLivePrices();
});
