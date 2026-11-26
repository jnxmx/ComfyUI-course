export const GPU_PRIORITY_TIERS = Object.freeze([
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
    key: "l40s",
    label: "L40S",
    gpuIds: ["NVIDIA L40S"]
  },
  {
    rank: 5,
    key: "pro-5000",
    label: "Pro 5000 Blackwell",
    gpuIds: ["NVIDIA RTX PRO 5000 Blackwell"]
  },
  {
    rank: 6,
    key: "6000-ada",
    label: "6000 Ada",
    gpuIds: ["NVIDIA RTX 6000 Ada Generation"]
  },
  {
    rank: 7,
    key: "5000-ada",
    label: "5000 Ada",
    gpuIds: ["NVIDIA RTX 5000 Ada Generation"]
  },
  {
    rank: 8,
    key: "rtx-5080",
    label: "RTX 5080",
    gpuIds: ["NVIDIA GeForce RTX 5080"]
  },
  {
    rank: 9,
    key: "pro-4500",
    label: "Pro 4500",
    gpuIds: ["NVIDIA RTX PRO 4500 Blackwell"]
  },
  {
    rank: 10,
    key: "l40",
    label: "L40",
    gpuIds: ["NVIDIA L40"]
  },
  {
    rank: 11,
    key: "4080-super",
    label: "4080 Super",
    gpuIds: [
      "NVIDIA GeForce RTX 4080 SUPER",
      "NVIDIA GeForce RTX 4080"
    ]
  },
  {
    rank: 12,
    key: "pro-4500-se",
    label: "Pro 4500 SE",
    gpuIds: ["NVIDIA RTX PRO 4500 Blackwell Server Edition"]
  },
  {
    rank: 13,
    key: "rtx-a6000",
    label: "RTX A6000",
    gpuIds: ["NVIDIA RTX A6000"]
  },
  {
    rank: 14,
    key: "rtx-4070-ti",
    label: "RTX 4070 Ti",
    gpuIds: ["NVIDIA GeForce RTX 4070 Ti"]
  },
  {
    rank: 15,
    key: "a40",
    label: "A40",
    gpuIds: ["NVIDIA A40"]
  },
  {
    rank: 16,
    key: "pro-4000",
    label: "Pro 4000",
    gpuIds: ["NVIDIA RTX PRO 4000 Blackwell"]
  },
  {
    rank: 17,
    key: "rtx-3090-ti",
    label: "RTX 3090 / Ti",
    gpuIds: [
      "NVIDIA GeForce RTX 3090 Ti",
      "NVIDIA GeForce RTX 3090"
    ]
  },
  {
    rank: 18,
    key: "rtx-3080-ti",
    label: "RTX 3080 Ti / 3080",
    gpuIds: [
      "NVIDIA GeForce RTX 3080 Ti",
      "NVIDIA GeForce RTX 3080"
    ]
  },
  {
    rank: 19,
    key: "4000-ada",
    label: "4000 Ada",
    gpuIds: [
      "NVIDIA RTX 4000 Ada Generation",
      "NVIDIA RTX 4000 SFF Ada Generation"
    ]
  },
  {
    rank: 20,
    key: "rtx-a5000",
    label: "RTX A5000",
    gpuIds: ["NVIDIA RTX A5000"]
  },
  {
    rank: 21,
    key: "rtx-a4500",
    label: "RTX A4500",
    gpuIds: ["NVIDIA RTX A4500"]
  },
  {
    rank: 22,
    key: "l4",
    label: "L4",
    gpuIds: ["NVIDIA L4"]
  },
  {
    rank: 23,
    key: "rtx-3070",
    label: "RTX 3070",
    gpuIds: ["NVIDIA GeForce RTX 3070"]
  },
  {
    rank: 24,
    key: "rtx-a4000",
    label: "RTX A4000",
    gpuIds: ["NVIDIA RTX A4000"]
  },
  {
    rank: 25,
    key: "rtx-2000-ada",
    label: "RTX 2000 Ada",
    gpuIds: ["NVIDIA RTX 2000 Ada Generation"]
  }
]);

