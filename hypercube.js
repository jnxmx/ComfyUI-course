(() => {
    const container = document.getElementById('about-hypercube');
    const canvas = document.getElementById('about-hypercube-canvas');
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const TIMELINE_VIDEOS = [
        'assets/video/Timeline 1.mp4',
        'assets/video/Timeline 2.mp4',
        'assets/video/Timeline 3.mp4',
        'assets/video/Timeline 4.mp4',
        'assets/video/Timeline 5.mp4',
        'assets/video/Timeline 6.mp4',
        'assets/video/Timeline 7.mp4',
        'assets/video/Timeline 8.mp4',
        'assets/video/Timeline 9.mp4',
        'assets/video/Timeline 10.mp4',
    ];

    // 16 vertices of a 4D hypercube (tesseract)
    const vertices4D = [];
    for (let i = 0; i < 16; i++) {
        vertices4D.push([
            (i & 1) ? 1 : -1,
            (i & 2) ? 1 : -1,
            (i & 4) ? 1 : -1,
            (i & 8) ? 1 : -1,
        ]);
    }

    // 24 square faces of the tesseract
    const faces = [];
    for (let axisA = 0; axisA < 4; axisA++) {
        for (let axisB = axisA + 1; axisB < 4; axisB++) {
            const varying = [0, 1, 2, 3].filter((ax) => ax !== axisA && ax !== axisB);
            const [uAx, vAx] = varying;
            for (const sA of [-1, 1]) {
                for (const sB of [-1, 1]) {
                    const uvCorners = [
                        [-1, -1],
                        [1, -1],
                        [1, 1],
                        [-1, 1],
                    ];
                    const indices = uvCorners.map(([u, v]) => {
                        let idx = 0;
                        if (sA > 0) idx |= (1 << axisA);
                        if (sB > 0) idx |= (1 << axisB);
                        if (u > 0) idx |= (1 << uAx);
                        if (v > 0) idx |= (1 << vAx);
                        return idx;
                    });
                    faces.push({
                        id: faces.length,
                        indices,
                        videoIndex: faces.length % TIMELINE_VIDEOS.length,
                        lastTime: 0,
                        wasVisible: false,
                        clarity: 0,
                        frozenCanvas: null,
                        vellumCanvas: null,
                    });
                }
            }
        }
    }

    // Pre-generate vellum grain & fiber overlay canvas
    const vellumTexture = document.createElement('canvas');
    vellumTexture.width = 256;
    vellumTexture.height = 256;
    const vCtx = vellumTexture.getContext('2d');
    if (vCtx) {
        const img = vCtx.createImageData(256, 256);
        const d = img.data;
        let seed = 1337;
        const rand = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
        for (let i = 0; i < d.length; i += 4) {
            const n = Math.floor(175 + (rand() - 0.5) * 60);
            d[i] = n;
            d[i + 1] = n + 2;
            d[i + 2] = n - 4;
            d[i + 3] = Math.floor(26 + rand() * 34);
        }
        vCtx.putImageData(img, 0, 0);

        vCtx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
        vCtx.lineWidth = 0.7;
        for (let i = 0; i < 42; i++) {
            const x = rand() * 256;
            const y = rand() * 256;
            const ang = rand() * Math.PI * 2;
            const len = 8 + rand() * 18;
            vCtx.beginPath();
            vCtx.moveTo(x, y);
            vCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
            vCtx.stroke();
        }
    }

    function bakeVellumFromFrame(sourceCanvas) {
        const size = 256;
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const oCtx = out.getContext('2d');
        if (!oCtx) return out;

        oCtx.save();
        oCtx.filter = 'blur(14px) saturate(0.84) contrast(0.92) brightness(0.98)';
        oCtx.drawImage(sourceCanvas, -16, -16, size + 32, size + 32);
        oCtx.restore();

        const grad = oCtx.createRadialGradient(
            size * 0.5, size * 0.48, size * 0.08,
            size * 0.5, size * 0.5, size * 0.72
        );
        grad.addColorStop(0, 'rgba(206, 209, 200, 0.28)');
        grad.addColorStop(0.65, 'rgba(192, 196, 187, 0.44)');
        grad.addColorStop(1, 'rgba(182, 186, 177, 0.56)');
        oCtx.fillStyle = grad;
        oCtx.fillRect(0, 0, size, size);

        oCtx.drawImage(vellumTexture, 0, 0, size, size);
        return out;
    }

    function captureCoverFrame(videoEl) {
        const size = 256;
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const oCtx = out.getContext('2d');
        if (!oCtx || !videoEl.videoWidth || !videoEl.videoHeight) return null;

        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;
        const side = Math.min(vw, vh);
        const sx = (vw - side) * 0.5;
        const sy = (vh - side) * 0.5;
        oCtx.drawImage(videoEl, sx, sy, side, side, 0, 0, size, size);
        return out;
    }

    // Preload all 10 carousel videos so the cube only appears once every video has a ready frame
    const videoPool = TIMELINE_VIDEOS.map((src, idx) => {
        const video = document.createElement('video');
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';
        return {
            index: idx,
            video,
            defaultFrozen: null,
            defaultVellum: null,
            ready: false,
        };
    });

    function preloadVideoEntry(entry) {
        return new Promise((resolve) => {
            const v = entry.video;
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (v.videoWidth > 0) {
                    const snap = captureCoverFrame(v);
                    if (snap) {
                        entry.defaultFrozen = snap;
                        entry.defaultVellum = bakeVellumFromFrame(snap);
                    }
                }
                entry.ready = true;
                resolve();
            };

            const onSeeked = () => {
                v.removeEventListener('seeked', onSeeked);
                finish();
            };

            const onLoadedData = () => {
                v.removeEventListener('loadeddata', onLoadedData);
                const dur = v.duration && Number.isFinite(v.duration) ? v.duration : 4;
                const initialT = Math.min(dur * 0.25, Math.max(0.1, dur - 0.2));
                v.addEventListener('seeked', onSeeked);
                try {
                    v.currentTime = initialT;
                } catch {
                    finish();
                }
            };

            v.addEventListener('loadeddata', onLoadedData);
            v.addEventListener('error', finish);
            setTimeout(finish, 8000);
            v.load();
        });
    }

    let activeFaceId = -1;
    let allVideosReady = false;

    function pickRandomVideoIndex(excludeSet) {
        const candidates = [];
        for (let i = 0; i < TIMELINE_VIDEOS.length; i++) {
            if (!excludeSet.has(i)) candidates.push(i);
        }
        const pool = candidates.length > 0 ? candidates : TIMELINE_VIDEOS.map((_, i) => i);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function setActiveFace(nextFace) {
        if (nextFace && nextFace.id === activeFaceId) return;

        if (activeFaceId !== -1) {
            const prevFace = faces[activeFaceId];
            if (prevFace) {
                const prevEntry = videoPool[prevFace.videoIndex];
                if (prevEntry && prevEntry.video.videoWidth > 0) {
                    const snap = captureCoverFrame(prevEntry.video);
                    if (snap) {
                        prevFace.frozenCanvas = snap;
                        prevFace.vellumCanvas = bakeVellumFromFrame(snap);
                    }
                    prevFace.lastTime = prevEntry.video.currentTime || prevFace.lastTime;
                    prevEntry.video.pause();
                }
            }
        }

        if (!nextFace) {
            activeFaceId = -1;
            return;
        }

        activeFaceId = nextFace.id;
        const nextEntry = videoPool[nextFace.videoIndex];
        if (nextEntry) {
            const v = nextEntry.video;
            if (nextFace.lastTime > 0 && v.duration && nextFace.lastTime < v.duration - 0.1) {
                try {
                    v.currentTime = nextFace.lastTime;
                } catch {}
            }
            v.play().catch(() => {});
        }
    }

    // 4D & 3D rotation state
    let rotXW = 0.48;
    let rotYW = 0.34;
    let rotXZ = 0.52;
    let rotYZ = 0.36;
    let rotXY = 0.08;

    let velX = 0;
    let velY = 0;
    let isDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    canvas.addEventListener('pointerdown', (e) => {
        isDragging = true;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        velX = 0;
        velY = 0;
        canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;

        const sensitivity = 0.0065;
        rotXZ += dx * sensitivity;
        rotYZ += dy * sensitivity;
        rotXW += dx * sensitivity * 0.45;
        rotYW += dy * sensitivity * 0.35;

        velX = dx * sensitivity;
        velY = dy * sensitivity;
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

    function rotateAndProject(v, wPx, hPx) {
        let [x, y, z, w] = v;

        let c = Math.cos(rotXW), s = Math.sin(rotXW);
        [x, w] = [x * c - w * s, x * s + w * c];

        c = Math.cos(rotYW); s = Math.sin(rotYW);
        [y, w] = [y * c - w * s, y * s + w * c];

        c = Math.cos(rotXY); s = Math.sin(rotXY);
        [x, y] = [x * c - y * s, x * s + y * c];

        c = Math.cos(rotXZ); s = Math.sin(rotXZ);
        [x, z] = [x * c - z * s, x * s + z * c];

        c = Math.cos(rotYZ); s = Math.sin(rotYZ);
        [y, z] = [y * c - z * s, y * s + z * c];

        // Less wide-angle / more telephoto projection for gentler perspective distortion
        const d4 = 5.4;
        const s4 = d4 / (d4 - w);
        const x3 = x * s4;
        const y3 = y * s4;
        const z3 = z * s4;

        const d3 = 9.8;
        const s3 = d3 / (d3 - z3);
        const scale = Math.min(wPx, hPx) * 0.32;

        return {
            x: wPx * 0.5 + x3 * s3 * scale,
            y: hPx * 0.5 - y3 * s3 * scale,
            z3,
            w,
        };
    }

    function quadArea(pts) {
        let sum = 0;
        for (let i = 0; i < 4; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % 4];
            sum += a.x * b.y - b.x * a.y;
        }
        return Math.abs(sum) * 0.5;
    }

    function pointInQuad(px, py, pts) {
        let pos = 0;
        let neg = 0;
        for (let i = 0; i < 4; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % 4];
            const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
            if (cross > 0) pos++;
            else if (cross < 0) neg++;
        }
        return pos === 0 || neg === 0;
    }

    function bilerp(p0, p1, p2, p3, u, v) {
        const iu = 1 - u;
        const iv = 1 - v;
        return {
            x: iu * iv * p0.x + u * iv * p1.x + u * v * p2.x + iu * v * p3.x,
            y: iu * iv * p0.y + u * iv * p1.y + u * v * p2.y + iu * v * p3.y,
        };
    }

    function drawTriangleImage(src, sx, sy, sw, sh, d0, d1, d2, uv0, uv1, uv2, alpha) {
        const u0 = sx + uv0[0] * sw;
        const v0 = sy + uv0[1] * sh;
        const u1 = sx + uv1[0] * sw;
        const v1 = sy + uv1[1] * sh;
        const u2 = sx + uv2[0] * sw;
        const v2 = sy + uv2[1] * sh;

        const denom = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
        if (Math.abs(denom) < 1e-5) return;

        const dx1 = d1.x - d0.x;
        const dy1 = d1.y - d0.y;
        const dx2 = d2.x - d0.x;
        const dy2 = d2.y - d0.y;

        const a = (dx1 * (v2 - v0) - dx2 * (v1 - v0)) / denom;
        const b = (dy1 * (v2 - v0) - dy2 * (v1 - v0)) / denom;
        const c = (dx2 * (u1 - u0) - dx1 * (u2 - u0)) / denom;
        const d = (dy2 * (u1 - u0) - dy1 * (u2 - u0)) / denom;
        const e = d0.x - a * u0 - c * v0;
        const f = d0.y - b * u0 - d * v0;

        ctx.save();
        if (alpha < 1) ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(d1.x, d1.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.closePath();
        ctx.clip();

        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(src, 0, 0);
        ctx.restore();
    }

    function drawTexturedQuad(src, pts, alpha = 1) {
        if (!src || alpha <= 0.005) return;
        const srcW = src.videoWidth || src.width;
        const srcH = src.videoHeight || src.height;
        if (!srcW || !srcH) return;

        const side = Math.min(srcW, srcH);
        const sx = (srcW - side) * 0.5;
        const sy = (srcH - side) * 0.5;

        const [p0, p1, p2, p3] = pts;
        const steps = 4;
        for (let iy = 0; iy < steps; iy++) {
            const vA = iy / steps;
            const vB = (iy + 1) / steps;
            for (let ix = 0; ix < steps; ix++) {
                const uA = ix / steps;
                const uB = (ix + 1) / steps;

                const q00 = bilerp(p0, p1, p2, p3, uA, vA);
                const q10 = bilerp(p0, p1, p2, p3, uB, vA);
                const q11 = bilerp(p0, p1, p2, p3, uB, vB);
                const q01 = bilerp(p0, p1, p2, p3, uA, vB);

                drawTriangleImage(src, sx, sy, side, side, q00, q10, q11, [uA, vA], [uB, vA], [uB, vB], alpha);
                drawTriangleImage(src, sx, sy, side, side, q00, q11, q01, [uA, vA], [uB, vB], [uA, vB], alpha);
            }
        }
    }

    function resizeCanvas() {
        const rect = container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(container);
    resizeCanvas();

    let lastFrameTime = performance.now();

    function render(now) {
        const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
        lastFrameTime = now;

        if (!allVideosReady) {
            requestAnimationFrame(render);
            return;
        }

        if (!isDragging) {
            rotXZ += velX + dt * 0.22;
            rotYZ += velY + dt * 0.09;
            rotXW += dt * 0.28;
            rotYW += dt * 0.17;
            velX *= 0.93;
            velY *= 0.93;
        }

        const wPx = canvas.width;
        const hPx = canvas.height;
        ctx.clearRect(0, 0, wPx, hPx);

        const projected = vertices4D.map((v) => rotateAndProject(v, wPx, hPx));

        const faceMetrics = faces.map((face) => {
            const pts = face.indices.map((idx) => projected[idx]);
            const area = quadArea(pts);
            const avgZ = pts.reduce((sum, p) => sum + p.z3, 0) * 0.25;
            const cx = pts.reduce((sum, p) => sum + p.x, 0) * 0.25;
            const cy = pts.reduce((sum, p) => sum + p.y, 0) * 0.25;
            return { face, pts, area, avgZ, cx, cy };
        });

        let maxArea = 0;
        for (const m of faceMetrics) {
            if (m.area > maxArea) maxArea = m.area;
        }

        let largestMetric = null;
        let bestScore = -1;
        for (const m of faceMetrics) {
            const bonus = m.face.id === activeFaceId ? 1.08 : 1.0;
            const score = m.area * bonus;
            if (score > bestScore) {
                bestScore = score;
                largestMetric = m;
            }
        }

        const minAreaThreshold = maxArea * 0.16;
        const visibleSet = new Set();
        for (const m of faceMetrics) {
            if (m === largestMetric) {
                visibleSet.add(m.face.id);
                continue;
            }
            if (m.area < minAreaThreshold) continue;
            const behindLargest =
                largestMetric &&
                m.avgZ < largestMetric.avgZ - 0.05 &&
                pointInQuad(m.cx, m.cy, largestMetric.pts);
            if (!behindLargest) {
                visibleSet.add(m.face.id);
            }
        }

        const activeVideosInUse = new Set();
        for (const m of faceMetrics) {
            if (m.face.wasVisible && visibleSet.has(m.face.id)) {
                activeVideosInUse.add(m.face.videoIndex);
            }
        }

        for (const m of faceMetrics) {
            const isVis = visibleSet.has(m.face.id);
            if (isVis && !m.face.wasVisible) {
                m.face.videoIndex = pickRandomVideoIndex(activeVideosInUse);
                activeVideosInUse.add(m.face.videoIndex);
                const poolEntry = videoPool[m.face.videoIndex];
                m.face.lastTime = poolEntry ? poolEntry.video.currentTime : 0;
                m.face.frozenCanvas = poolEntry ? poolEntry.defaultFrozen : null;
                m.face.vellumCanvas = poolEntry ? poolEntry.defaultVellum : null;
                m.face.clarity = 0;
            }
            m.face.wasVisible = isVis;
        }

        if (largestMetric) {
            setActiveFace(largestMetric.face);
            const activeEntry = videoPool[largestMetric.face.videoIndex];
            if (activeEntry) {
                largestMetric.face.lastTime = activeEntry.video.currentTime || largestMetric.face.lastTime;
            }
        }

        // Smoothly animate vellum dissipation (matching gallery's 0.55s cubic-bezier fade)
        const clarityRate = dt / 0.55;
        for (const m of faceMetrics) {
            const isLargest = largestMetric && m.face.id === largestMetric.face.id;
            if (isLargest) {
                m.face.clarity = Math.min(1, m.face.clarity + clarityRate);
            } else {
                m.face.clarity = Math.max(0, m.face.clarity - clarityRate);
            }
        }

        // Draw visible neighbor faces back-to-front
        const visibleNeighbors = faceMetrics
            .filter((m) => visibleSet.has(m.face.id) && (!largestMetric || m.face.id !== largestMetric.face.id))
            .sort((a, b) => a.avgZ - b.avgZ);

        for (const m of visibleNeighbors) {
            const entry = videoPool[m.face.videoIndex];
            const frozen = m.face.frozenCanvas || (entry && entry.defaultFrozen);
            const vellum = m.face.vellumCanvas || (entry && entry.defaultVellum);

            if (m.face.clarity > 0.01 && frozen) {
                drawTexturedQuad(frozen, m.pts, 1);
                if (vellum) drawTexturedQuad(vellum, m.pts, 1 - m.face.clarity);
            } else if (vellum) {
                drawTexturedQuad(vellum, m.pts, 1);
            }
        }

        // Draw the largest face toward the viewer with live video + smooth vellum dissipation
        if (largestMetric) {
            const entry = videoPool[largestMetric.face.videoIndex];
            const liveVideo = entry && entry.video.videoWidth > 0 ? entry.video : null;
            const frozen = largestMetric.face.frozenCanvas || (entry && entry.defaultFrozen);
            const vellum = largestMetric.face.vellumCanvas || (entry && entry.defaultVellum);

            if (liveVideo) {
                drawTexturedQuad(liveVideo, largestMetric.pts, 1);
            } else if (frozen) {
                drawTexturedQuad(frozen, largestMetric.pts, 1);
            }

            const vellumAlpha = 1 - largestMetric.face.clarity;
            if (vellum && vellumAlpha > 0.01) {
                drawTexturedQuad(vellum, largestMetric.pts, vellumAlpha);
            }
        }

        requestAnimationFrame(render);
    }

    Promise.all(videoPool.map(preloadVideoEntry)).then(() => {
        allVideosReady = true;
        container.classList.add('is-ready');
    });

    requestAnimationFrame(render);
})();
