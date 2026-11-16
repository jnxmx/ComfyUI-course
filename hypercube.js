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

    // 32 edges of the tesseract
    const edges = [];
    for (let a = 0; a < 16; a++) {
        for (let bit = 0; bit < 4; bit++) {
            const b = a ^ (1 << bit);
            if (a < b) edges.push([a, b]);
        }
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
                        frozenCanvas: null,
                        vellumCanvas: null,
                        pendingGrab: false,
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
        oCtx.filter = 'blur(10px) saturate(0.84) contrast(0.92) brightness(0.98)';
        oCtx.drawImage(sourceCanvas, -14, -14, size + 28, size + 28);
        oCtx.restore();

        const grad = oCtx.createRadialGradient(
            size * 0.5, size * 0.48, size * 0.08,
            size * 0.5, size * 0.5, size * 0.72
        );
        grad.addColorStop(0, 'rgba(206, 209, 200, 0.34)');
        grad.addColorStop(0.65, 'rgba(192, 196, 187, 0.52)');
        grad.addColorStop(1, 'rgba(182, 186, 177, 0.64)');
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

    // Active video element for the single largest visible face
    const activeVideo = document.createElement('video');
    activeVideo.muted = true;
    activeVideo.playsInline = true;
    activeVideo.loop = true;
    activeVideo.preload = 'auto';
    activeVideo.crossOrigin = 'anonymous';

    let activeFaceId = -1;
    let activeVideoReady = false;

    activeVideo.addEventListener('loadeddata', () => {
        const face = faces[activeFaceId];
        if (!face) return;
        if (face.lastTime > 0 && activeVideo.duration && face.lastTime < activeVideo.duration - 0.1) {
            activeVideo.currentTime = face.lastTime;
        }
        activeVideo.play().catch(() => {});
        activeVideoReady = true;
    });

    activeVideo.addEventListener('canplay', () => {
        activeVideoReady = true;
        activeVideo.play().catch(() => {});
    });

    // Background frame grabber queue for newly appearing neighbor faces
    const grabVideo = document.createElement('video');
    grabVideo.muted = true;
    grabVideo.playsInline = true;
    grabVideo.preload = 'auto';
    grabVideo.crossOrigin = 'anonymous';

    const grabQueue = [];
    let grabbingFace = null;

    function processGrabQueue() {
        if (grabbingFace || grabQueue.length === 0) return;
        const face = grabQueue.shift();
        if (!face) return;
        grabbingFace = face;
        grabVideo.src = TIMELINE_VIDEOS[face.videoIndex];
        grabVideo.load();
    }

    grabVideo.addEventListener('loadeddata', () => {
        if (!grabbingFace) return;
        const dur = grabVideo.duration || 4;
        const targetTime = grabbingFace.lastTime > 0
            ? Math.min(grabbingFace.lastTime, Math.max(0, dur - 0.2))
            : Math.min(dur * (0.15 + Math.random() * 0.65), Math.max(0, dur - 0.2));
        grabbingFace.lastTime = targetTime;
        try {
            grabVideo.currentTime = targetTime;
        } catch {
            finalizeGrab();
        }
    });

    function finalizeGrab() {
        if (!grabbingFace) return;
        const snap = captureCoverFrame(grabVideo);
        if (snap) {
            grabbingFace.frozenCanvas = snap;
            grabbingFace.vellumCanvas = bakeVellumFromFrame(snap);
        }
        grabbingFace.pendingGrab = false;
        grabbingFace = null;
        processGrabQueue();
    }

    grabVideo.addEventListener('seeked', finalizeGrab);
    grabVideo.addEventListener('error', () => {
        if (grabbingFace) grabbingFace.pendingGrab = false;
        grabbingFace = null;
        processGrabQueue();
    });

    function scheduleGrab(face) {
        if (face.pendingGrab) return;
        face.pendingGrab = true;
        grabQueue.push(face);
        processGrabQueue();
    }

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
                if (activeVideoReady && activeVideo.videoWidth > 0) {
                    const snap = captureCoverFrame(activeVideo);
                    if (snap) {
                        prevFace.frozenCanvas = snap;
                        prevFace.vellumCanvas = bakeVellumFromFrame(snap);
                    }
                    prevFace.lastTime = activeVideo.currentTime || prevFace.lastTime;
                }
            }
        }

        if (!nextFace) {
            activeFaceId = -1;
            activeVideo.pause();
            activeVideoReady = false;
            return;
        }

        activeFaceId = nextFace.id;
        activeVideoReady = false;
        activeVideo.src = TIMELINE_VIDEOS[nextFace.videoIndex];
        activeVideo.load();
        activeVideo.play().catch(() => {});
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

        // XW rotation
        let c = Math.cos(rotXW), s = Math.sin(rotXW);
        [x, w] = [x * c - w * s, x * s + w * c];

        // YW rotation
        c = Math.cos(rotYW); s = Math.sin(rotYW);
        [y, w] = [y * c - w * s, y * s + w * c];

        // XY rotation
        c = Math.cos(rotXY); s = Math.sin(rotXY);
        [x, y] = [x * c - y * s, x * s + y * c];

        // XZ rotation
        c = Math.cos(rotXZ); s = Math.sin(rotXZ);
        [x, z] = [x * c - z * s, x * s + z * c];

        // YZ rotation
        c = Math.cos(rotYZ); s = Math.sin(rotYZ);
        [y, z] = [y * c - z * s, y * s + z * c];

        // 4D -> 3D perspective
        const d4 = 3.15;
        const s4 = d4 / (d4 - w);
        const x3 = x * s4;
        const y3 = y * s4;
        const z3 = z * s4;

        // 3D -> 2D perspective
        const d3 = 4.35;
        const s3 = d3 / (d3 - z3);
        const scale = Math.min(wPx, hPx) * 0.295;

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

    function drawTriangleImage(src, sx, sy, sw, sh, d0, d1, d2, uv0, uv1, uv2, dpr) {
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

    function drawTexturedQuad(src, pts, dpr) {
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

                drawTriangleImage(src, sx, sy, side, side, q00, q10, q11, [uA, vA], [uB, vA], [uB, vB], dpr);
                drawTriangleImage(src, sx, sy, side, side, q00, q11, q01, [uA, vA], [uB, vB], [uA, vB], dpr);
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

        if (!isDragging) {
            rotXZ += velX + dt * 0.22;
            rotYZ += velY + dt * 0.09;
            rotXW += dt * 0.28;
            rotYW += dt * 0.17;
            velX *= 0.93;
            velY *= 0.93;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const wPx = canvas.width;
        const hPx = canvas.height;
        ctx.clearRect(0, 0, wPx, hPx);

        const projected = vertices4D.map((v) => rotateAndProject(v, wPx, hPx));

        // Compute face metrics
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

        // Determine the single largest face toward the viewer (with slight hysteresis)
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

        // Determine which faces are currently visible (not edge-on, not hidden behind the largest playing face)
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

        // Assign random videos to newly appearing faces that were hidden
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
                m.face.lastTime = 0;
                m.face.frozenCanvas = null;
                m.face.vellumCanvas = null;
                if (!largestMetric || m.face.id !== largestMetric.face.id) {
                    scheduleGrab(m.face);
                }
            }
            m.face.wasVisible = isVis;
        }

        if (largestMetric) {
            setActiveFace(largestMetric.face);
            largestMetric.face.lastTime = activeVideo.currentTime || largestMetric.face.lastTime;
        }

        // Draw visible neighbor faces back-to-front with vellum overlay
        const visibleMetrics = faceMetrics
            .filter((m) => visibleSet.has(m.face.id) && (!largestMetric || m.face.id !== largestMetric.face.id))
            .sort((a, b) => a.avgZ - b.avgZ);

        for (const m of visibleMetrics) {
            if (m.face.vellumCanvas) {
                drawTexturedQuad(m.face.vellumCanvas, m.pts, dpr);
            } else {
                // Soft vellum placeholder while initial frame is loading
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(m.pts[0].x, m.pts[0].y);
                for (let i = 1; i < 4; i++) ctx.lineTo(m.pts[i].x, m.pts[i].y);
                ctx.closePath();
                ctx.fillStyle = 'rgba(206, 209, 200, 0.36)';
                ctx.fill();
                ctx.restore();
            }
        }

        // Draw the largest face toward the viewer with live playing video
        if (largestMetric) {
            if (activeVideoReady && activeVideo.videoWidth > 0) {
                drawTexturedQuad(activeVideo, largestMetric.pts, dpr);
            } else if (largestMetric.face.frozenCanvas) {
                drawTexturedQuad(largestMetric.face.frozenCanvas, largestMetric.pts, dpr);
            }
        }

        // Draw all 32 edges of the tesseract in crisp black ink
        ctx.save();
        ctx.strokeStyle = '#141414';
        ctx.lineWidth = Math.max(1.8, 2.2 * dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const [a, b] of edges) {
            ctx.moveTo(projected[a].x, projected[a].y);
            ctx.lineTo(projected[b].x, projected[b].y);
        }
        ctx.stroke();
        ctx.restore();

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