export function getGpuArchitecture(gpuId, displayName = "") {
  const s = `${gpuId || ""} ${displayName || ""}`.toLowerCase();

  if (
    s.includes("ada") ||
    /\brtx\s*40[0-9]{2}\b/.test(s) ||
    /\bl40s?\b/.test(s) ||
    /\bl4\b/.test(s)
  ) {
    return {
      label: "Ada",
      tierClass: "arch-ada",
      title: "Ada Lovelace (FP8 / BF16, без FP4)"
    };
  }

  if (
    s.includes("blackwell") ||
    /\brtx\s*50[0-9]{2}\b/.test(s) ||
    /\b(gb200|b100|b200|b300)\b/.test(s)
  ) {
    return {
      label: "Blackwell",
      tierClass: "arch-blackwell",
      title: "Blackwell (FP4 / FP8 / BF16 — максимальная поддержка)"
    };
  }

  if (/\b(h100|h200|gh200)\b/.test(s)) {
    return {
      label: "Hopper",
      tierClass: "arch-ada",
      title: "Hopper (FP8 / BF16, без FP4)"
    };
  }

  if (
    /\brtx\s*30[0-9]{2}\b/.test(s) ||
    /\brtx\s*a[0-9]{4}\b/.test(s) ||
    /\ba(100|40|30|16|10|2)\b/.test(s)
  ) {
    return {
      label: "Ampere",
      tierClass: "arch-ampere",
      title: "Ampere (BF16 / TF32, без FP8 — устаревающее поколение)"
    };
  }

  if (
    /\brtx\s*20[0-9]{2}\b/.test(s) ||
    /\bt4\b/.test(s) ||
    /\brtx\s*(4000|5000|6000|8000)\b/.test(s) ||
    s.includes("quadro rtx")
  ) {
    return {
      label: "Turing",
      tierClass: "arch-turing",
      title: "Turing (нет BF16 / FP8 — слабо поддерживается)"
    };
  }

  if (/\bv100\b/.test(s)) {
    return {
      label: "Volta",
      tierClass: "arch-turing",
      title: "Volta (нет BF16 / FP8 — устаревшая архитектура)"
    };
  }

  if (/\b(p100|p40|p4|gtx\s*10[0-9]{2})\b/.test(s)) {
    return {
      label: "Pascal",
      tierClass: "arch-turing",
      title: "Pascal (нет Tensor Cores / BF16 / FP8)"
    };
  }

  if (/\bmi300/.test(s)) {
    return { label: "CDNA 3", tierClass: "arch-ada", title: "AMD CDNA 3" };
  }
  if (/\bmi250|\bmi210/.test(s)) {
    return { label: "CDNA 2", tierClass: "arch-ampere", title: "AMD CDNA 2" };
  }

  return null;
}

