  document.addEventListener('DOMContentLoaded', function() {
    // Number of video files: "Timeline 1.mp4" through "Timeline N.mp4"
    const VIDEO_COUNT = 7;       // Change to 10, etc., as needed
    const SPEED_PX_PER_SEC = 60; // 60px per second to the left

    const container = document.getElementById('mobile-timeline');
    const track = document.getElementById('carousel-track');

    // We want to measure the screen width for 100vw, 
    // so let's just take innerWidth to keep it simple
    const containerWidth = window.innerWidth;

    // Create the video elements
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

      // If the first video is fully offscreen, move it to the end
      if (shift >= containerWidth) {
        shift -= containerWidth;
        const firstVideo = track.firstElementChild;
        track.appendChild(firstVideo);
      }

      // Translate the track to the left
      track.style.transform = `translateX(-${shift}px)`;
      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  });
