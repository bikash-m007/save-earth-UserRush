import { useEffect, useRef } from "react";
import { GAME_ID, BACKEND_URL } from "../constants";

export default function Game() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const audioRef = useRef(null);
  const levelUpRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext("2d");
    const bgMusic = audioRef.current;
    const levelUpAudio = levelUpRef.current;

    if (bgMusic) {
      bgMusic.volume = 0.5;
      bgMusic.loop = true;
    }
    if (levelUpAudio) {
      levelUpAudio.volume = 0.8;
    }

    let musicEnabled = true;

    const tryPlayMusic = () => {
      if (musicEnabled && bgMusic && bgMusic.paused) {
        bgMusic.play().catch(() => { });
      }
    };
    window.addEventListener("click", tryPlayMusic, { once: true });
    window.addEventListener("touchstart", tryPlayMusic, { once: true });

    let W, H;
    function resize() {
      const r = wrap.getBoundingClientRect();
      W = canvas.width = r.width;
      H = canvas.height = r.height;
    }
    resize();
    window.addEventListener("resize", resize);

    // Difficulty
    let difficulty = "easy";
    const DIFF_SETTINGS = {
      easy: { boltSpeed: 650, reload: 0.15, boltR: 5, orbMult: 0.8 },
      medium: { boltSpeed: 580, reload: 0.25, boltR: 4.5, orbMult: 0.9 },
      hard: { boltSpeed: 520, reload: 0.28, boltR: 4, orbMult: 1.0 },
    };
    let BOLT_SPEED = DIFF_SETTINGS.medium.boltSpeed;
    let RELOAD_TIME = DIFF_SETTINGS.medium.reload;
    let BOLT_R = DIFF_SETTINGS.medium.boltR;
    let reloadTimer = 0;

    // Game state
    let state = "idle";
    let score = 0, lives = 3, combo = 0, comboTimer = 0;
    let totalHits = 0, bestCombo = 0;
    const getHighScore = (diff) => parseInt(localStorage.getItem(`highScore_${GAME_ID}_${diff}`) || "0");
    let highScore = getHighScore(difficulty);
    let level = 1, levelKills = 0;
    let shields = 3;
    let orbs = [], bolts = [], particles = [], powerups = [];
    let danger = null;
    let turretAngle = -Math.PI / 2;
    let timeDilated = false, dilateTimer = 0;
    let shakeTimer = 0, shakeIntensity = 0;

    // Parallax stars layer
    const stars = Array.from({ length: 30 }, () => ({
      x: Math.random() * 800,
      y: Math.random() * 800,
      z: Math.random() * 1.5 + 1
    }));
    let orbSpawnTimer = 0;
    let mouseX = 200, mouseY = 200;
    let raf;

    const TURRET_R = 20, ORB_R = 13, DANGER_R = 34, POWERUP_R = 10;

    function orbSpeed() { return (50 + level * 7) * DIFF_SETTINGS[difficulty].orbMult; }
    function getSpawnInterval() { return Math.max(0.55, (2.8 - level * 0.18) / DIFF_SETTINGS[difficulty].orbMult); }
    function getTurretPos() { return { x: W / 2, y: H - 60 }; }

    // Audio
    let audioCtx;

    function toggleMusic() {
      musicEnabled = !musicEnabled;
      if (musicEnabled) {
        if (state === "playing") bgMusic.play().catch(() => { });
      } else {
        bgMusic.pause();
      }
      const mBtn = document.getElementById("musicToggleBtn");
      if (mBtn) mBtn.textContent = musicEnabled ? "🔊" : "🔇";
    }
    function getAudio() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx;
    }
    function beep(freq, dur, type = "sine", vol = 0.15) {
      try {
        const ac = getAudio();
        const o = ac.createOscillator(), g = ac.createGain();
        o.connect(g); g.connect(ac.destination);
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
        o.start(); o.stop(ac.currentTime + dur);
      } catch (e) { }
    }
    function playHit() {
      // Better Thriller Intercept: Sharp square punch + Metallic snap
      // Pitch increases slightly with combo for a satisfying'progression' feel
      const p = Math.min(combo * 35, 350);
      beep(130 + p, 0.2, "square", 0.2);
      setTimeout(() => beep(2100 + p, 0.07, "sawtooth", 0.15), 15);
      if (navigator.vibrate) navigator.vibrate(25);
    }
    function playMiss() { beep(180, 0.22, "sawtooth", 0.12); if (navigator.vibrate) navigator.vibrate(10); }
    function playDanger() { beep(90, 0.4, "sawtooth", 0.2); beep(70, 0.5, "square", 0.14); if (navigator.vibrate) navigator.vibrate([100, 50, 100]); }
    function playPowerup() { beep(520, 0.08, "sine", 0.12); setTimeout(() => beep(780, 0.08, "sine", 0.12), 80); setTimeout(() => beep(1040, 0.12, "sine", 0.12), 160); if (navigator.vibrate) navigator.vibrate(35); }
    function playFire() { beep(380, 0.06, "square", 0.08); }
    function playWave() {
      console.log("LEVEL UP SOUND TRIGGERED");
      const notes = [440, 554, 659, 880, 1108, 1318];
      notes.forEach((f, i) => {
        setTimeout(() => beep(f, 0.4, "sine", 0.2), i * 100);
      });
      if (navigator.vibrate) navigator.vibrate([50, 50, 100, 100]);
    }

    // Particles
    function spawnParticles(x, y, color, n = 18, speed = 120) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.5 + Math.random()) * speed;
        particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color, r: 1.5 + Math.random() * 2.5 });
      }
    }
    function spawnRing(x, y, color) {
      particles.push({ x, y, ring: true, r: 0, life: 1, color });
    }

    // Float score popups
    function spawnFloat(x, y, text, color = "#ffab00") {
      const el = document.createElement("div");
      el.className = "float-score";
      el.style.left = (x / W * 100) + "%";
      el.style.top = (y / H * 100) + "%";
      el.style.color = color;
      el.textContent = text;
      wrap.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }

    // Intercept prediction
    function computeIntercept(ox, oy, ovx, ovy, tx, ty, bspeed) {
      for (let t = 0.05; t < 5; t += 0.04) {
        const fx = ox + ovx * t, fy = oy + ovy * t;
        if (Math.abs(Math.hypot(fx - tx, fy - ty) - bspeed * t) < bspeed * 0.06) return { x: fx, y: fy, t };
      }
      return null;
    }

    // UI helpers
    const scoreEl = document.getElementById("scoreEl");
    const levelEl = document.getElementById("levelEl");
    const comboEl = document.getElementById("comboEl");
    const livesEl = document.getElementById("livesEl");
    const msgBar = document.getElementById("msg-bar");
    const comboBar = document.getElementById("combo-bar");

    function setMsg(t) { if (msgBar) msgBar.textContent = t; }
    function updateShieldUI() {
      for (let i = 0; i < 3; i++) {
        const pip = document.getElementById("pip" + i);
        if (pip) pip.className = "shield-pip" + (i < shields ? " active" : "");
      }
    }

    function spawnPowerup() {
      if (Math.random() > 0.35) return;
      powerups.push({ x: 40 + Math.random() * (W - 80), y: 80 + Math.random() * (H - 200), r: POWERUP_R, life: 1, pulse: 0, type: Math.random() < 0.6 ? "shield" : "score" });
    }

    function initDanger() {
      danger = { x: W / 2, y: H / 2, r: DANGER_R, pulse: 0, continents: [] };
      for (let i = 0; i < 4; i++) {
        let pts = [];
        let cx = (Math.random() - 0.5) * DANGER_R * 0.8;
        let cy = (Math.random() - 0.5) * DANGER_R * 0.8;
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
          let rr = 4 + Math.random() * 8;
          pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
        }
        danger.continents.push(pts);
      }
    }

    function spawnOrb() {
      if (state !== "playing") return;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.max(W, H) * 0.6 + 50;
      const sx = W / 2 + Math.cos(angle) * radius;
      const sy = H / 2 + Math.sin(angle) * radius;
      const dx = danger.x - sx, dy = danger.y - sy;
      const dist = Math.hypot(dx, dy);
      const spd = orbSpeed() + (Math.random() - 0.5) * 15;

      let type = "normal";
      if (level >= 2 && Math.random() < 0.25) type = "fast";
      if (level >= 3 && Math.random() < 0.20 && type === "normal") type = "zigzag";
      if (level >= 4 && Math.random() < 0.15 && type === "normal") type = "ghost";

      const orb = {
        x: sx, y: sy,
        vx: (dx / dist) * spd,
        vy: (dy / dist) * spd,
        r: type === "fast" ? ORB_R * 0.8 : ORB_R,
        alive: true, trail: [],
        type,
        phase: Math.random() * Math.PI * 2,
        baseSpd: spd
      };

      if (type === "fast") { orb.vx *= 1.55; orb.vy *= 1.55; }
      orbs.push(orb);
    }

    function spawnPowerup(x, y, type = "life") {
      powerups.push({
        x, y, type,
        vx: (W / 2 - x) * 0.01,
        vy: (H / 2 - y) * 0.01,
        r: POWERUP_R,
        alive: true,
        phase: 0
      });
    }

    function fireBolt(tx, ty) {
      if (reloadTimer > 0) return;
      const tp = getTurretPos();
      const dx = tx - tp.x, dy = ty - tp.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 5) return;
      bolts.push({ x: tp.x, y: tp.y, vx: (dx / dist) * BOLT_SPEED, vy: (dy / dist) * BOLT_SPEED, trail: [], alive: true });
      playFire();
      reloadTimer = RELOAD_TIME;
    }

    function useShield() {
      if (shields <= 0 || state !== "playing") return;
      shields--;
      updateShieldUI();
      if (orbs.length === 0) return;
      let best = null, bestD = Infinity;
      orbs.forEach(o => {
        if (!o.alive) return;
        const d = Math.hypot(o.x - danger.x, o.y - danger.y);
        if (d < bestD) { bestD = d; best = o; }
      });
      if (best) {
        spawnParticles(best.x, best.y, "#00e5ff", 22, 150);
        spawnRing(best.x, best.y, "#00e5ff");
        best.alive = false;
        beep(660, 0.2, "sine", 0.15);
        setMsg("SHIELD ACTIVATED");
        spawnFloat(best.x, best.y - 20, "SHIELDED", "#00e5ff");
        shakeTimer = 0.3; shakeIntensity = 8;
      }
    }

    const LEVEL_TARGETS = [5, 8, 12, 16, 20, 25, 30, 36, 42, 50];
    const LEVEL_PTS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

    function checkLevelUp() {
      const maxLvl = 10;
      if (level > maxLvl) return;
      // Update Level Progress Bar
      const targetKills = LEVEL_TARGET_COUNT();
      const progPct = Math.min((levelKills / targetKills) * 100, 100);
      const lpBar = document.getElementById("lvl-prog-bar");
      if (lpBar) lpBar.style.width = progPct + "%";

      if (levelKills < targetKills) return;

      if (level === maxLvl) {
        state = "win";
        const ws = document.getElementById("winScoreEl");
        if (ws) ws.textContent = score;
        const wo = document.getElementById("winOverlay");
        if (wo) wo.classList.remove("hidden");
        beep(500, 0.2, "sine", 0.2);
        setTimeout(() => beep(700, 0.2, "sine", 0.2), 200);
        setTimeout(() => beep(900, 0.4, "sine", 0.2), 400);
        bgMusic.pause();
        return;
      }
      level++;
      levelKills = 0;
      if (lpBar) lpBar.style.width = "0%";
      state = "levelup";
      lives = 3;
      if (livesEl) livesEl.textContent = lives;
      if (levelEl) levelEl.textContent = level;
      updateShieldUI();

      const lo = document.getElementById("levelOverlay");
      if (lo) {
        lo.classList.remove("hidden");
        const lt = document.getElementById("levelTitle");
        if (lt) lt.textContent = "LEVEL " + level;
      }
      playWave();
    }
    function LEVEL_TARGET_COUNT() { return LEVEL_TARGETS[level - 1] || 60; }

    function startGame(diff = "medium") {
      try { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { }); } catch (e) { }
      difficulty = diff;
      const s = DIFF_SETTINGS[diff];
      BOLT_SPEED = s.boltSpeed; RELOAD_TIME = s.reload; BOLT_R = s.boltR; reloadTimer = 0;
      score = 0; lives = 3; level = 1; levelKills = 0; combo = 0; comboTimer = 0;
      totalHits = 0; bestCombo = 0; shields = 3;
      orbs = []; bolts = []; particles = []; powerups = [];
      state = "playing";
      const lpBar = document.getElementById("lvl-prog-bar");
      if (lpBar) lpBar.style.width = "0%";
      if (scoreEl) scoreEl.textContent = "0";
      if (levelEl) levelEl.textContent = "1";
      if (livesEl) livesEl.textContent = "3";
      if (comboEl) comboEl.textContent = "0";
      if (comboBar) comboBar.style.width = "0%";
      updateShieldUI();
      ["startOverlay", "gameoverOverlay", "winOverlay"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });
      initDanger();
      orbSpawnTimer = getSpawnInterval();
      spawnPowerup();
      playWave();
      setMsg("AIM — MISSION: " + diff.toUpperCase());
      if (bgMusic) {
        bgMusic.currentTime = 0;
        if (musicEnabled) {
          bgMusic.play().catch(e => console.warn("Music play blocked initially:", e));
        }
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
      else { last = performance.now(); }
    }

    async function saveHighScore(mode, val, lvl) {
      if (val > getHighScore(mode)) {
        localStorage.setItem(`highScore_${GAME_ID}_${mode}`, val);
      }

      const idToken = localStorage.getItem("idToken");
      if (!idToken) return;

      try {
        await fetch(BACKEND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            gameId: GAME_ID,
            score: val,
            difficulty: mode,
            level: lvl
          })
        });
      } catch (err) {
        console.error("Score submission failed:", err);
      }
    }

    function endGame() {
      state = "gameover";
      saveHighScore(difficulty, score, level);
      const currentModeHS = getHighScore(difficulty);
      if (score > currentModeHS) {
        localStorage.setItem(`highScore_${GAME_ID}_${difficulty}`, score);
        highScore = score;
      }
      const fs = document.getElementById("finalScore"); if (fs) fs.textContent = score;
      const fw = document.getElementById("finalWave"); if (fw) fw.textContent = level;
      const fh = document.getElementById("finalHits"); if (fh) fh.textContent = totalHits;
      const fc = document.getElementById("finalCombo"); if (fc) fc.textContent = bestCombo;
      const fhi = document.getElementById("finalHigh"); if (fhi) fhi.textContent = highScore;
      const go = document.getElementById("gameoverOverlay"); if (go) go.classList.remove("hidden");
      playDanger();
      bgMusic.pause();
    }

    let last = 0;
    function loop(ts) {
      if (state === "gameover" || state === "win" || state === "levelup") {
        draw();
        raf = requestAnimationFrame(loop);
        return;
      }
      const rawDt = Math.min((ts - last) / 1000, 0.05); last = ts;
      const dt = timeDilated ? rawDt * 0.2 : rawDt;
      update(dt, rawDt);
      draw(dt);
      raf = requestAnimationFrame(loop);
    }

    function update(dt, rawDt) {
      if (state !== "playing") return;

      orbSpawnTimer -= rawDt;
      if (orbSpawnTimer <= 0) { spawnOrb(); orbSpawnTimer = getSpawnInterval(); }

      if (comboTimer > 0) {
        comboTimer -= rawDt;
        if (comboBar) comboBar.style.width = Math.max(0, comboTimer / 3 * 100).toFixed(1) + "%";
        if (comboTimer <= 0) { combo = 0; if (comboEl) comboEl.textContent = "0"; if (comboBar) comboBar.style.width = "0%"; }
      }

      if (dilateTimer > 0) {
        dilateTimer -= rawDt;
        if (dilateTimer <= 0) {
          timeDilated = false;
          const dr = document.getElementById("dilation-ring");
          if (dr) dr.classList.remove("active");
        }
      }
      if (reloadTimer > 0) reloadTimer -= rawDt;

      orbs.forEach(o => {
        if (!o.alive) return;
        o.trail.push({ x: o.x, y: o.y });
        if (o.trail.length > 18) o.trail.shift();

        if (o.type === "zigzag") {
          o.phase += dt * 8;
          const perpX = -o.vy / o.baseSpd;
          const perpY = o.vx / o.baseSpd;
          const off = Math.sin(o.phase) * 2.5;
          o.x += o.vx * dt + perpX * off;
          o.y += o.vy * dt + perpY * off;
        } else {
          o.x += o.vx * dt; o.y += o.vy * dt;
        }

        if (o.type === "ghost") {
          o.phase += dt * 4;
        }

        if (Math.hypot(o.x - danger.x, o.y - danger.y) < o.r + danger.r - 4) {
          o.alive = false;
          spawnParticles(o.x, o.y, "#ff1744", 24, 160);
          spawnRing(danger.x, danger.y, "#ff1744");
          lives--;
          if (livesEl) livesEl.textContent = lives;
          combo = 0; if (comboEl) comboEl.textContent = "0"; comboTimer = 0; if (comboBar) comboBar.style.width = "0%";
          setMsg("ORB HIT DANGER ZONE!");
          playDanger();
          shakeTimer = 0.4; shakeIntensity = 15;
          if (lives <= 0) { setTimeout(endGame, 600); state = "dying"; }
        }
      });

      // Critical Slomo: trigger if 1 life left and orb is dangerously close
      if (lives === 1 && state === "playing") {
        const criticalDist = danger.r + 75;
        const veryClose = orbs.find(o => o.alive && Math.hypot(o.x - danger.x, o.y - danger.y) < criticalDist);
        if (veryClose && !timeDilated) {
          timeDilated = true;
          dilateTimer = 0.85;
          const dr = document.getElementById("dilation-ring");
          if (dr) dr.classList.add("active");
          setMsg("CRITICAL SLOMO: SAVE EARTH!");
        }
      }

      bolts.forEach(b => {
        if (!b.alive) return;
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 20) b.trail.shift();
        b.x += b.vx * dt; b.y += b.vy * dt;
        orbs.forEach(o => {
          if (!o.alive || !b.alive) return;
          if (Math.hypot(b.x - o.x, b.y - o.y) < BOLT_R + o.r) {
            o.alive = false; b.alive = false;
            spawnParticles(o.x, o.y, "#bf00ff", 20, 140);
            spawnParticles(b.x, b.y, "#00e5ff", 10, 100);
            spawnRing(o.x, o.y, "#bf00ff");
            combo = Math.min(combo + 1, 20); comboTimer = 3;
            if (comboEl) comboEl.textContent = combo;
            if (combo > bestCombo) bestCombo = combo;
            const LEVEL_PTS = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
            let basePts = (LEVEL_PTS[level - 1] || 120);
            if (o.type === "fast") basePts += 30;
            if (o.type === "zigzag") basePts += 50;
            if (o.type === "ghost") basePts += 80;

            const pts = basePts * Math.max(1, combo);
            score += pts; totalHits++; levelKills++;
            if (scoreEl) scoreEl.textContent = score;
            setMsg("INTERCEPT! +" + pts + (combo > 1 ? " COMBO x" + combo : ""));
            spawnFloat(o.x, o.y - 24, "+" + pts, combo > 2 ? "#ff1744" : combo > 1 ? "#ffab00" : "#00e676");
            playHit();
            checkLevelUp();
          }
        });
        if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) { b.alive = false; playMiss(); setMsg("MISSED — FIRE AGAIN"); }
      });

      bolts = bolts.filter(b => b.alive);
      orbs = orbs.filter(o => o.alive || o.trail.length > 0);

      powerups.forEach(p => {
        p.pulse += dt * 3; p.life -= dt * 0.07;
        if (p.life <= 0) return;
        bolts.forEach(b => {
          if (!b.alive) return;
          if (Math.hypot(b.x - p.x, b.y - p.y) < BOLT_R + p.r + 4) {
            b.alive = false; p.life = 0;
            if (p.type === "shield") { shields = Math.min(shields + 1, 3); updateShieldUI(); setMsg("SHIELD RECHARGED!"); }
            else { const bp = 50 * level; score += bp; if (scoreEl) scoreEl.textContent = score; setMsg("POWER-UP! +" + bp); checkLevelUp(); }
            spawnParticles(p.x, p.y, "#ffab00", 16, 120);
            playPowerup();
            spawnFloat(p.x, p.y - 20, p.type === "shield" ? "SHIELD+" : "BONUS +" + (50 * level), "#ffab00");
          }
        });
      });
      powerups = powerups.filter(p => p.life > 0);

      const aliveOrb = orbs.find(o => o.alive);
      const ip = computeIntercept(
        aliveOrb?.x ?? mouseX, aliveOrb?.y ?? mouseY,
        aliveOrb?.vx ?? 0, aliveOrb?.vy ?? 0,
        getTurretPos().x, getTurretPos().y, BOLT_SPEED
      );
      if (ip) { const tp = getTurretPos(); turretAngle = Math.atan2(ip.y - tp.y, ip.x - tp.x); }

      particles.forEach(p => {
        if (p.ring) { p.r += dt * 200; p.life -= dt * 2.5; return; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.92; p.vy *= 0.92;
        p.life -= dt * 1.8;
      });
      particles = particles.filter(p => p.life > 0);
      danger.pulse += dt * 2.5;

      if (shakeTimer > 0) shakeTimer -= rawDt;
    }

    function draw(dt) {
      ctx.save();
      if (shakeTimer > 0) {
        const sx = (Math.random() - 0.5) * shakeIntensity;
        const sy = (Math.random() - 0.5) * shakeIntensity;
        ctx.translate(sx, sy);
      }
      ctx.clearRect(-20, -20, W + 40, H + 40);
      // BG
      ctx.fillStyle = "#020a14"; ctx.fillRect(-20, -20, W + 40, H + 40);

      // Parallax Stars
      stars.forEach(s => {
        s.y += dt * 10 / s.z;
        if (s.y > H) { s.y = -10; s.x = Math.random() * W; }
        const alpha = 0.2 + (1 / s.z) * 0.5;
        ctx.fillStyle = `rgba(0, 242, 255, ${alpha})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.5 / s.z, 0, Math.PI * 2); ctx.fill();
      });

      ctx.strokeStyle = "rgba(0,229,255,0.04)"; ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const bw = 24;
      ctx.strokeStyle = "rgba(0,229,255,0.25)"; ctx.lineWidth = 1.5;
      [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].forEach(([cx, cy, sx, sy]) => {
        ctx.beginPath(); ctx.moveTo(cx, cy + sy * bw); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * bw, cy); ctx.stroke();
      });

      if (state === "idle") { ctx.fillStyle = "rgba(0,229,255,0.06)"; ctx.fillRect(0, 0, W, H); return; }

      // Earth
      ctx.save();
      ctx.fillStyle = "#1e88e5";
      ctx.beginPath(); ctx.arc(danger.x, danger.y, danger.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#43a047";
      danger.continents.forEach(pts => {
        if (!pts.length) return;
        ctx.beginPath(); ctx.moveTo(danger.x + pts[0].x, danger.y + pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(danger.x + pts[i].x, danger.y + pts[i].y);
        ctx.fill();
      });
      const pulse = Math.sin(danger.pulse) * 0.3 + 0.7;
      ctx.strokeStyle = `rgba(67,160,71,${0.2 * pulse})`; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(danger.x, danger.y, danger.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ff1744";
      orbs.forEach(o => {
        if (!o.alive) return;
        const ang = Math.atan2(o.y - danger.y, o.x - danger.x);
        ctx.save(); ctx.translate(danger.x + Math.cos(ang) * (danger.r + 8), danger.y + Math.sin(ang) * (danger.r + 8));
        ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.fill();
        ctx.restore();
      });
      ctx.restore();

      // Powerups
      powerups.forEach(p => {
        const pu = Math.sin(p.pulse) * 0.3 + 0.7;
        ctx.save(); ctx.globalAlpha = p.life;
        ctx.strokeStyle = "#ffab00"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = `rgba(255,171,0,${0.2 * pu})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffab00"; ctx.font = "8px Share Tech Mono"; ctx.textAlign = "center";
        ctx.fillText(p.type === "shield" ? "SH" : "PT", p.x, p.y + 3);
        ctx.restore();
      });

      // Orbs
      orbs.forEach(o => {
        if (!o.alive && o.trail.length === 0) return;
        ctx.save();
        for (let i = 1; i < o.trail.length; i++) {
          const a = i / o.trail.length;
          let tCol = "191,0,255";
          if (o.type === "fast") tCol = "255,23,68";
          if (o.type === "zigzag") tCol = "0,230,118";
          ctx.strokeStyle = `rgba(${tCol},${a * 0.35})`; ctx.lineWidth = a * 5;
          ctx.beginPath(); ctx.moveTo(o.trail[i - 1].x, o.trail[i - 1].y); ctx.lineTo(o.trail[i].x, o.trail[i].y); ctx.stroke();
        }
        if (o.alive) {
          let col = "#bf00ff";
          if (o.type === "fast") col = "#ff1744";
          if (o.type === "zigzag") col = "#00e676";
          if (o.type === "ghost") {
            col = "#ffffff";
            ctx.globalAlpha = 0.2 + Math.abs(Math.sin(o.phase)) * 0.6;
          }

          ctx.save();
          ctx.translate(o.x, o.y);
          const angle = Math.atan2(o.vy, o.vx);
          ctx.rotate(angle);

          const w = o.r * 2.8, h = o.r * 0.8;
          ctx.shadowBlur = 10;
          ctx.shadowColor = col;

          // 1. ENGINE EXHAUST (Back Flicker)
          const flicker = Math.random() * 5;
          const grad = ctx.createLinearGradient(-w / 2 - 5 - flicker, 0, -w / 2, 0);
          grad.addColorStop(0, "transparent");
          grad.addColorStop(0.5, "rgba(255, 255, 255, 0.8)");
          grad.addColorStop(1, col);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(-w / 2, -h / 3);
          ctx.lineTo(-w / 2 - 10 - flicker, 0);
          ctx.lineTo(-w / 2, h / 3);
          ctx.fill();

          // 2. MISSILE FINS (Tail)
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(-w / 2, 0);
          ctx.lineTo(-w / 2 - 4, -h * 0.8); // Top fin
          ctx.lineTo(-w / 2 + 6, 0);
          ctx.lineTo(-w / 2 - 4, h * 0.8); // Bottom fin
          ctx.closePath();
          ctx.fill();

          // 3. MAIN BODY (Cylinder)
          ctx.fillStyle = "rgba(40, 44, 52, 0.9)";
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h / 2, w * 0.8, h, h / 4);
          ctx.stroke();
          ctx.fill();

          // 4. WARHEAD (Pointed Nose)
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(w / 2 - w * 0.2, -h / 2);
          ctx.quadraticCurveTo(w / 2 + 4, 0, w / 2 - w * 0.2, h / 2);
          ctx.closePath();
          ctx.fill();

          // 5. WINDOWS / TEXTURE
          ctx.fillStyle = "rgba(255,255,255,0.2)";
          ctx.fillRect(-w / 6, -h / 4, w / 8, h / 2);

          ctx.restore();
          ctx.globalAlpha = 1.0;
        }
        ctx.restore();
      });

      // Bolts
      bolts.forEach(b => {
        if (!b.alive) return;
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#00e5ff";
        ctx.fillStyle = "#00e5ff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, BOLT_R, 0, Math.PI * 2);
        ctx.fill();

        // Subtle trail for smoothness
        ctx.fillStyle = "rgba(0, 229, 255, 0.3)";
        ctx.beginPath();
        ctx.arc(b.x - b.vx * 0.01, b.y - b.vy * 0.01, BOLT_R * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Intercept line
      const ao = orbs.find(o => o.alive);
      if (ao) {
        const tp = getTurretPos();
        const ip = computeIntercept(ao.x, ao.y, ao.vx, ao.vy, tp.x, tp.y, BOLT_SPEED);
        if (ip && difficulty !== "hard") {
          ctx.save();
          ctx.strokeStyle = "rgba(0,230,118,0.5)"; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
          ctx.beginPath(); ctx.moveTo(tp.x, tp.y); ctx.lineTo(ip.x, ip.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = "#00e676"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(ip.x, ip.y, 10, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = "rgba(0,230,118,0.35)";
          ctx.beginPath(); ctx.arc(ip.x, ip.y, 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#00e676"; ctx.font = "8px Share Tech Mono"; ctx.textAlign = "center";
          ctx.fillText("INTERCEPT", ip.x, ip.y - 15);
          ctx.fillStyle = "rgba(0,230,118,0.6)";
          ctx.fillText("ETA " + ip.t.toFixed(1) + "s", ip.x, ip.y + 22);
          ctx.restore();
        }
      }

      // Turret
      const tp = getTurretPos();
      ctx.save(); ctx.translate(tp.x, tp.y);
      ctx.strokeStyle = "rgba(0,229,255,0.12)"; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(0, 0, TURRET_R + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 - Math.PI / 6;
        i === 0 ? ctx.moveTo(Math.cos(a) * (TURRET_R + 2), Math.sin(a) * (TURRET_R + 2)) : ctx.lineTo(Math.cos(a) * (TURRET_R + 2), Math.sin(a) * (TURRET_R + 2));
      }
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = "rgba(0,229,255,0.08)"; ctx.fill();
      ctx.fillStyle = "#00e5ff"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(turretAngle);
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(TURRET_R + 10, 0); ctx.stroke();
      ctx.fillStyle = "rgba(0,229,255,0.6)"; ctx.beginPath(); ctx.arc(TURRET_R + 10, 0, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // Particles
      particles.forEach(p => {
        if (p.ring) {
          ctx.save(); ctx.globalAlpha = p.life * 0.7;
          ctx.strokeStyle = p.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
          ctx.restore(); return;
        }
        ctx.save(); ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });

      if (timeDilated) {
        ctx.save();
        ctx.fillStyle = "rgba(0,50,100,0.06)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(0,229,255,0.55)"; ctx.font = "10px Share Tech Mono";
        ctx.textAlign = "center"; ctx.fillText("TIME DILATED", W / 2, 18);
        ctx.restore();
      }
      ctx.restore();
    }

    // Input
    canvas.addEventListener("click", e => {
      if (state !== "playing") return;
      const r = canvas.getBoundingClientRect();
      fireBolt((e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height));
    });
    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      mouseX = (e.clientX - r.left) * (W / r.width);
      mouseY = (e.clientY - r.top) * (H / r.height);
    });

    function canDilate() {
      let closest = Infinity;
      orbs.forEach(o => { if (!o.alive) return; const d = Math.hypot(o.x - danger.x, o.y - danger.y); if (d < closest) closest = d; });
      return closest < 230;
    }

    let holdTimer = null;
    canvas.addEventListener("mousedown", () => {
      if (state !== "playing") return;
      holdTimer = setTimeout(() => {
        if (!canDilate()) { setMsg("TARGET TOO FAR FOR SLOMO"); return; }
        timeDilated = true; dilateTimer = 2.8;
        const dr = document.getElementById("dilation-ring"); if (dr) dr.classList.add("active");
        setMsg("TIME DILATED");
      }, 150);
    });
    canvas.addEventListener("mouseup", () => clearTimeout(holdTimer));

    canvas.addEventListener("touchstart", e => {
      e.preventDefault();
      if (state !== "playing") return;
      holdTimer = setTimeout(() => {
        if (!canDilate()) { setMsg("TARGET TOO FAR FOR SLOMO"); return; }
        timeDilated = true; dilateTimer = 2.8;
        const dr = document.getElementById("dilation-ring"); if (dr) dr.classList.add("active");
        setMsg("TIME DILATED");
      }, 150);
    }, { passive: false });

    canvas.addEventListener("touchend", e => {
      e.preventDefault();
      clearTimeout(holdTimer);
      if (state !== "playing") return;
      const r = canvas.getBoundingClientRect();
      const t = e.changedTouches[0];
      fireBolt((t.clientX - r.left) * (W / r.width), (t.clientY - r.top) * (H / r.height));
    }, { passive: false });

    document.addEventListener("keydown", e => {
      if (e.key === "s" || e.key === "S") useShield();
      if (e.key === " ") {
        if (state === "idle" || state === "gameover") return;
        if (state === "playing") {
          if (!canDilate()) { setMsg("TARGET TOO FAR FOR SLOMO"); return; }
          timeDilated = true; dilateTimer = 2.8;
          const dr = document.getElementById("dilation-ring"); if (dr) dr.classList.add("active");
        }
      }
    });

    // Bind buttons
    const onNew = () => { const so = document.getElementById("startOverlay"); if (so) so.classList.remove("hidden"); state = "idle"; };
    const onEasy = () => startGame("easy");
    const onMed = () => startGame("medium");
    const onHard = () => startGame("hard");
    const onRestart = () => {
      const so = document.getElementById("startOverlay");
      if (so) so.classList.remove("hidden");
      const go = document.getElementById("gameoverOverlay");
      if (go) go.classList.add("hidden");
      state = "idle";
      if (bgMusic) bgMusic.pause();
    };
    const onShield = () => useShield();
    const onNextLevel = () => {
      const lo = document.getElementById("levelOverlay"); if (lo) lo.classList.add("hidden");
      orbs = []; bolts = []; powerups = [];
      combo = 0; comboTimer = 0; if (comboEl) comboEl.textContent = "0"; if (comboBar) comboBar.style.width = "0%";
      orbSpawnTimer = getSpawnInterval();
      initDanger();
      state = "playing";
    };
    const onWinRestart = () => { const so = document.getElementById("startOverlay"); if (so) so.classList.remove("hidden"); const wo = document.getElementById("winOverlay"); if (wo) wo.classList.add("hidden"); state = "idle"; };

    document.getElementById("startBtn")?.addEventListener("click", onNew);
    document.getElementById("startEasy")?.addEventListener("click", onEasy);
    document.getElementById("startMedium")?.addEventListener("click", onMed);
    document.getElementById("startHard")?.addEventListener("click", onHard);
    document.getElementById("restartBtn")?.addEventListener("click", onRestart);
    document.getElementById("shieldBtn")?.addEventListener("click", onShield);
    document.getElementById("nextLevelBtn")?.addEventListener("click", onNextLevel);
    document.getElementById("winRestartBtn")?.addEventListener("click", onWinRestart);
    document.getElementById("musicToggleBtn")?.addEventListener("click", toggleMusic);

    // Service Worker
    /* 
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
          .then(reg => console.log("SW:", reg.scope))
          .catch(err => console.log("SW failed:", err));
      });
    }
    */

    // Start loop
    last = performance.now();
    raf = requestAnimationFrame(loop);

    // Initial UI updates
    const updateStartHighScores = () => {
      ["easy", "medium", "hard"].forEach(d => {
        const el = document.getElementById(`hs-${d}`);
        const val = getHighScore(d);
        if (el) el.textContent = val > 0 ? val.toLocaleString() : "---";
      });
      const startHighEl = document.getElementById("startHighScore");
      const pbLabel = document.getElementById("pb-mode-label");
      if (startHighEl) startHighEl.textContent = getHighScore("easy").toLocaleString();
      if (pbLabel) pbLabel.textContent = "EASY BEST";
    };
    updateStartHighScores();

    // Simulate/Fetch Leaderboard
    const updateLeaderboard = async () => {
      const lbList = document.getElementById("lb-list");
      if (!lbList) return;

      try {
        lbList.innerHTML = `<div style="color: var(--cyan); font-size: 10px; opacity: 0.5;">DECRYPTING SERVER RECORDS...</div>`;
        const LEADERBOARD_URL = BACKEND_URL.replace("/track-user", "/get-leaderboard") + `?gameId=${GAME_ID}`;
        const response = await fetch(LEADERBOARD_URL);
        let data = [];
        if (response.ok) data = await response.json();

        lbList.innerHTML = "";
        const modes = ["easy", "medium", "hard"];
        let anyData = false;
        modes.forEach(mode => {
          const modeScores = data.filter(d => d.difficulty === mode).slice(0, 3);
          if (modeScores.length === 0) return;
          anyData = true;

          const header = document.createElement("div");
          header.style.cssText = `font-size: 8px; color: var(--cyan); letter-spacing: 0.2em; margin: 8px 0 4px; border-bottom: 1px solid rgba(0,229,255,0.1); padding-bottom: 1px; width: 100%; font-weight: bold;`;
          header.textContent = mode.toUpperCase() + " ELITE";
          lbList.appendChild(header);

          modeScores.forEach((entry, i) => {
            const row = document.createElement("div");
            row.style.cssText = `
              display: flex; align-items: center; gap: 8px; width: 100%;
              padding: 4px 10px; border-radius: 6px;
              background: rgba(255,255,255,0.02);
              border: 1px solid rgba(255,255,255,0.05);
              margin-bottom: 2px;
            `;

            const rankColor = i === 0 ? "var(--amber)" : i === 1 ? "#e0e0e0" : "#cd7f32";
            row.innerHTML = `
              <div style="font-size: 11px; font-weight: 900; color: ${rankColor}; min-width: 15px;">#${i + 1}</div>
              <div style="flex: 1; text-align: left; display: flex; align-items: center; justify-content: space-between;">
                <div style="font-size: 10px; font-weight: bold; color: #fff;">${(entry.email || "Pilot").split('@')[0]}</div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <div style="font-size: 8px; color: var(--cyan);">PTS: <span style="color: #fff;">${(entry.score || 0).toLocaleString()}</span></div>
                  <div style="font-size: 8px; color: ${mode === "hard" ? "var(--red)" : mode === "medium" ? "var(--amber)" : "var(--green)"}; font-weight: bold;">LVL ${entry.level || 1}</div>
                </div>
              </div>
            `;
            lbList.appendChild(row);
          });
        });

        if (!anyData) {
          lbList.innerHTML = `<div style="color: rgba(0,242,255,0.4); font-size: 10px; text-align: center; margin-top: 20px;">NO DATA BROADCAST DETECTED<br/><span style="font-size: 8px; opacity: 0.6;">BE THE FIRST TO SUBMIT A SCORE!</span></div>`;
        }
      } catch (e) {
        lbList.innerHTML = `<div style="color: var(--red); font-size: 10px;">COMM LINK LOST: UNAVAILABLE</div>`;
      }
    };
    updateLeaderboard();

    // Update PB on mode button hover
    ["Easy", "Medium", "Hard"].forEach(m => {
      const btn = document.getElementById(`start${m}`);
      btn?.addEventListener("mouseenter", () => {
        const d = m.toLowerCase();
        const score = getHighScore(d);
        const pbVal = document.getElementById("startHighScore");
        const pbLabel = document.getElementById("pb-mode-label");
        const objText = document.getElementById("objective-text");
        if (pbVal) pbVal.textContent = score > 0 ? score.toLocaleString() : "NULL";
        if (pbLabel) pbLabel.textContent = m.toUpperCase() + " BEST";
        if (objText) objText.textContent = `OBJECTIVE: SURVIVE 10 WAVES OF INCREASING INTENSITY`;
        difficulty = d; // update for leaderboard mock
        updateLeaderboard();
      });
    });

    updateLeaderboard();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      document.getElementById("startBtn")?.removeEventListener("click", onNew);
      document.getElementById("startEasy")?.removeEventListener("click", onEasy);
      document.getElementById("startMedium")?.removeEventListener("click", onMed);
      document.getElementById("startHard")?.removeEventListener("click", onHard);
      document.getElementById("restartBtn")?.removeEventListener("click", onRestart);
      document.getElementById("shieldBtn")?.removeEventListener("click", onShield);
      document.getElementById("nextLevelBtn")?.removeEventListener("click", onNextLevel);
      document.getElementById("winRestartBtn")?.removeEventListener("click", onWinRestart);
      document.getElementById("musicToggleBtn")?.removeEventListener("click", toggleMusic);
      if (bgMusic) bgMusic.pause();
    };
  }, []);

  return (
    <div id="app">
      <audio ref={audioRef} src="/assets/audio/music_unlimited-stranger-things-124008.mp3" preload="auto"></audio>
      <audio ref={levelUpRef} src="https://cdn.pixabay.com/audio/2023/11/04/audio_98d68998de.mp3" preload="auto"></audio>
      {/* HUD */}
      <div id="hud">
        <div className="hud-block"><div className="hud-label">SCORE</div><div className="hud-val" id="scoreEl">0</div></div>
        <div className="hud-block"><div className="hud-label">LEVEL</div><div className="hud-val" id="levelEl" style={{ color: "var(--green)" }}>1</div></div>
        <div className="hud-block"><div className="hud-label">COMBO</div><div className="hud-val combo" id="comboEl">0</div></div>
        <div className="hud-block" style={{ borderLeft: "2px solid rgba(255,23,68,0.3)", paddingLeft: "15px" }}>
          <div className="hud-label" style={{ color: "var(--red)" }}>LIVES</div>
          <div className="hud-val lives" id="livesEl" style={{ fontSize: "24px", color: "var(--red)", textShadow: "0 0 15px rgba(255,23,68,0.4)" }}>3</div>
        </div>
        <div className="hud-block"><button id="musicToggleBtn" className="music-btn">🔊</button></div>
      </div>
      <div id="combo-bar-wrap"><div id="combo-bar-bg"><div id="combo-bar"></div></div></div>
      <div id="lvl-prog-wrap" style={{ height: "4px", background: "rgba(255,255,255,0.05)", width: "100%", position: "relative" }}>
        <div id="lvl-prog-bar" style={{ height: "100%", width: "0%", background: "var(--green)", boxShadow: "0 0 10px var(--green)", transition: "width 0.3s ease" }}></div>
      </div>

      {/* Canvas */}
      <div id="canvas-wrap" ref={wrapRef}>
        <canvas id="c" ref={canvasRef}></canvas>
        <div id="dilation-ring"></div>
        <div id="wave-flash"></div>
      </div>

      <div id="controls" style={{
        display: "flex",
        alignItems: "center",
        gap: "clamp(6px, 2vw, 12px)",
        padding: "clamp(6px, 1.5vw, 10px) 15px",
        height: "auto",
        minHeight: "50px"
      }}>
        <button className="ctrl-btn" id="startBtn" style={{ padding: "8px 12px", fontSize: "10px" }}>NEW GAME</button>
        <div id="msg-bar" style={{ fontSize: "9px" }}>TAP SCREEN TO FIRE</div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,23,68,0.05)", padding: "4px 10px", borderRadius: "8px", border: "1px solid rgba(255,23,68,0.15)" }}>
          <div id="shield-wrap" style={{ display: "flex", gap: "3px" }}>
            <div className="shield-pip active" id="pip0" style={{ width: "10px", height: "10px" }}></div>
            <div className="shield-pip active" id="pip1" style={{ width: "10px", height: "10px" }}></div>
            <div className="shield-pip active" id="pip2" style={{ width: "10px", height: "10px" }}></div>
          </div>
          <button className="ctrl-btn danger" id="shieldBtn" style={{ padding: "6px 12px", fontSize: "12px", borderRadius: "6px" }}>SHIELD</button>
        </div>
      </div>
      {/* Start overlay */}
      <div className="overlay" id="startOverlay" style={{ background: "#020a14", zIndex: 20 }}>
        <div className="ov-title" style={{ color: "var(--green)", textShadow: "0 0 40px rgba(0,230,118,0.7)", fontSize: "clamp(22px, 8vw, 32px)", letterSpacing: ".12em", flexShrink: 0 }}>🌍 SAVE THE EARTH</div>
        <div style={{
          border: "2px solid rgba(0,229,255,0.2)",
          background: "rgba(0,229,255,0.03)",
          borderRadius: "12px",
          padding: "clamp(10px, 4vw, 16px)",
          width: "100%",
          maxWidth: "420px",
          position: "relative",
          boxShadow: "0 0 30px rgba(0,229,255,0.05)",
          flexShrink: 0
        }}>
          <div className="ov-subtitle" style={{
            color: "var(--cyan)",
            fontSize: "10px",
            letterSpacing: ".2em",
            fontWeight: "bold",
            position: "absolute",
            top: "-8px",
            left: "16px",
            background: "#020a14",
            padding: "0 8px",
            border: "1px solid rgba(0,229,255,0.2)",
            borderRadius: "4px"
          }}>MISSION BRIEFING</div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "10px",
            width: "100%",
            textAlign: "left"
          }}>
            <div style={{ background: "rgba(0,229,255,0.05)", border: "1px solid rgba(0,229,255,0.15)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ color: "var(--cyan)", fontSize: "10px", fontWeight: "bold", marginBottom: "4px" }}>🎯 ATTACK</div>
              <div style={{ fontSize: "9px", color: "rgba(0,229,255,0.6)", lineHeight: "1.4" }}>TAP screen to fire interceptor bolts at incoming threats.</div>
            </div>
            <div style={{ background: "rgba(191,0,255,0.05)", border: "1px solid rgba(191,0,255,0.15)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ color: "var(--purple)", fontSize: "10px", fontWeight: "bold", marginBottom: "4px" }}>⏱️ SLOMO</div>
              <div style={{ fontSize: "9px", color: "rgba(191,0,255,0.6)", lineHeight: "1.4" }}>HOLD screen when ORB is close to earth to dilate time and gain precision.</div>
            </div>
            <div style={{ background: "rgba(255,23,68,0.05)", border: "1px solid rgba(255,23,68,0.15)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ color: "var(--red)", fontSize: "10px", fontWeight: "bold", marginBottom: "4px" }}>🛡️ SHIELD</div>
              <div style={{ fontSize: "9px", color: "rgba(255,23,68,0.6)", lineHeight: "1.4" }}>Use [S] or SHIELD button to nukes the closest threat.</div>
            </div>
            <div style={{ background: "rgba(255,171,0,0.05)", border: "1px solid rgba(255,171,0,0.15)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ color: "var(--amber)", fontSize: "10px", fontWeight: "bold", marginBottom: "4px" }}>⚡ HARD MODE</div>
              <div style={{ fontSize: "9px", color: "rgba(255,171,0,0.6)", lineHeight: "1.4" }}>No guidance system. Pure skill required for top rank.</div>
            </div>
          </div>
        </div>

        <div id="objective-text" style={{ fontSize: "10px", color: "rgba(0,229,255,0.4)", margin: "8px 0" }}>OBJECTIVE: SURVIVE 10 WAVES OF INCREASING INTENSITY</div>

        {/* Difficulty Selection with Arrow Link */}
        <div style={{ position: "relative", width: "100%", maxWidth: "380px", marginTop: "10px", marginBottom: "20px" }}>
          <div style={{ fontSize: "10px", color: "rgba(0,229,255,0.4)", marginBottom: "8px", letterSpacing: "0.2em", textAlign: "center" }}>SELECT MISSION MODE</div>
          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            <button className="big-btn" id="startEasy" style={{ borderColor: "var(--green)", color: "var(--green)", background: "rgba(0,230,118,0.08)", flex: "1", padding: "10px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
              <span>EASY</span>
              <span style={{ fontSize: "8px", opacity: 0.6, fontWeight: "normal" }}>MY BEST: <span id="hs-easy">0</span></span>
            </button>
            <button className="big-btn" id="startMedium" style={{ borderColor: "var(--amber)", color: "var(--amber)", background: "rgba(255,171,0,0.08)", flex: "1", padding: "10px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
              <span>MED</span>
              <span style={{ fontSize: "8px", opacity: 0.6, fontWeight: "normal" }}>MY BEST: <span id="hs-medium">0</span></span>
            </button>
            <button className="big-btn" id="startHard" style={{ borderColor: "var(--red)", color: "var(--red)", background: "rgba(255,23,68,0.08)", flex: "1", padding: "10px 0", display: "flex", flexDirection: "column", gap: "4px" }}>
              <span>HARD</span>
              <span style={{ fontSize: "8px", opacity: 0.6, fontWeight: "normal" }}>MY BEST: <span id="hs-hard">0</span></span>
            </button>
          </div>

          {/* Animated Arrow */}
          <svg style={{ position: "absolute", bottom: "-38px", left: "50%", transform: "translateX(-50%)", width: "40px", height: "40px" }} viewBox="0 0 24 24">
            <path d="M12 4v16m0 0l-4-4m4 4l4-4" stroke="rgba(0,229,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
              <animate attributeName="d" values="M12 4v16m0 0l-4-4m4 4l4-4; M12 6v16m0 0l-4-4m4 4l4-4; M12 4v16m0 0l-4-4m4 4l4-4" dur="2s" repeatCount="indefinite" />
            </path>
          </svg>
        </div>

        <div style={{
          background: "rgba(0, 242, 255, 0.05)",
          border: "1px solid rgba(0, 242, 255, 0.25)",
          borderRadius: "12px",
          padding: "16px 24px",
          width: "100%",
          maxWidth: "380px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 0 30px rgba(0, 242, 255, 0.05)",
          marginTop: "15px"
        }}>
          <div>
            <div style={{ fontSize: "10px", color: "var(--cyan)", letterSpacing: "0.2em", fontWeight: "900", marginBottom: "2px" }}>MY HIGHSCORE</div>
            <div id="pb-mode-label" style={{ fontSize: "11px", color: "rgba(0, 242, 255, 0.6)", letterSpacing: "0.1em", marginBottom: "6px" }}>EASY BEST</div>
            <div id="startHighScore" style={{ fontSize: "38px", fontWeight: "900", color: "var(--cyan)", fontFamily: "Orbitron", lineHeight: 1, textShadow: "0 0 20px rgba(0, 242, 255, 0.5)" }}>NULL</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "9px", color: "var(--cyan)", letterSpacing: "0.15em", fontWeight: "bold", opacity: 0.6 }}>PILOT STATUS</div>
            <div style={{ fontSize: "14px", color: "var(--green)", fontWeight: "bold", textShadow: "0 0 10px rgba(0,255,136,0.3)" }}>ACTIVE</div>
          </div>
        </div>

        {/* Global Leaderboard Footer */}
        <div style={{
          marginTop: "40px",
          paddingTop: "12px",
          width: "100%",
          maxWidth: "360px",
          borderTop: "1px solid rgba(0,229,255,0.1)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center"
        }}>
          <div style={{ fontSize: "11px", color: "var(--cyan)", margin: "14px 0 6px", letterSpacing: "0.3em", fontWeight: "bold", textShadow: "0 0 10px rgba(0,242,255,0.3)" }}>IIITL BEST SCORERS</div>
          <div id="lb-list" style={{ width: "100%", minHeight: "154px", display: "flex", flexDirection: "column", justifyContent: "flex-start", transition: "all 0.3s ease" }}>
            {/* Rows populated by JS */}
          </div>
        </div>
      </div>

      {/* Game over overlay */}
      <div className="overlay hidden" id="gameoverOverlay">
        <div className="ov-title red">SYSTEM FAILURE</div>
        <div className="ov-score" id="finalScore">0</div>
        <div className="ov-stat-grid">
          <div className="ov-stat"><div className="ov-stat-label">LEVEL REACHED</div><div className="ov-stat-val" id="finalWave">1</div></div>
          <div className="ov-stat"><div className="ov-stat-label">INTERCEPTS</div><div className="ov-stat-val" id="finalHits">0</div></div>
          <div className="ov-stat"><div className="ov-stat-label">BEST COMBO</div><div className="ov-stat-val" id="finalCombo">0</div></div>
          <div className="ov-stat"><div className="ov-stat-label">HIGH SCORE</div><div className="ov-stat-val" id="finalHigh">0</div></div>
        </div>
        <button className="big-btn" id="restartBtn">REINITIATE</button>
      </div>

      {/* Level overlay */}
      <div className="overlay hidden" id="levelOverlay" style={{ background: "#020a14", zIndex: 100 }}>
        <div className="ov-title" id="levelTitle" style={{ color: "var(--amber)", fontSize: "40px" }}>LEVEL 2</div>
        <div className="ov-subtitle" style={{ fontSize: "14px", marginBottom: "12px", color: "var(--cyan)" }}>LIVES RESTORED • DEFENSES CALIBRATED</div>
        <button className="big-btn" id="nextLevelBtn" style={{ borderColor: "var(--cyan)", color: "var(--cyan)", background: "rgba(0, 242, 255, 0.1)" }}>START LEVEL</button>
      </div>

      {/* Win overlay */}
      <div className="overlay hidden" id="winOverlay">
        <div className="ov-title" style={{ color: "var(--green)", textShadow: "0 0 30px rgba(0,230,118,0.5)" }}>VICTORY</div>
        <div className="ov-subtitle">PROTOCOL SUCCESSFULLY DEFENDED</div>
        <div className="ov-score" id="winScoreEl">0</div>
        <button className="big-btn" id="winRestartBtn">PLAY AGAIN</button>
      </div>
    </div>
  );
}