export const GPU_POWER_RATINGS = Object.freeze({
  "NVIDIA RTX PRO 6000 Blackwell Server Edition": { pic: 100, vid: 100, picSit: 1.06, vidSit: 8.42, picSec: 27.49, vidSec: 56.97, plus: true },
  "NVIDIA RTX PRO 6000 Blackwell Workstation Edition": { pic: 100, vid: 100, picSit: 1.06, vidSit: 8.42, picSec: 27.49, vidSec: 56.97, plus: true },
  "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition": { pic: 100, vid: 100, picSit: 1.06, vidSit: 8.42, picSec: 27.49, vidSec: 56.97, plus: true },
  "NVIDIA GeForce RTX 5090": { pic: 100, vid: 68.5, picSit: 1.1, vidSit: 11.98, picSec: 28.89, vidSec: 78.43 },
  "NVIDIA GeForce RTX 4090": { pic: 75.3, vid: 50, picSit: 1.56, vidSit: 16.72, picSec: 40.52, vidSec: 113.78 },
  "NVIDIA L40S": { pic: 66.5, vid: 55.1, picSit: 1.75, vidSit: 15.09, picSec: 45.72, vidSec: 103.4 },
  "NVIDIA RTX PRO 5000 Blackwell": { pic: 63.5, vid: 56.3, picSit: 1.86, vidSit: 14.6, picSec: 48.02, vidSec: 103.67 },
  "NVIDIA RTX 6000 Ada Generation": { pic: 53.1, vid: 43.6, picSit: 2.21, vidSit: 19.28, picSec: 57.5, vidSec: 129.69 },
  "NVIDIA RTX 5000 Ada Generation": { pic: 50.1, vid: 45.2, picSit: 2.35, vidSit: 18.47, picSec: 60.68, vidSec: 127.05 },
  "NVIDIA GeForce RTX 5080": { pic: 56.7, vid: 34.5, picSit: 2.08, vidSit: 24.75, picSec: 53.79, vidSec: 161.33 },
  "NVIDIA RTX PRO 4500 Blackwell": { pic: 46.3, vid: 40.6, picSit: 2.49, vidSit: 19.75, picSec: 63.94, vidSec: 133.09 },
  "NVIDIA L40": { pic: 47.8, vid: 38.9, picSit: 2.44, vidSit: 21.3, picSec: 63.26, vidSec: 144.92 },
  "NVIDIA GeForce RTX 4080 SUPER": { pic: 50.6, vid: 32.2, picSit: 2.35, vidSit: 26.65, picSec: 60.14, vidSec: 173.22 },
  "NVIDIA RTX PRO 4500 Blackwell Server Edition": { pic: 40.3, vid: 36.2, picSit: 2.93, vidSit: 23.28, picSec: 74.45, vidSec: 152.9 },
  "NVIDIA RTX A6000": { pic: 32.2, vid: 30.9, picSit: 3.69, vidSit: 27.26, picSec: 94.77, vidSec: 184.19 },
  "NVIDIA GeForce RTX 4070 Ti": { pic: 39.3, vid: 24.5, picSit: 3.01, vidSit: 34.77, picSec: 77.15, vidSec: 228.45 },
  "NVIDIA A40": { pic: 30.6, vid: 29.6, picSit: 3.85, vidSit: 28.16, picSec: 98.62, vidSec: 193.41 },
  "NVIDIA RTX PRO 4000 Blackwell": { pic: 31.4, vid: 27.9, picSit: 3.7, vidSit: 29.17, picSec: 94.06, vidSec: 202.04 },
  "NVIDIA GeForce RTX 3090": { pic: 33, vid: 22.4, picSit: 3.57, vidSit: 38.16, picSec: 91.6, vidSec: 247.49 },
  "NVIDIA GeForce RTX 3080 Ti": { pic: 32.4, vid: 21.7, picSit: 3.68, vidSit: 39.83, picSec: 93.89, vidSec: 254.93 },
  "NVIDIA GeForce RTX 3080": { pic: 31.3, vid: 17.6, picSit: 3.77, vidSit: 48.65, picSec: 96.65, vidSec: 316.64 },
  "NVIDIA RTX A5000": { pic: 23.5, vid: 21.5, picSit: 5.02, vidSit: 38.08, picSec: 128.78, vidSec: 268.29 },
  "NVIDIA RTX 4000 Ada Generation": { pic: 24, vid: 20.3, picSit: 4.92, vidSit: 41.44, picSec: 125.9, vidSec: 275.11 },
  "NVIDIA RTX A4500": { pic: 20.1, vid: 18.6, picSit: 5.87, vidSit: 44.98, picSec: 150.44, vidSec: 299.35 },
  "NVIDIA L4": { pic: 18.7, vid: 16.5, picSit: 6.36, vidSit: 51.48, picSec: 161.29, vidSec: 337.54 },
  "NVIDIA GeForce RTX 3070": { pic: 21.5, vid: 12.5, picSit: 5.53, vidSit: 69.21, picSec: 141.49, vidSec: 437.33 },
  "NVIDIA RTX A4000": { pic: 16.6, vid: 15.4, picSit: 7.06, vidSit: 54.3, picSec: 179.17, vidSec: 360.22 },
  "NVIDIA RTX 2000 Ada Generation": { pic: 11.9, vid: 9.6, picSit: 10.05, vidSit: 88.86, picSec: 254.27, vidSec: 582.85 }
});

