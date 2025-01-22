document.addEventListener('DOMContentLoaded', function() {
    const VIDEO_COUNT = 7;       // or however many you want
    const SPEED_PX_PER_SEC = 60; // speed of scroll

    const container = document.getElementById('mobile-timeline');
    const track = document.getElementById('carousel-track');

    // We'll use window.innerWidth as the "width threshold"
    // If items have varied widths, see the note below.
    const containerWidth = window.innerWidth;

    // Create and append videos (or images)
    for (let i = 1; i <= VIDEO_COUNT; i++) {
      const videoEl = document.createElement('video');
      videoEl.src = `assets/video/Timeline ${i}.mp4`;
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.loop = true;
      track.appendChild(videoEl);
    }

    let shift = 0;
    let lastTime = performance.now();

    function animate(time) {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      shift += SPEED_PX_PER_SEC * dt;

      // If the first item is off the screen by at least containerWidth
      if (shift >= containerWidth) {
        shift -= containerWidth;
        const firstItem = track.firstElementChild;
        track.appendChild(firstItem);
      }

      track.style.transform = `translateX(-${shift}px)`;
      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
    });
