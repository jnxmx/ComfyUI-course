document.addEventListener('DOMContentLoaded', function () {
  const VIDEO_COUNT = 7;
  const SPEED_PX_PER_SEC = 60;

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  let carousel = [];
  let totalWidth = 0;
  let lastTime = performance.now();

  const videos = [];
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const video = document.createElement('video');
    video.src = `assets/video/Timeline ${i}.mp4`;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.display = 'none';
    video.oncanplay = () => {
      video.play().catch(err => {
        console.error(`Ошибка воспроизведения видео ${video.src}:`, err);
      });
    };
    document.body.appendChild(video);
    videos.push(video);
  }

  function initializeCarousel() {
    calculateVisibleVideos();
    lastTime = performance.now();
    requestAnimationFrame(animate);
  }

  function calculateVisibleVideos() {
    carousel = [];
    totalWidth = 0;

    // Устанавливаем размер каждого видео равным высоте Canvas (квадрат)
    const videoSize = canvas.height;

    // Заполняем видимую область видео
    let requiredWidth = canvas.width;
    let i = 0;
    while (requiredWidth > 0) {
      const video = videos[i % VIDEO_COUNT];
      carousel.push({
        video: video,
        width: videoSize,
        x: totalWidth
      });
      totalWidth += videoSize;
      requiredWidth -= videoSize;
      i++;
      if (i > VIDEO_COUNT * 2) break;
    }

    // Добавляем одно дополнительное видео для плавного перехода
    const video = videos[i % VIDEO_COUNT];
    carousel.push({
      video: video,
      width: videoSize,
      x: totalWidth
    });
    totalWidth += videoSize;
  }

  function resizeCanvas() {
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

    // Устанавливаем размер Canvas с минимальной высотой 250px
    canvas.width = window.innerWidth;
    canvas.height = Math.max(viewportHeight * 0.35, 250);

    console.log(`Canvas resized: ${canvas.width}px x ${canvas.height}px`);
    calculateVisibleVideos();
  }

  function animate(time) {
    const deltaTime = (time - lastTime) / 1000;

      // Limit FPS to 30 (33.33 ms per frame)
    if (time - lastTime < 1000 / 30) {
      requestAnimationFrame(animate);
      return;
    }
    lastTime = time;

    // Обновляем позиции видео
    carousel.forEach(obj => {
      obj.x -= SPEED_PX_PER_SEC * deltaTime;
    });

    // Перемещаем видео, которые выходят за левый край
    const first = carousel[0];
    if (first.x + first.width <= 0) {
      carousel.shift();
      const last = carousel[carousel.length - 1];
      const nextVideoIndex = (videos.indexOf(last.video) + 1) % VIDEO_COUNT;
      const nextVideo = videos[nextVideoIndex];
      carousel.push({
        video: nextVideo,
        width: canvas.height,
        x: last.x + last.width
      });
    }

    // Очищаем Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем видимые видео
    carousel.forEach(obj => {
      if (obj.x < canvas.width && obj.x + obj.width > 0) {
        if (obj.video.readyState >= 2) {
          ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height);
        }
      }
    });

    requestAnimationFrame(animate);
  }

  let videosReady = 0;
  videos.forEach(video => {
    if (video.readyState >= 3) {
      videosReady++;
      if (videosReady === VIDEO_COUNT) {
        initializeCarousel();
      }
    } else {
      video.addEventListener('loadeddata', () => {
        videosReady++;
        if (videosReady === VIDEO_COUNT) {
          initializeCarousel();
        }
      });
    }
  });

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
});