export const GPU_SCORE_TABLE_ROWS = Object.freeze([
  { rank: 1, name: "RTX PRO 6000", vramGb: 96, gpuId: "NVIDIA RTX PRO 6000 Blackwell Server Edition", matchIds: ["NVIDIA RTX PRO 6000 Blackwell Server Edition", "NVIDIA RTX PRO 6000 Blackwell Workstation Edition", "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition"] },
  { rank: 2, name: "RTX 5090", vramGb: 32, gpuId: "NVIDIA GeForce RTX 5090" },
  { rank: 3, name: "RTX 4090", vramGb: 24, gpuId: "NVIDIA GeForce RTX 4090" },
  { rank: 4, name: "L40S", vramGb: 48, gpuId: "NVIDIA L40S" },
  { rank: 5, name: "RTX PRO 5000", vramGb: 48, gpuId: "NVIDIA RTX PRO 5000 Blackwell" },
  { rank: 6, name: "RTX 6000 Ada", vramGb: 48, gpuId: "NVIDIA RTX 6000 Ada Generation" },
  { rank: 7, name: "RTX 5000 Ada", vramGb: 32, gpuId: "NVIDIA RTX 5000 Ada Generation" },
  { rank: 8, name: "RTX 5080", vramGb: 16, gpuId: "NVIDIA GeForce RTX 5080" },
  { rank: 9, name: "RTX PRO 4500", vramGb: 32, gpuId: "NVIDIA RTX PRO 4500 Blackwell" },
  { rank: 10, name: "L40", vramGb: 48, gpuId: "NVIDIA L40" },
  { rank: 11, name: "RTX 4080 SUPER", vramGb: 16, gpuId: "NVIDIA GeForce RTX 4080 SUPER" },
  { rank: 12, name: "RTX PRO 4500 SE", vramGb: 32, gpuId: "NVIDIA RTX PRO 4500 Blackwell Server Edition" },
  { rank: 13, name: "RTX A6000", vramGb: 48, gpuId: "NVIDIA RTX A6000" },
  { rank: 14, name: "RTX 4070 Ti", vramGb: 12, gpuId: "NVIDIA GeForce RTX 4070 Ti" },
  { rank: 15, name: "A40", vramGb: 48, gpuId: "NVIDIA A40" },
  { rank: 16, name: "RTX PRO 4000", vramGb: 24, gpuId: "NVIDIA RTX PRO 4000 Blackwell" },
  { rank: 17, name: "RTX 3090", vramGb: 24, gpuId: "NVIDIA GeForce RTX 3090" },
  { rank: 18, name: "RTX 3080 Ti", vramGb: 12, gpuId: "NVIDIA GeForce RTX 3080 Ti" },
  { rank: 19, name: "RTX 3080", vramGb: 10, gpuId: "NVIDIA GeForce RTX 3080" },
  { rank: 20, name: "RTX A5000", vramGb: 24, gpuId: "NVIDIA RTX A5000" },
  { rank: 21, name: "RTX 4000 Ada", vramGb: 20, gpuId: "NVIDIA RTX 4000 Ada Generation" },
  { rank: 22, name: "RTX A4500", vramGb: 20, gpuId: "NVIDIA RTX A4500" },
  { rank: 23, name: "L4", vramGb: 24, gpuId: "NVIDIA L4" },
  { rank: 24, name: "RTX 3070", vramGb: 8, gpuId: "NVIDIA GeForce RTX 3070" },
  { rank: 25, name: "RTX A4000", vramGb: 16, gpuId: "NVIDIA RTX A4000" },
  { rank: 26, name: "RTX 2000 Ada", vramGb: 16, gpuId: "NVIDIA RTX 2000 Ada Generation" }
]);

export const GPU_BENCHMARK_ORDER = Object.freeze([
  "NVIDIA GeForce RTX 5090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX PRO 5000 Blackwell",
  "NVIDIA L40S",
  "NVIDIA RTX 5000 Ada Generation",
  "NVIDIA RTX 6000 Ada Generation",
  "NVIDIA GeForce RTX 5080",
  "NVIDIA L40",
  "NVIDIA RTX PRO 4500 Blackwell",
  "NVIDIA RTX PRO 4500 Blackwell Server Edition",
  "NVIDIA RTX A6000",
  "NVIDIA GeForce RTX 4070 Ti",
  "NVIDIA A40",
  "NVIDIA RTX PRO 4000 Blackwell",
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 3080 Ti",
  "NVIDIA RTX 4000 Ada Generation",
  "NVIDIA GeForce RTX 3070",
  "NVIDIA RTX 2000 Ada Generation"
]);

export function buildSegmentedPowerBars(rating) {
  const wrap = document.createElement("div");
  wrap.className = "power-bars-wrap";
  wrap.title = `Картинки: ${rating.pic}% · Видео: ${rating.vid}%`;

  const bars = document.createElement("div");
  bars.className = "power-bars power-v4";

  const picPct = Math.max(1, Math.min(100, rating.pic));
  const vidPct = Math.max(1, Math.min(100, rating.vid));
  const hasPlus = Boolean(rating.plus || rating.pic > 100);

  const buildSegmentedTrack = (trackClass, pct, withPlus = false) => {
    const track = document.createElement("div");
    track.className = `power-track ${trackClass}`;
    for (let i = 0; i < 10; i += 1) {
      const seg = document.createElement("div");
      seg.className = "power-seg";
      if (i === 0) seg.classList.add("is-first");
      if (i === 9) seg.classList.add("is-last");
      if (withPlus && i === 9) {
        seg.classList.add("power-seg-plus");
        const fill = document.createElement("span");
        fill.className = "power-seg-fill";
        const plus = document.createElement("span");
        plus.className = "power-plus";
        plus.textContent = "+";
        plus.setAttribute("aria-hidden", "true");
        seg.append(fill, plus);
      } else {
        const segPct = Math.max(0, Math.min(100, (pct - i * 10) * 10));
        if (segPct > 0) {
          const fill = document.createElement("span");
          fill.className = "power-seg-fill";
          fill.style.width = `${segPct}%`;
          seg.appendChild(fill);
        }
      }
      track.appendChild(seg);
    }
    return track;
  };

  bars.append(
    buildSegmentedTrack("power-track-pic", picPct, hasPlus),
    buildSegmentedTrack("power-track-vid", vidPct)
  );

  wrap.appendChild(bars);
  return wrap;
}

