// carousel-canvas.js

document.addEventListener('DOMContentLoaded', function() {
  const VIDEO_COUNT = 7; // Количество видеофайлов: Timeline 1.mp4 до Timeline 7.mp4
  const SPEED_PX_PER_SEC = 60; // Скорость прокрутки в пикселях в секунду

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  // Объявляем переменные глобально внутри функции
  let carousel = []; // Массив объектов с видео и их позициями
  let totalWidth = 0; // Общая ширина одного набора видео
  let lastTime = performance.now();

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
    video.oncanplay = () => {
      console.log(`Видео ${video.src} готово к воспроизведению.`);
    };
    video.onerror = () => {
      console.error(`Не удалось загрузить видео: ${video.src}`);
    };
    document.body.appendChild(video);
    videos.push(video);
  }

  // Ожидание загрузки всех видео
  let videosReady = 0;
  videos.forEach(video => {
    if (video.readyState >= 3) { // HAVE_FUTURE_DATA
      videosReady++;
      console.log(`Видео ${video.src} уже готово.`);
      if (videosReady === VIDEO_COUNT) {
        initializeCarousel();
      }
    } else {
      video.addEventListener('loadeddata', () => {
        videosReady++;
        console.log(`Видео ${video.src} загружено.`);
        if (videosReady === VIDEO_COUNT) {
          initializeCarousel();
        }
      });
    }
  });

  // Функция инициализации карусели
  function initializeCarousel() {
    console.log('Инициализация карусели...');
    calculateVisibleVideos();
    resizeCanvas(); // Устанавливаем размеры после инициализации карусели
    requestAnimationFrame(animate);
  }

  // Функция расчёта видимых видео
  function calculateVisibleVideos() {
    // Очистка текущего каруселя
    carousel = [];
    totalWidth = 0;

    // Рассчитываем ширину каждого видео на основе высоты Canvas
    const videoWidths = videos.map(video => {
      const aspectRatio = video.videoWidth / video.videoHeight;
      return canvas.height * aspectRatio; // Ширина = высота * соотношение сторон
    });

    console.log('Рассчитанные ширины видео:', videoWidths);

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

    // Добавляем одно дополнительное видео для плавного перехода
    const video = videos[i % VIDEO_COUNT];
    const width = videoWidths[i % VIDEO_COUNT];
    carousel.push({
      video: video,
      width: width,
      x: totalWidth
    });
    totalWidth += width;

    console.log('Инициализированный карусельный массив:', carousel);
  }

  // Функция изменения размеров Canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.35; // 35% от высоты экрана
    console.log(`Canvas resized: ${canvas.width}px x ${canvas.height}px`);

    // Пересчитываем видимые видео после изменения размеров
    calculateVisibleVideos();
  }

  // Функция анимации
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
      console.log(`Видео ${first.video.src} вышло за левый край и перемещается в конец.`);
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
        if (obj.video.readyState >= 2) { // HAVE_CURRENT_DATA
          ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height);
        } else {
          console.log(`Видео ${obj.video.src} не готово к отрисовке.`);
        }
      }
    });

    // Запрашиваем следующий кадр
    requestAnimationFrame(animate);
  }

  // Инициализация последней переменной
  let lastTime = performance.now();

});
