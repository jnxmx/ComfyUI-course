document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('course-carousel-wrap');
  const canvas = document.getElementById('video-carousel');
  if (!wrap || !canvas) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const VIDEO_COUNT = 10;
  const SPEED_PX_PER_SEC = 50;

  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let tiles = [];
  let isLoading = true;
  let isNearView = true;
  let rafId = null;
  let lastFrameTime = performance.now();

  let isDragging = false;
  let lastPointerX = 0;
  let dragVelocity = 0;

  // Keep video elements inside a tiny non-zero-opacity host in the viewport so Chromium/WebKit
  // never throttles their hardware decode pipeline.
  const videoHost = document.createElement('div');
  videoHost.setAttribute('aria-hidden', 'true');
  videoHost.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;overflow:hidden;z-index:-1;';
  document.body.appendChild(videoHost);

  const entries = [];
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const video = document.createElement('video');
    video.src = `assets/video/Timeline ${i}.mp4`;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.cssText = 'width:2px;height:2px;display:block;';
    videoHost.appendChild(video);
    entries.push({
      index: i - 1,
      video,
      aspect: 1,
      ready: false,
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

    const prevLeadOffset = tiles.length > 0 ? tiles[0].x : 0;
    const prevStartIndex = tiles.length > 0 ? tiles[0].index : 0;

    tiles = [];
    let cursorX = prevLeadOffset;
    let idx = prevStartIndex;
    let guard = 0;

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

    for (let i = 0; i < tiles.length; i++) {
      tiles[i].x += dx;
    }

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

  function setAllVideosPlaying(shouldPlay) {
    for (let i = 0; i < entries.length; i++) {
      const v = entries[i].video;
      if (shouldPlay) {
        if (v.paused && v.readyState >= 2) {
          v.play().catch(() => {});
        }
      } else if (!v.paused) {
        v.pause();
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
    // Source videos are 720px square; cap DPR at 1.5 so GPU never oversamples past native source resolution
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);

    const targetW = Math.max(1, Math.round(cssWidth * dpr));
    const targetH = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildTrack();
    if (isLoading) {
      drawLoadingMessage();
    }
  }

  function animate(now) {
    rafId = null;
    if (isLoading || !isNearView) return;

    const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    if (!isDragging) {
      const step = -SPEED_PX_PER_SEC * dt + dragVelocity * dt;
      shiftTrackBy(step);
      dragVelocity *= Math.pow(0.04, dt);
      if (Math.abs(dragVelocity) < 0.5) dragVelocity = 0;
    }

    ctx.fillStyle = '#dcded6';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
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
    if (!isLoading && isNearView && rafId === null) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(animate);
    }
  }

  function initializeCarousel() {
    if (!isLoading) return;
    isLoading = false;
    wrap.classList.add('is-ready');
    buildTrack();
    setAllVideosPlaying(isNearView);
    startLoop();
  }

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
          const done = () => {
            if (settled) return;
            settled = true;
            entry.ready = true;
            resolve();
          };
          v.addEventListener('loadeddata', done, { once: true });
          v.addEventListener('canplay', done, { once: true });
          v.addEventListener('error', done, { once: true });
          setTimeout(done, 6000);
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
        isNearView = obsEntries.some((item) => item.isIntersecting);
        if (!isLoading) {
          setAllVideosPlaying(isNearView);
          if (isNearView) {
            startLoop();
          } else if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        }
      },
      { rootMargin: '400px 0px' }
    ).observe(wrap);
  }

  resizeCanvas();
  drawLoadingMessage();
});
