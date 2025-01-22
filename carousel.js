// carousel-canvas.js

document.addEventListener('DOMContentLoaded', function() {
  const VIDEO_COUNT = 7; // Количество видеофайлов (например, Timeline 1.mp4 до Timeline 7.mp4)
  const SPEED_PX_PER_SEC = 60; // Скорость прокрутки в пикселях в секунду
  const FRAME_RATE = 30; // Целевая частота кадров

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  // Установка размеров Canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.35; // 35% от высоты экрана
  }
  resizeCanvas();

  window.addEventListener('resize', function() {
    resizeCanvas();
    // При изменении размера можно перезапустить карусель
    // Для упрощения перезагружаем страницу
    // Альтернативно, можно реализовать динамическое обновление
    // location.reload();
  });

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
        startCarousel();
      }
    } else {
      video.addEventListener('loadeddata', () => {
        videosReady++;
        if (videosReady === VIDEO_COUNT) {
          startCarousel();
        }
      });
    }
  });

  function startCarousel() {
    // Рассчитываем ширину каждого видео на основе высоты Canvas
    const videoWidths = videos.map(video => {
      const aspectRatio = video.videoWidth / video.videoHeight;
      return canvas.height * aspectRatio; // Ширина = высота * соотношение сторон
    });

    // Создаём объекты видео с их шириной и начальной позицией
    let carousel = [];
    let currentX = 0;
    for (let i = 0; i < VIDEO_COUNT * 2; i++) { // Два набора для бесконечной прокрутки
      const index = i % VIDEO_COUNT;
      carousel.push({
        video: videos[index],
        width: videoWidths[index],
        x: currentX
      });
      currentX += videoWidths[index];
    }

    // Переменные анимации
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
          ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height);
        }
      });

      // Запрашиваем следующий кадр
      requestAnimationFrame(animate);
    }

    // Запуск анимации
    requestAnimationFrame(animate);
  }
});
