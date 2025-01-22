document.addEventListener('DOMContentLoaded', function() {
  // Количество видеофайлов
  const VIDEO_COUNT = 7; // Измените на нужное количество, например, 10
  // Скорость движения в секундах на один набор (например, 700s для 100px/s, где 700 = (100vw * VIDEO_COUNT) / SPEED_PX_PER_SEC)
  const ANIMATION_DURATION = 700; // в секундах

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
  track.appendChild(createVideos(VIDEO_COUNT));
  // Дублируем видео для бесконечной прокрутки
  track.appendChild(createVideos(VIDEO_COUNT));

  // Устанавливаем анимацию с учётом VIDEO_COUNT
  track.style.animation = `scroll-left ${ANIMATION_DURATION}s linear infinite`;

  // Обновляем ключевые кадры с учётом VIDEO_COUNT
  const styleSheet = document.styleSheets[0];
  const keyframes = `
    @keyframes scroll-left {
      0% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(-${100 * VIDEO_COUNT}vw);
      }
    }
  `;
  styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
});
