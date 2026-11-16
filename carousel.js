document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('course-carousel-wrap');
  const canvas = document.getElementById('video-carousel');
  if (!wrap || !canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const VIDEO_COUNT = 10;
  const SPEED_PX_PER_SEC = 50;

  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let tiles = [];
  let isLoading = true;
  let isInView = true;
  let rafId = null;
  let lastFrameTime = performance.now();

  // Drag / inertia state so users can also scrub the reel horizontally if they grab it
  let isDragging = false;
  let lastPointerX = 0;
  let dragVelocity = 0;

  const entries = [];
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const video = document.createElement('video');
    video.src = `assets/video/Timeline ${i}.mp4`;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    entries.push({
      index: i - 1,
      video,
      aspect: 1,
      ready: false,
      failed: false,
    });
  }

  function getEntryAspect(entry) {
    if (entry.video.videoWidth > 0 && entry.video.videoHeight > 0) {
      entry.aspect = entry.video.videoWidth / entry.video.videoHeight;
    }
    return entry.aspect || 1;
  }

  function buildTrack() {
    if (cssWidth <= 0 || cssHeight <= 0) return;

    // Preserve current scroll offset cleanly on resize if already built
    const prevLeadOffset = tiles.length > 0 ? tiles[0].x : 0;
    const prevStartIndex = tiles.length > 0 ? tiles[0].index : 0;

    tiles = [];
    let cursorX = prevLeadOffset;
    let idx = prevStartIndex;
    let guard = 0;

    // Normalize negative offset if height shrunk sharply on resize
    const firstWidth = cssHeight * getEntryAspect(entries[idx % VIDEO_COUNT]);
    while (cursorX + firstWidth <= 0 && guard < 100) {
      cursorX += firstWidth;
      idx = (idx + 1) % VIDEO_COUNT;
      guard++;
    }

    let coveredWidth = cursorX;
    while (coveredWidth < cssWidth + cssHeight * 2 && guard < 100) {
      const entry = entries[idx % VIDEO_COUNT];
      const w = cssHeight * getEntryAspect(entry);
      tiles.push({
        index: entry.index,
        entry,
        width: w,
        x: coveredWidth,
      });
      coveredWidth += w;
      idx = (idx + 1) % VIDEO_COUNT;
      guard++;
    }
  }

  function shiftTrackBy(dx) {
    if (tiles.length === 0 || cssHeight <= 0) return;

    for (const tile of tiles) {
      tile.x += dx;
    }

    // Recycle tiles moving off the left edge to the right end
    while (tiles.length > 0 && tiles[0].x + tiles[0].width <= 0) {
      tiles.shift();
      const last = tiles[tiles.length - 1];
      const nextIdx = (last.index + 1) % VIDEO_COUNT;
      const entry = entries[nextIdx];
      const w = cssHeight * getEntryAspect(entry);
      tiles.push({
        index: nextIdx,
        entry,
        width: w,
        x: last.x + last.width,
      });
    }

    // Recycle tiles moving off the right edge if user drags forward/right
    while (tiles.length > 0 && tiles[0].x > 0) {
      const first = tiles[0];
      const prevIdx = (first.index - 1 + VIDEO_COUNT) % VIDEO_COUNT;
      const entry = entries[prevIdx];
      const w = cssHeight * getEntryAspect(entry);
      tiles.unshift({
        index: prevIdx,
        entry,
        width: w,
        x: first.x - w,
      });
      const last = tiles[tiles.length - 1];
      if (last && last.x > cssWidth + w) {
        tiles.pop();
      }
    }
  }

  function syncVideoPlayback() {
    const activeIndices = new Set();
    if (isInView && !isLoading) {
      for (const tile of tiles) {
        // Keep visible tiles + 1-tile lookahead warm and playing
        if (tile.x + tile.width > -cssHeight && tile.x < cssWidth + cssHeight) {
          activeIndices.add(tile.index);
        }
      }
    }

    for (const entry of entries) {
      if (activeIndices.has(entry.index)) {
        if (entry.video.paused && entry.video.readyState >= 2) {
          entry.video.play().catch(() => {});
        }
      } else if (!entry.video.paused) {
        entry.video.pause();
      }
    }
  }

  function drawLoadingMessage() {
    if (cssWidth <= 0 || cssHeight <= 0) return;
    ctx.fillStyle = '#dcded6';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.fillStyle = '#747678';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillText('видео загружаются', cssWidth / 2, cssHeight / 2);
  }

  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);

    const targetW = Math.max(1, Math.round(cssWidth * dpr));
    const targetH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    buildTrack();
    if (isLoading) {
      drawLoadingMessage();
    }
  }

  function animate(now) {
    rafId = null;
    if (isLoading || !isInView) return;

    const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    if (!isDragging) {
      const step = -SPEED_PX_PER_SEC * dt + dragVelocity * dt;
      shiftTrackBy(step);
      dragVelocity *= Math.pow(0.04, dt);
      if (Math.abs(dragVelocity) < 0.5) dragVelocity = 0;
    }

    syncVideoPlayback();

    ctx.fillStyle = '#dcded6';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (const tile of tiles) {
      if (tile.x < cssWidth && tile.x + tile.width > 0) {
        const v = tile.entry.video;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          ctx.drawImage(v, tile.x, 0, tile.width + 0.75, cssHeight);
        }
      }
    }

    rafId = requestAnimationFrame(animate);
  }

  function startLoop() {
    if (!isLoading && isInView && rafId === null) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(animate);
    }
  }

  function initializeCarousel() {
    if (!isLoading) return;
    isLoading = false;
    wrap.classList.add('is-ready');
    buildTrack();
    syncVideoPlayback();
    startLoop();
  }

  // Horizontal pointer scrub support
  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastPointerX = e.clientX;
    dragVelocity = 0;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    shiftTrackBy(dx);
    dragVelocity = dx * 28;
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Preload videos cleanly without hanging on readyState quirks
  Promise.all(
    entries.map(
      (entry) =>
        new Promise((resolve) => {
          const v = entry.video;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            entry.ready = true;
            resolve();
            return;
          }
          let settled = false;
          const done = (failed = false) => {
            if (settled) return;
            settled = true;
            entry.ready = !failed;
            entry.failed = failed;
            resolve();
          };
          v.addEventListener('loadeddata', () => done(false), { once: true });
          v.addEventListener('canplay', () => done(false), { once: true });
          v.addEventListener('error', () => done(true), { once: true });
          setTimeout(() => done(v.readyState < 2), 6000);
          v.load();
        })
    )
  ).then(initializeCarousel);

  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(wrap);
  }
  window.addEventListener('resize', resizeCanvas);

  if (window.IntersectionObserver) {
    new IntersectionObserver(
      (obsEntries) => {
        isInView = obsEntries.some((item) => item.isIntersecting);
        syncVideoPlayback();
        if (isInView) {
          startLoop();
        } else if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      },
      { threshold: 0.01 }
    ).observe(wrap);
  }

  resizeCanvas();
  drawLoadingMessage();
});
