function calculateVisibleVideos() {
  // Очистка текущего каруселя
  carousel = [];
  totalWidth = 0;

  // Рассчитываем ширину каждого видео на основе высоты Canvas
  const videoHeights = canvas.height; // Высота для всех видео — равна высоте Canvas
  const videoWidths = videos.map(video => {
    const aspectRatio = video.videoWidth / video.videoHeight; // Соотношение сторон
    return videoHeights * aspectRatio; // Ширина = высота * соотношение сторон
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
    const nextWidth = canvas.height * (nextVideo.videoWidth / nextVideo.videoHeight); // Учитываем соотношение сторон
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
        ctx.drawImage(obj.video, obj.x, 0, obj.width, canvas.height); // Учитываем пропорции
      } else {
        console.log(`Видео ${obj.video.src} не готово к отрисовке.`);
      }
    }
  });

  // Запрашиваем следующий кадр
  requestAnimationFrame(animate);
}
