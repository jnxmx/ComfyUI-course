document.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('course-carousel-wrap');
  if (!wrap) return;

  const BASE_VIDEOS = [
    'assets/video/Timeline 9.mp4',
    'assets/video/Timeline 8.mp4',
    'assets/video/Timeline 7.mp4',
    'assets/video/Timeline 5.mp4',
  ];
  const INTERLEAVE_SRC = 'assets/video/some_new_footage.mp4';
  const CAROUSEL_ITEMS = [];
  for (let i = 0; i < BASE_VIDEOS.length; i++) {
    CAROUSEL_ITEMS.push({ src: BASE_VIDEOS[i], startFraction: 0 });
    CAROUSEL_ITEMS.push({
      src: INTERLEAVE_SRC,
      startFraction: i % 2 === 0 ? 0 : 0.5,
    });
  }
  const SPEED_PX_PER_SEC = 50;

  let cssWidth = 0;
  let cssHeight = 0;
  let trackOffset = 0;
  let tiles = [];
  let isLoading = true;
  let isNearView = true;
  let rafId = null;
  let lastFrameTime = performance.now();

  let isDragging = false;
  let lastPointerX = 0;
  let dragVelocity = 0;

  wrap.innerHTML = '';

  const trackEl = document.createElement('div');
  trackEl.className = 'course-carousel-track';
  trackEl.style.visibility = 'hidden';
  wrap.appendChild(trackEl);

  const posterEl = document.createElement('img');
  posterEl.className = 'course-carousel-poster';
  posterEl.src = 'assets/video/carousel_poster.jpg';
  posterEl.alt = '';
  wrap.appendChild(posterEl);

  const vellumEl = document.createElement('div');
  vellumEl.className = 'vellum-overlay course-carousel-vellum';
  vellumEl.innerHTML =
    '<div class="vellum-info"><div class="vellum-credits"><span class="vellum-author">ВИДЕО ЗАГРУЖАЮТСЯ</span></div></div>';
  wrap.appendChild(vellumEl);

  const entries = [];
  for (let i = 0; i < CAROUSEL_ITEMS.length; i++) {
    const item = CAROUSEL_ITEMS[i];
    const video = document.createElement('video');
    video.src = item.src;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.disablePictureInPicture = true;
    video.preload = i < 4 ? 'auto' : 'metadata';
    video.className = 'course-carousel-tile';
    video.style.visibility = 'hidden';
    trackEl.appendChild(video);
    entries.push({
      index: i,
      video,
      startFraction: item.startFraction,
      initialSeekDone: item.startFraction === 0,
      aspect: 1,
      width: 0,
      offset: 0,
      playingTarget: false,
      loadedFull: i < 4,
    });
  }

  function applyInitialSeek(entry) {
    if (
      entry.startFraction > 0 &&
      !entry.initialSeekDone &&
      entry.video.duration &&
      Number.isFinite(entry.video.duration)
    ) {
      entry.initialSeekDone = true;
      try {
        entry.video.currentTime = entry.video.duration * entry.startFraction;
      } catch {}
    }
  }

  function getEntryAspect(entry) {
    if (entry.video.videoWidth > 0 && entry.video.videoHeight > 0) {
      entry.aspect = entry.video.videoWidth / entry.video.videoHeight;
    }
    return entry.aspect || 1;
  }

  function applyTileGeometry(entry) {
    // Overlap adjacent video tiles by 4px so subpixel/GPU rounding never opens a 1px seam
    entry.video.style.width = `${entry.width + 4}px`;
    entry.video.style.transform = `translate3d(${entry.offset - 2}px, 0, 0)`;
    const screenX = trackOffset + entry.offset;
    const visibleOnScreen = screenX + entry.width > -4 && screenX < cssWidth + 4;
    entry.video.style.visibility = visibleOnScreen ? 'visible' : 'hidden';
  }

  function applyTrackTransform() {
    // Move the entire tile strip as a single composited layer so tile seams never jitter by 1px
    trackEl.style.transform = `translate3d(${trackOffset.toFixed(2)}px, 0, 0)`;
  }

  function syncActiveDecoders() {
    for (let i = 0; i < tiles.length; i++) {
      const entry = tiles[i];
      const screenX = trackOffset + entry.offset;
      const inPlayZone = isNearView && !isLoading && screenX + entry.width > -20 && screenX < cssWidth + entry.width * 1.15;

      if (inPlayZone) {
        if (!entry.loadedFull) {
          entry.loadedFull = true;
          entry.video.preload = 'auto';
        }
        if (!entry.playingTarget) {
          entry.playingTarget = true;
          applyInitialSeek(entry);
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
      let cursor = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        entry.width = Math.round(cssHeight * getEntryAspect(entry));
        entry.offset = cursor;
        cursor += entry.width;
        tiles.push(entry);
        applyTileGeometry(entry);
      }
      trackOffset = 0;
    } else {
      let cursor = tiles[0].offset;
      for (let i = 0; i < tiles.length; i++) {
        const entry = tiles[i];
        entry.width = Math.round(cssHeight * getEntryAspect(entry));
        entry.offset = cursor;
        cursor += entry.width;
        applyTileGeometry(entry);
      }
    }

    applyTrackTransform();
    syncActiveDecoders();
  }

  function shiftTrackBy(dx) {
    if (tiles.length === 0 || cssHeight <= 0) return;

    trackOffset += dx;
    let recycled = false;

    while (tiles.length > 1 && trackOffset + tiles[0].offset + tiles[0].width <= -2) {
      const moved = tiles.shift();
      const last = tiles[tiles.length - 1];
      moved.offset = last.offset + last.width;
      tiles.push(moved);
      recycled = true;
    }

    while (tiles.length > 1 && trackOffset + tiles[0].offset > 2) {
      const moved = tiles.pop();
      const first = tiles[0];
      moved.offset = first.offset - moved.width;
      tiles.unshift(moved);
      recycled = true;
    }

    applyTrackTransform();

    if (recycled) {
      for (let i = 0; i < tiles.length; i++) {
        applyTileGeometry(tiles[i]);
      }
    } else {
      for (let i = 0; i < tiles.length; i++) {
        const entry = tiles[i];
        const screenX = trackOffset + entry.offset;
        const visibleOnScreen = screenX + entry.width > -4 && screenX < cssWidth + 4;
        const nextVis = visibleOnScreen ? 'visible' : 'hidden';
        if (entry.video.style.visibility !== nextVis) {
          entry.video.style.visibility = nextVis;
        }
      }
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
    trackEl.style.visibility = 'visible';
    wrap.classList.add('is-ready');
    setTimeout(() => {
      posterEl.remove();
      vellumEl.remove();
    }, 620);
    layoutTiles();
    startLoop();
    setTimeout(() => {
      for (let i = 4; i < entries.length; i++) {
        if (!entries[i].loadedFull) {
          entries[i].loadedFull = true;
          entries[i].video.preload = 'auto';
        }
      }
    }, 300);
  }

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

  const initialBatch = entries.slice(0, 4);
  Promise.all(
    initialBatch.map(
      (entry) =>
        new Promise((resolve) => {
          const v = entry.video;
          const finish = () => {
            applyInitialSeek(entry);
            resolve();
          };
          if (v.readyState >= 2 && v.videoWidth > 0) {
            finish();
            return;
          }
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            finish();
          };
          v.addEventListener('loadeddata', done, { once: true });
          v.addEventListener('canplay', done, { once: true });
          v.addEventListener('error', done, { once: true });
          setTimeout(done, 4500);
          v.load();
        })
    )
  ).then(initializeCarousel);

  for (let i = 0; i < entries.length; i++) {
    entries[i].video.addEventListener('loadedmetadata', () => {
      applyInitialSeek(entries[i]);
      layoutTiles();
    }, { once: true });
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
