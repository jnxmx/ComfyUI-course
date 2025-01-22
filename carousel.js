// carousel-canvas.js

document.addEventListener('DOMContentLoaded', function() {
  const VIDEO_COUNT = 7; // Количество видеофайлов (Timeline 1.mp4 до Timeline 7.mp4)
  const SPEED_PX_PER_SEC = 60; // Скорость прокрутки в пикселях в секунду

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  let videoElements = [];
  let carousel = [];
  let totalWidth = 0;
  let animationId;

  // Установка размеров Canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.35; // 35% от высоты экрана
  }

  resizeCanvas();

  window.addEventListener('resize', function() {
    resizeCanvas();
    initializeCarousel();
  });

  // Создание и добавление видеоэлементов
  function createVideos(count) {
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= count; i++) {
      const video = document.createElement('video');
      video.src = `assets/video/Timeline ${i}.mp4`;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.style.display = 'none'; // Скрываем видеоэлементы
      video.addEventListener('error', () => {
        console.error(`Не удалось загрузить видео: Timeline ${i}.mp4`);
      });
      fragment.appendChild(video);
      videoElements.push(video);
    }
    document.body.appendChild(fragment);
  }

  createVideos(VIDEO_COUNT);

  // Проверка загрузки видео
  function waitForVideosToLoad(videos, callback) {
    let loaded = 0;
    videos.forEach(video => {
      if (video.readyState >= 3) { // HAVE_FUTURE_DATA
        loaded++;
        if (loaded === videos.length) {
          callback();
        }
      } else {
        video.addEventListener('loadeddata', () => {
          loaded++;
          if (loaded === videos.length) {
            callback();
          }
        });
      }
    });
  }

  waitForVideosToLoad(videoElements, initializeCarousel);

  // Инициализация карусели
  function initializeCarousel() {
    // Остановить предыдущую анимацию, если она есть
    if (animationId) {
      cancelAnimationFrame(animationId);
    }

    // Очистить предыдущие позиции
    carousel = [];
    totalWidth = 0;

    // Рассчитываем ширину каждого видео на основе высоты Canvas
    const videoWidths = videoElements.map(video => {
      const aspectRatio = video.videoWidth / video.videoHeight;
      return canvas.height * aspectRatio; // Ширина = высота * соотношение сторон
    });

    // Создаём два набора видео для бесконечной прокрутки
    for (let i = 0; i < VIDEO_COUNT * 2; i++) {
      const index = i % VIDEO_COUNT;
      carousel.push({
        video: videoElements[index],
        width: videoWidths[index],
        x: totalWidth
      });
      totalWidth += videoWidths[index];
    }

    // Запуск анимации
    let lastTime = performance.now();

    function animate(time) {
      const deltaTime = (time - lastTime) / 1000; // Время с последнего кадра в секундах
      lastTime = time;

      // Обновляем позиции видео
      carousel.forEach(obj => {
        obj.x -= SPEED_PX_PER_SEC * deltaTime;
      });

      // Проверяем, вышло ли первое видео за левый край
      const first = carousel[0];
      if (first.x + first.width <= 0) {
        // Удаляем первое видео и добавляем его в конец
        carousel.shift();
        const last = carousel[carousel.length - 1];
        carousel.push({
          video: first.video,
          width: first.width,
          x: last.x + last.width
        });
      }

      // Очищаем Canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Рисуем только видимые видео
      carousel.forEach(obj => {
        if (obj.x < canvas.width && obj.x + obj.width > 0) { // Если видео видимо
          try {
            ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height);
          } catch (e) {
            console.error('Ошибка при отрисовке видео на Canvas:', e);
          }
        }
      });

      // Запрашиваем следующий кадр
      animationId = requestAnimationFrame(animate);
    }

    animationId = requestAnimationFrame(animate);
  }
});
