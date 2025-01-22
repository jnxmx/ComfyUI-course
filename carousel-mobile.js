// carousel.js

document.addEventListener('DOMContentLoaded', function() {
  // Количество видеофайлов
  const VIDEO_COUNT = 7; // Измените на нужное количество, например, 10
  // Скорость движения в пикселях в секунду
  const SPEED_PX_PER_SEC = 60;

  const container = document.getElementById('mobile-timeline');
  const track = document.getElementById('carousel-track');

  // Функция для создания видеоэлементов
  function createVideos(count) {
    const fragment = document.createDocumentFragment();
    for (let i = 1; i <= count; i++) {
      const videoEl = document.createElement('video');
      videoEl.src = `assets/video/Timeline ${i}.mp4`;
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.loop = true;
      videoEl.playsInline = true; // Для мобильных устройств
      videoEl.preload = 'auto'; // Предзагрузка видео
      videoEl.onerror = () => {
        console.error(`Не удалось загрузить видео: Timeline ${i}.mp4`);
      };
      fragment.appendChild(videoEl);
    }
    return fragment;
  }

  // Создаём первый набор видео
  const firstSet = createVideos(VIDEO_COUNT);
  track.appendChild(firstSet);
  // Дублируем видео для бесконечной прокрутки
  const secondSet = createVideos(VIDEO_COUNT);
  track.appendChild(secondSet);

  // Ждём, пока все видео загрузятся, чтобы корректно измерить ширину
  const videos = track.querySelectorAll('video');
  let videosLoaded = 0;

  videos.forEach(video => {
    if (video.readyState >= 3) { // HAVE_FUTURE_DATA
      videosLoaded++;
      if (videosLoaded === VIDEO_COUNT * 2) { // Два набора
        initializeCarousel();
      }
    } else {
      video.addEventListener('loadeddata', () => {
        videosLoaded++;
        if (videosLoaded === VIDEO_COUNT * 2) {
          initializeCarousel();
        }
      });
    }
  });

  function initializeCarousel() {
    // Получаем общую ширину одного набора видео
    let totalWidth = 0;
    for (let i = 0; i < VIDEO_COUNT; i++) {
      totalWidth += track.children[i].offsetWidth;
    }

    // Настраиваем анимацию через CSS
    track.style.animation = `scroll-left ${totalWidth / SPEED_PX_PER_SEC}s linear infinite`;

    // Добавляем ключевые кадры для анимации
    const styleSheet = document.styleSheets[0];
    const keyframes = `
      @keyframes scroll-left {
        0% {
          transform: translateX(0);
        }
        100% {
          transform: translateX(-${totalWidth}px);
        }
      }
    `;
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
  }

  // Обработка изменения размера окна (ресайз)
  window.addEventListener('resize', () => {
    // Перезапускаем анимацию при изменении размера
    // Для этого лучше всего перезагрузить страницу
    // Альтернативно, можно динамически обновить анимацию
    location.reload();
  });
});
