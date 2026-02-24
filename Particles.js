/**
 * particles.js
 * Grafo de rede animado com parallax scroll
 * Partículas conectadas por linhas, reagindo ao scroll
 */

(function () {
  'use strict';

  /* ─── CONFIG ─── */
  const CFG = {
    count: 55,            // número de partículas
    maxDist: 160,         // distância máxima para desenhar ligação
    baseSpeed: 0.18,      // velocidade de drift autónomo
    scrollFactor: 0.06,   // intensidade do parallax (por camada)
    layers: 3,            // número de camadas de profundidade
    sizeMin: 1.5,
    sizeMax: 3.5,
    opacityNode: 0.55,
    opacityLine: 0.18,
    color: null,          // calculado dinamicamente pelo tema
  };

  /* ─── STATE ─── */
  let canvas, ctx, W, H;
  let particles = [];
  let scrollY = 0;
  let raf;
  let resizeTimer;

  /* ─── THEME COLOR ─── */
  function getAccent() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'light' ? '0,119,204' : '0,212,255';
  }

  /* ─── PARTICLE CLASS ─── */
  function Particle() {
    this.reset(true);
  }

  Particle.prototype.reset = function (init) {
    this.x  = Math.random() * W;
    this.y  = init ? Math.random() * H : (Math.random() > 0.5 ? -10 : H + 10);
    this.layer = Math.floor(Math.random() * CFG.layers) + 1; // 1..layers
    this.vx = (Math.random() - 0.5) * CFG.baseSpeed * this.layer;
    this.vy = (Math.random() - 0.5) * CFG.baseSpeed * this.layer;
    this.size = CFG.sizeMin + Math.random() * (CFG.sizeMax - CFG.sizeMin) * (this.layer / CFG.layers);
    this.opacity = (0.3 + (this.layer / CFG.layers) * 0.7) * CFG.opacityNode;
    /* parallax offset accumulated */
    this.parallaxY = 0;
  };

  /* ─── BUILD PARTICLES ─── */
  function build() {
    particles = [];
    for (let i = 0; i < CFG.count; i++) {
      particles.push(new Particle());
    }
  }

  /* ─── DRAW ─── */
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const accent = getAccent();

    /* draw connections first */
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      const ay = a.y + a.parallaxY;
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const by = b.y + b.parallaxY;
        const dx = a.x - b.x;
        const dy = ay - by;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CFG.maxDist) {
          const alpha = (1 - dist / CFG.maxDist) * CFG.opacityLine;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${accent},${alpha.toFixed(3)})`;
          ctx.lineWidth = 0.6;
          ctx.moveTo(a.x, ay);
          ctx.lineTo(b.x, by);
          ctx.stroke();
        }
      }
    }

    /* draw nodes */
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const py = p.y + p.parallaxY;
      ctx.beginPath();
      ctx.arc(p.x, py, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accent},${p.opacity.toFixed(3)})`;
      ctx.fill();
    }
  }

  /* ─── UPDATE ─── */
  function update() {
    const parallaxBase = scrollY * CFG.scrollFactor;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      /* drift */
      p.x += p.vx;
      p.y += p.vy;

      /* parallax: each layer moves at different speed relative to scroll */
      p.parallaxY = -parallaxBase * (p.layer / CFG.layers);

      /* wrap horizontally */
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;

      /* wrap vertically (without parallax offset) */
      if (p.y < -20) p.y = H + 20;
      if (p.y > H + 20) p.y = -20;
    }
  }

  /* ─── LOOP ─── */
  function loop() {
    update();
    draw();
    raf = requestAnimationFrame(loop);
  }

  /* ─── RESIZE ─── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    build();
  }

  /* ─── SCROLL ─── */
  function onScroll() {
    scrollY = window.scrollY;
  }

  /* ─── INIT ─── */
  function init() {
    canvas = document.createElement('canvas');
    canvas.id = 'particle-canvas';
    canvas.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:0',
    ].join(';');

    document.body.insertBefore(canvas, document.body.firstChild);
    ctx = canvas.getContext('2d');

    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;

    build();
    loop();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });
  }

  /* ─── BOOT ─── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();