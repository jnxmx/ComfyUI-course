/**
 * /desktop-plugin/ — Scale-exact 800x600 Comfy Desktop stages & reduced-motion controls.
 */

const LOGICAL_WIDTH = 800;

function updateStageScales() {
  const stages = document.querySelectorAll(".cd-stage");
  for (const stage of stages) {
    const win = stage.querySelector(".cd-window");
    if (!win) continue;
    const width = stage.clientWidth;
    if (width > 0) {
      win.style.setProperty("--cd-scale", String(width / LOGICAL_WIDTH));
    }
  }
}

function initStageScaling() {
  updateStageScales();
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(updateStageScales);
    document.querySelectorAll(".cd-stage").forEach((stage) => observer.observe(stage));
  } else {
    window.addEventListener("resize", updateStageScales);
  }
}

function initMotionControls() {
  const toggleBtn = document.getElementById("dp-motion-toggle");
  if (!toggleBtn) return;

  const root = document.documentElement;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reducedMotion) {
    root.classList.add("dp-animations-paused");
    toggleBtn.textContent = "Запустить анимации";
  }

  toggleBtn.addEventListener("click", () => {
    const paused = root.classList.toggle("dp-animations-paused");
    if (!paused && reducedMotion) {
      root.classList.add("dp-motion-opt-in");
    }
    toggleBtn.textContent = paused ? "Запустить анимации" : "Пауза анимаций";
  });
}

initStageScaling();
initMotionControls();
