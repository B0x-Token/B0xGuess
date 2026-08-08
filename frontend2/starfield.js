// starfield.js
// Purely decorative animated background: twinkling stars plus the
// occasional shooting star. Self-contained canvas — no dependencies on
// ethers or the rest of app.js, so it can start rendering immediately,
// before a wallet is even connected.

(function () {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STAR_DENSITY = 0.00014; // stars per CSS pixel of viewport area
  const STAR_HUES = [190, 265, 320]; // cyan, violet, magenta — matches the site accent palette

  let width = 0;
  let height = 0;
  let stars = [];
  let shootingStars = [];
  let lastShotAt = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedStars();
  }

  function seedStars() {
    const count = Math.round(width * height * STAR_DENSITY);
    stars = new Array(count).fill(0).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.3 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.0016 + 0.0006,
      hue: STAR_HUES[(Math.random() * STAR_HUES.length) | 0],
    }));
  }

  function spawnShootingStar() {
    shootingStars.push({
      x: Math.random() * width * 0.5,
      y: Math.random() * height * 0.4,
      len: Math.random() * 120 + 80,
      speed: Math.random() * 6 + 8,
      angle: (Math.PI / 180) * (25 + Math.random() * 15),
      life: 1,
    });
  }

  function drawStars(t) {
    for (const s of stars) {
      const twinkle = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
      ctx.beginPath();
      ctx.fillStyle = `hsla(${s.hue}, 90%, 85%, ${twinkle})`;
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawShootingStars(t) {
    if (t - lastShotAt > 3500 + Math.random() * 4500) {
      lastShotAt = t;
      spawnShootingStar();
    }

    shootingStars = shootingStars.filter((s) => s.life > 0);
    for (const s of shootingStars) {
      s.x += Math.cos(s.angle) * s.speed;
      s.y += Math.sin(s.angle) * s.speed;
      s.life -= 0.012;

      const tailX = s.x - Math.cos(s.angle) * s.len;
      const tailY = s.y - Math.sin(s.angle) * s.len;
      const grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
      grad.addColorStop(0, `rgba(200, 230, 255, ${s.life})`);
      grad.addColorStop(1, "rgba(200, 230, 255, 0)");

      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }
  }

  function frame(t) {
    ctx.clearRect(0, 0, width, height);
    drawStars(t);
    if (!reduceMotion) {
      drawShootingStars(t);
      requestAnimationFrame(frame);
    }
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
})();
