document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('course-carousel-wrap');
  if (!wrap) return;

  const VIDEO_COUNT = 10;
  const SPEED_PX_PER_SEC = 50;

  let cssWidth = 0;
  let cssHeight = 0;
  let tiles = [];
  let isLoading = true;
  let isNearView = true;
  let rafId = null;
  let lastFrameTime = performance.now();

  let isDragging = false;
  let lastPointerX = 0;
  let dragVelocity = 0;

  // Remove any legacy canvas inside wrap if present
  wrap.innerHTML = '';

  const loaderEl = document.createElement('div');
  loaderEl.className = 'course-carousel-loading';
  loaderEl.textContent = 'видео загружаются';
  wrap.appendChild(loaderEl);

  // Create native hardware-composited <video> tiles moved via translate3d
  // (no 2D canvas pixel copy per frame; only visible + 1 lookahead play concurrently).
  const entries = [];
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const video = document.createElement('video');
    video.src = `assets/video/Timeline ${i}.mp4`;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.disablePictureInPicture = true;
    video.preload = i <= 4 ? 'auto' : 'metadata';
    video.className = 'course-carousel-tile';
    video.style.visibility = 'hidden';
    wrap.appendChild(video);
    entries.push({
      index: i - 1,
      video,
      aspect: 1,
      width: 0,
      x: 0,
      playingTarget: false,
      loadedFull: i <= 4,
    });
  }

  function getEntryAspect(entry) {
    if (entry.video.videoWidth > 0 && entry.video.videoHeight > 0) {
      entry.aspect = entry.video.videoWidth / entry.video.videoHeight;
    }
    return entry.aspect || 1;
  }

  function applyTileGeometry(entry) {
    const drawW = Math.ceil(entry.width) + 1;
    entry.video.style.width = `${drawW}px`;
    entry.video.style.transform = `translate3d(${entry.x.toFixed(2)}px, 0, 0)`;
    const visibleOnScreen = entry.x + entry.width > -4 && entry.x < cssWidth + 4;
    entry.video.style.visibility = visibleOnScreen ? 'visible' : 'hidden';
  }

  function syncActiveDecoders() {
    for (let i = 0; i < tiles.length; i++) {
      const entry = tiles[i];
      // Play only tiles inside viewport + 1 tile lookahead on the right (max ~3-4 decoders active)
      const inPlayZone = isNearView && !isLoading && entry.x + entry.width > -20 && entry.x < cssWidth + entry.width * 1.15;

      if (inPlayZone) {
        if (!entry.loadedFull) {
          entry.loadedFull = true;
          entry.video.preload = 'auto';
        }
        if (!entry.playingTarget) {
          entry.playingTarget = true;
          if (entry.video.paused) {
            entry.video.play().catch(() => {});
          }
        }
      } else if (entry.playingTarget) {
        entry.playingTarget = false;
        if (!entry.video.paused) {
          entry.video.pause();
        }
      }
    }
  }

  function layoutTiles() {
    const rect = wrap.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);

    if (tiles.length === 0) {
      let cursorX = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.width = cssHeight * getEntryAspect(entry);
        entry.x = cursorX;
        cursorX += entry.width;
        tiles.push(entry);
        applyTileGeometry(entry);
      }
    } else {
      let cursorX = tiles[0].x;
      for (let i = 0; i < tiles.length; i++) {
        const entry = tiles[i];
        entry.width = cssHeight * getEntryAspect(entry);
        entry.x = cursorX;
        cursorX += entry.width;
        applyTileGeometry(entry);
      }
    }

    syncActiveDecoders();
  }

  function shiftTrackBy(dx) {
    if (tiles.length === 0 || cssHeight <= 0) return;

    for (let i = 0; i < tiles.length; i++) {
      tiles[i].x += dx;
    }

    // Recycle first tile past left edge to the far right end
    while (tiles.length > 1 && tiles[0].x + tiles[0].width <= -2) {
      const moved = tiles.shift();
      const last = tiles[tiles.length - 1];
      moved.x = last.x + last.width;
      tiles.push(moved);
    }

    // Recycle last tile past right edge if dragged backward (to the right)
    while (tiles.length > 1 && tiles[0].x > 2) {
      const moved = tiles.pop();
      const first = tiles[0];
      moved.x = first.x - moved.width;
      tiles.unshift(moved);
    }

    for (let i = 0; i < tiles.length; i++) {
      applyTileGeometry(tiles[i]);
    }

    syncActiveDecoders();
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
    loaderEl.remove();
    layoutTiles();
    startLoop();
    // Warm remaining video buffers in background without starting their decoders yet
    setTimeout(() => {
      for (let i = 4; i < entries.length; i++) {
        if (!entries[i].loadedFull) {
          entries[i].loadedFull = true;
          entries[i].video.preload = 'auto';
        }
      }
    }, 300);
  }

  // Horizontal pointer drag / swipe with threshold so vertical touch scrolling stays untouched
  let dragStarted = false;
  let startPointerX = 0;
  let startPointerY = 0;

  wrap.addEventListener('pointerdown', (e) => {
    dragStarted = true;
    isDragging = false;
    startPointerX = e.clientX;
    startPointerY = e.clientY;
    lastPointerX = e.clientX;
    dragVelocity = 0;
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!dragStarted) return;
    if (!isDragging) {
      const totalDx = Math.abs(e.clientX - startPointerX);
      const totalDy = Math.abs(e.clientY - startPointerY);
      if (totalDy > totalDx && totalDy > 6) {
        dragStarted = false;
        return;
      }
      if (totalDx > 6) {
        isDragging = true;
        lastPointerX = e.clientX;
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {}
      } else {
        return;
      }
    }
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    shiftTrackBy(dx);
    dragVelocity = dx * 28;
  });

  const endDrag = (e) => {
    dragStarted = false;
    if (!isDragging) return;
    isDragging = false;
    if (e && e.pointerId !== undefined && wrap.hasPointerCapture && wrap.hasPointerCapture(e.pointerId)) {
      wrap.releasePointerCapture(e.pointerId);
    }
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);

  // Wait only for initial visible videos (first 4) so mobile starts quickly without saturating decoders
  const initialBatch = entries.slice(0, 4);
  Promise.all(
    initialBatch.map(
      (entry) =>
        new Promise((resolve) => {
          const v = entry.video;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            resolve();
            return;
          }
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          v.addEventListener('loadeddata', done, { once: true });
          v.addEventListener('canplay', done, { once: true });
          v.addEventListener('error', done, { once: true });
          setTimeout(done, 4500);
          v.load();
        })
    )
  ).then(initializeCarousel);

  // Update aspect ratio when remaining metadata arrives
  for (let i = 4; i < entries.length; i++) {
    entries[i].video.addEventListener('loadedmetadata', layoutTiles, { once: true });
  }

  if (window.ResizeObserver) {
    new ResizeObserver(layoutTiles).observe(wrap);
  }
  window.addEventListener('resize', layoutTiles);

  if (window.IntersectionObserver) {
    new IntersectionObserver(
      (obsEntries) => {
        isNearView = obsEntries.some((item) => item.isIntersecting);
        if (!isLoading) {
          syncActiveDecoders();
          if (isNearView) {
            startLoop();
          } else if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        }
      },
      { rootMargin: '250px 0px' }
    ).observe(wrap);
  }

  layoutTiles();
});