export function isAnomalousGpuPrice(gpuId, price) {
  const numPrice = Number(price);
  if (!Number.isFinite(numPrice) || numPrice <= 0) return true;
  const s = String(gpuId || "").toLowerCase();
  if ((s.includes("pro 6000") || s.includes("6000 ada")) && numPrice <= 0.6) {
    return true;
  }
  return false;
}

const RECOMMENDED_GPU_CLOUDS = Object.freeze({
  "NVIDIA GeForce RTX 4070 Ti": ["COMMUNITY", "SECURE"],
  "NVIDIA GeForce RTX 3090": ["COMMUNITY"],
  "NVIDIA GeForce RTX 3090 Ti": ["COMMUNITY"],
  "NVIDIA GeForce RTX 3080 Ti": ["COMMUNITY"],
  "NVIDIA GeForce RTX 4080 SUPER": ["COMMUNITY", "SECURE"],
  "NVIDIA RTX PRO 4500 Blackwell": ["COMMUNITY"],
  "NVIDIA GeForce RTX 5080": ["COMMUNITY", "SECURE"],
  "NVIDIA RTX 5000 Ada Generation": ["COMMUNITY"],
  "NVIDIA GeForce RTX 5090": ["COMMUNITY", "SECURE"],
  "NVIDIA RTX PRO 5000 Blackwell": ["COMMUNITY"],
  "NVIDIA GeForce RTX 4090": ["SECURE"],
  "NVIDIA RTX PRO 6000 Blackwell Server Edition": ["COMMUNITY"],
  "NVIDIA RTX PRO 6000 Blackwell Workstation Edition": ["COMMUNITY"],
  "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition": ["COMMUNITY"]
});

export function isRecommendedGpu(gpuId, cloud) {
  const clouds = RECOMMENDED_GPU_CLOUDS[gpuId];
  return Array.isArray(clouds) && clouds.includes(cloud);
}

export const GPU_FALLBACK_PRICES = Object.freeze({
  "NVIDIA RTX PRO 6000 Blackwell Server Edition": { secure: 2.69, community: 1.64 },
  "NVIDIA GeForce RTX 5090": { secure: 1.39, community: 0.69 },
  "NVIDIA GeForce RTX 4090": { secure: 0.89, community: 0.34 },
  "NVIDIA L40S": { secure: 1.09, community: 0.79 },
  "NVIDIA RTX PRO 5000 Blackwell": { secure: 0.96, community: 0.82 },
  "NVIDIA RTX 6000 Ada Generation": { secure: 1.09, community: 0.74 },
  "NVIDIA RTX 5000 Ada Generation": { secure: 0.83, community: 0.49 },
  "NVIDIA GeForce RTX 5080": { secure: 0.59, community: 0.39 },
  "NVIDIA RTX PRO 4500 Blackwell": { secure: 0.72, community: 0.34 },
  "NVIDIA L40": { secure: 0.82, community: 0.69 },
  "NVIDIA GeForce RTX 4080 SUPER": { secure: 0.5, community: 0.28 },
  "NVIDIA RTX PRO 4500 Blackwell Server Edition": { secure: 0.72, community: 0.5 },
  "NVIDIA RTX A6000": { secure: 0.69, community: 0.33 },
  "NVIDIA GeForce RTX 4070 Ti": { secure: 0.5, community: 0.19 },
  "NVIDIA A40": { secure: 0.59, community: 0.35 },
  "NVIDIA RTX PRO 4000 Blackwell": { secure: 0.57, community: 0.5 },
  "NVIDIA GeForce RTX 3090": { secure: 0.5, community: 0.22 },
  "NVIDIA GeForce RTX 3080 Ti": { secure: null, community: 0.18 },
  "NVIDIA GeForce RTX 3080": { secure: null, community: 0.17 },
  "NVIDIA RTX A5000": { secure: 0.27, community: 0.16 },
  "NVIDIA RTX 4000 Ada Generation": { secure: 0.28, community: 0.2 },
  "NVIDIA RTX A4500": { secure: 0.25, community: 0.19 },
  "NVIDIA L4": { secure: 0.69, community: 0.44 },
  "NVIDIA GeForce RTX 3070": { secure: null, community: 0.13 },
  "NVIDIA RTX A4000": { secure: 0.25, community: 0.17 },
  "NVIDIA RTX 2000 Ada Generation": { secure: 0.24, community: 0.5 }
});
