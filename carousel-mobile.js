<script>
  // Full corrected script
  // Ensure that #mobile-timeline is NOT inside any max-width wrapper if you want 100vw effect.

  document.addEventListener('DOMContentLoaded', function() {
    // Number of video files (Timeline 1.mp4 to Timeline N.mp4)
    const VIDEO_COUNT = 7;
    // Speed of leftward movement (px per second)
    const SPEED_PX_PER_SEC = 60;

    // Find carousel elements
    const container = document.getElementById('mobile-timeline');
    const track = document.getElementById('carousel-track');

    // Use the full window width so each video is 100vw
    const containerWidth = window.innerWidth;

    // Create and append videos
    for (let i = 1; i <= VIDEO_COUNT; i++) {
      const videoEl = document.createElement('video');
      videoEl.src = `assets/video/Timeline ${i}.mp4`;
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.loop = true;
      track.appendChild(videoEl);
    }

    // Initial shift and time
    let shift = 0;
    let lastTime = performance.now();

    function animate(time) {
      const dt = (time - lastTime) / 1000; 
      lastTime = time;

      // Move carousel leftward
      shift += SPEED_PX_PER_SEC * dt;

      // If first video is fully off screen to the left, move it to the end
      if (shift >= containerWidth) {
        shift -= containerWidth;
        const firstVideo = track.firstElementChild;
        track.appendChild(firstVideo);
      }

      // Apply transform
      track.style.transform = `translateX(-${shift}px)`;

      requestAnimationFrame(animate);
    }

    // Start animation
    requestAnimationFrame(animate);
  });
</script>
