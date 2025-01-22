document.addEventListener('DOMContentLoaded', function() {
  const VIDEO_COUNT = 7;
  const SPEED_PX_PER_SEC = 60;

  const canvas = document.getElementById('video-carousel');
  const ctx = canvas.getContext('2d');

  let carousel = [];
  let totalWidth = 0;
  let lastTime = performance.now(); // Объявляем один раз здесь


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
      video.play().catch(err => {
        console.error(`Ошибка воспроизведения видео ${video.src}:`, err);
      });
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
    lastTime = performance.now(); // Переинициализация времени
    requestAnimationFrame(animate);
  }

  // Функция расчёта видимых видео
  function calculateVisibleVideos() {
  // Очистка текущего каруселя
  carousel = [];
  totalWidth = 0;

  // Рассчитываем ширину каждого видео на основе высоты Canvas
  const videoHeights = canvas.height; // Высота для всех видео равна высоте Canvas
  const videoWidths = videos.map(video => {
    const aspectRatio = video.videoWidth / video.videoHeight; // Соотношение сторон
    return Math.round(videoHeights * aspectRatio); // Используем округление
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
}

  // Функция изменения размеров Canvas
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = Math.max(window.innerHeight * 0.35, 250); // Минимальная высота 250px
    console.log(`Canvas resized: ${canvas.width}px x ${canvas.height}px`);
    calculateVisibleVideos();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas(); 

  // Функция анимации
  function animate(time) {
    const deltaTime = (time - lastTime) / 1000;
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
      const nextWidth = Math.round(canvas.height * (nextVideo.videoWidth / nextVideo.videoHeight));
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

});
