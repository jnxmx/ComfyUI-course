// carousel.js

// Количество видеофайлов
const VIDEO_COUNT = 7;

// Скорость движения (px/сек)
const SPEED_PX_PER_SEC = 60;

document.addEventListener('DOMContentLoaded', function() {
  const container = document.getElementById('mobile-timeline');
  const track = document.getElementById('carousel-track');
  const containerWidth = container.offsetWidth;

  // Создаём видео-элементы
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
    if (shift >= containerWidth) {
      shift -= containerWidth;
      const firstVideo = track.firstElementChild;
      track.appendChild(firstVideo);
    }

    track.style.transform = `translateX(-${shift}px)`;
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
});
