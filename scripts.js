
  // Количество файлов, которые вы подготовили: "Timeline 1.mp4", "Timeline 2.mp4" и т.д.
  const VIDEO_COUNT = 7;

  // Скорость движения в пикселях/сек
  const SPEED_PX_PER_SEC = 60;

  const container = document.getElementById('mobile-timeline');
  const track = document.getElementById('carousel-track');
  const containerWidth = container.offsetWidth; 

  // Создаём видео-элементы из папки assets/video/
  for (let i = 1; i <= VIDEO_COUNT; i++) {
    const videoEl = document.createElement('video');
    videoEl.src = `assets/video/Timeline ${i}.mp4`;
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.loop = true;
    track.appendChild(videoEl);
  }

  // Сдвиг трека влево (в пикселях)
  let shift = 0;
  let lastTime = performance.now();

  function animate(time) {
    const dt = (time - lastTime) / 1000; // время с последнего кадра в секундах
    lastTime = time;

    // Прибавляем скорость * dt
    shift += SPEED_PX_PER_SEC * dt;

    // Если первый видео-блок полностью ушёл влево
    if (shift >= containerWidth) {
      // Уменьшаем shift на ширину контейнера
      shift -= containerWidth;
      // Переставляем первое видео в конец
      const firstVideo = track.firstElementChild;
      track.appendChild(firstVideo);
    }

    // Применяем трансформацию
    track.style.transform = `translateX(-${shift}px)`;

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
