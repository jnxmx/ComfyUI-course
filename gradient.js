document.addEventListener('DOMContentLoaded', function() {
    const DURATION_MS = 5000; 

    const topStart     = [12, 78, 185];  // #d97725 217, 119, 37
    const topEnd       = [216, 206, 201];   // #0c4eb9
    const bottomEnd  = [12, 78, 185];   // #0c4eb9
    const bottomStart    = [216, 206, 201];  // #d97725
    
    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function interpolateColor(colorA, colorB, t) {
      return [
        Math.round(lerp(colorA[0], colorB[0], t)),
        Math.round(lerp(colorA[1], colorB[1], t)),
        Math.round(lerp(colorA[2], colorB[2], t))
      ];
    }

    function rgbToString(rgbArr) {
      return `rgb(${rgbArr[0]}, ${rgbArr[1]}, ${rgbArr[2]})`;
    }

    function pingPong(frac) {
      if (frac < 0.5) {
        return frac * 2;       // 0..1
      } else {
        return 1 - (frac - 0.5) * 2; // 1..0
      }
    }

    function animateGradient() {
      const now = Date.now();
      const tCycle = (now % DURATION_MS) / DURATION_MS;
      const t = pingPong(tCycle);

      const topColorArr    = interpolateColor(topStart, topEnd, t);
      const bottomColorArr = interpolateColor(bottomStart, bottomEnd, t);

      const topColor    = rgbToString(topColorArr);
      const bottomColor = rgbToString(bottomColorArr);

      const gradientStr = `linear-gradient(
        to bottom,
        ${topColor} 0%,
        #d8cec9 9%,
        #d8cec9 100%
      )`;

      document.getElementById('bg').style.background = gradientStr;
    }
      requestAnimationFrame(animateGradient);
    }
