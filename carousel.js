// carousel-canvas.js

document.addEventListener('DOMContentLoaded', function() {
  const VIDEO_COUNT = 7; // Количество видеофайлов: Timeline 1.mp4 до Timeline 7.mp4
  const SPEED_PX_PER_SEC = 60; // Скорость прокрутки в пикселях в секунду
  const FRAME_RATE = 30; // Целевая частота кадров

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  // Установка размеров Canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.35; // 35% от высоты экрана
    calculateVisibleVideos();
  }

  window.addEventListener('resize', function() {
    resizeCanvas();
  });

  resizeCanvas(); // Инициализация размеров при загрузке

  // Создание скрытых видеоэлементов
  const videos = [];
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const video = document.createElement('video');
    video.src = `assets/video/Timeline ${i}.mp4`;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.display = 'none'; // Скрываем видеоэлементы
    document.body.appendChild(video);
    videos.push(video);
  }

  // Ожидание загрузки всех видео
  let videosReady = 0;
  videos.forEach(video => {
    if (video.readyState >= 3) { // HAVE_FUTURE_DATA
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

  let carousel = []; // Массив объектов с видео и их позициями
  let totalWidth = 0; // Общая ширина одного набора видео

  function initializeCarousel() {
    calculateVisibleVideos();
    requestAnimationFrame(animate);
  }

  function calculateVisibleVideos() {
    // Очистка текущего каруселя
    carousel = [];
    totalWidth = 0;

    // Рассчитываем ширину каждого видео на основе высоты Canvas
    const videoWidths = videos.map(video => {
      const aspectRatio = video.videoWidth / video.videoHeight;
      return canvas.height * aspectRatio; // Ширина = высота * соотношение сторон
    });

    // Определяем, сколько видео нужно для заполнения видимой области
    let requiredWidth = canvas.width;
    let i = 0;
    while (requiredWidth > 0) {
      const video = videos[i % VIDEO_COUNT];
      const width = videoWidths[i % VIDEO_COUNT];
      carousel.push({
        video: video,
        width: width,
        x: totalWidth
      });
      totalWidth += width;
      requiredWidth -= width;
      i++;
      // Ограничиваем количество видео, чтобы избежать бесконечного цикла
      if (i > VIDEO_COUNT * 2) break;
    }

    // Добавляем ещё одно видео для плавного перехода
    const video = videos[i % VIDEO_COUNT];
    const width = videoWidths[i % VIDEO_COUNT];
    carousel.push({
      video: video,
      width: width,
      x: totalWidth
    });
    totalWidth += width;
  }

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
      const nextVideoIndex = (videos.indexOf(last.video) + 1) % VIDEO_COUNT;
      const nextVideo = videos[nextVideoIndex];
      const nextWidth = canvas.height * (nextVideo.videoWidth / nextVideo.videoHeight);
      carousel.push({
        video: nextVideo,
        width: nextWidth,
        x: last.x + last.width
      });
    }

    // Очищаем Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем только видимые видео
    carousel.forEach(obj => {
      if (obj.x < canvas.width && obj.x + obj.width > 0) { // Если видео видимо
        ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height);
      }
    });

    // Запрашиваем следующий кадр
    requestAnimationFrame(animate);
  }

  let lastTime = performance.now();

});
