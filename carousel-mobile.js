// carousel.js

document.addEventListener('DOMContentLoaded', function() {
  // Количество видеофайлов: "Timeline 1.mp4" до "Timeline N.mp4"
  const VIDEO_COUNT = 7; // Измените на нужное количество, например, 10
  // Скорость движения в пикселях в секунду
  const SPEED_PX_PER_SEC = 60;

  const container = document.getElementById('mobile-timeline');
  const track = document.getElementById('carousel-track');

  // Создаём и добавляем видеоэлементы
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const videoEl = document.createElement('video');
    videoEl.src = `assets/video/Timeline ${i}.mp4`;
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true; // Для мобильных устройств
    track.appendChild(videoEl);
  }

  // Ждём, пока все видео загрузятся, чтобы корректно измерить ширину
  const videos = track.querySelectorAll('video');
  let videosLoaded = 0;

  videos.forEach(video => {
    if (video.complete) {
      videosLoaded++;
      if (videosLoaded === VIDEO_COUNT) {
        initializeCarousel();
      }
    } else {
      video.addEventListener('loadeddata', () => {
        videosLoaded++;
        if (videosLoaded === VIDEO_COUNT) {
          initializeCarousel();
        }
      });
    }
  });

  function initializeCarousel() {
    // Получаем ширину первого видео (должно быть 100vw)
    const firstVideo = track.firstElementChild;
    const videoWidth = firstVideo.offsetWidth;

    let shift = 0;
    let lastTime = performance.now();

    function animate(time) {
      const dt = (time - lastTime) / 1000; // Время с последнего кадра в секундах
      lastTime = time;

      shift += SPEED_PX_PER_SEC * dt;

      // Если первое видео полностью вышло за левый край
      if (shift >= videoWidth) {
        shift -= videoWidth;
        const firstVideo = track.firstElementChild;
        track.appendChild(firstVideo);
      }

      track.style.transform = `translateX(-${shift}px)`;
      requestAnimationFrame(animate);
    }

    // Устанавливаем начальное положение без сдвига
    shift = 0;
    track.style.transform = 'translateX(0)';
    
    requestAnimationFrame(animate);
  }

  // Обработка изменения размера окна (ресайз)
  window.addEventListener('resize', () => {
    // Перезапускаем карусель при изменении размера
    // Для этого можно обновить позицию или перезапустить анимацию
    // В данном примере проще перезагрузить страницу
    // Альтернативно, можно сохранить текущее положение и пересчитать shift
    // Здесь реализуем простую перезагрузку
    location.reload();
  });
});
