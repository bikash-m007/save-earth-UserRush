import { useEffect, useRef } from "react";

export default function Game() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext("2d");

    let W, H;
    function resize() {
      const r = wrap.getBoundingClientRect();
      W = canvas.width = r.width;
      H = canvas.height = r.height;
    }
    resize();
    window.addEventListener("resize", resize);

    // Game state
    let state = "idle";
    let score = 0, lives = 3, combo = 0, comboTimer = 0;
    let totalHits = 0, bestCombo = 0, highScore = 0;
    let level = 1, levelKills = 0;
    let shields = 3;
    let orbs = [], bolts = [], particles = [], powerups = [];
    let danger = null;
    let turretAngle = -Math.PI / 2;
    let timeDilated = false, dilateTimer = 0;
    let orbSpawnTimer = 0;
    let mouseX = 200, mouseY = 200;
    let raf;

    // Difficulty
    let difficulty = "medium";
    const DIFF_SETTINGS = {
      easy:   { boltSpeed: 650, reload: 0.15, boltR: 5, orbMult: 0.8 },
      medium: { boltSpeed: 520, reload: 0.35, boltR: 4, orbMult: 1.0 },
      hard:   { boltSpeed: 420, reload: 0.55, boltR: 3, orbMult: 1.25 },
    };
    let BOLT_SPEED = DIFF_SETTINGS.medium.boltSpeed;
    let RELOAD_TIME = DIFF_SETTINGS.medium.reload;
    let BOLT_R = DIFF_SETTINGS.medium.boltR;
    let reloadTimer = 0;

    const TURRET_R = 20, ORB_R = 13, DANGER_R = 34, POWERUP_R = 10;

    function orbSpeed() { return (55 + level * 8) * DIFF_SETTINGS[difficulty].orbMult; }
    function getSpawnInterval() { return Math.max(0.6, (2.5 - level * 0.3) / DIFF_SETTINGS[difficulty].orbMult); }
    function getTurretPos() { return { x: W / 2, y: H - 60 }; }

    // Audio
    let audioCtx;
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
      } catch (e) {}
    }
    function playHit() { beep(880, 0.12, "square", 0.12); setTimeout(() => beep(1100, 0.08, "sine", 0.1), 60); if (navigator.vibrate) navigator.vibrate(20); }
    function playMiss() { beep(200, 0.18, "sawtooth", 0.1); if (navigator.vibrate) navigator.vibrate(10); }
    function playDanger() { beep(110, 0.35, "sawtooth", 0.18); beep(90, 0.5, "square", 0.12); if (navigator.vibrate) navigator.vibrate([100, 50, 100]); }
    function playPowerup() { beep(660, 0.06, "sine", 0.1); setTimeout(() => beep(880, 0.06, "sine", 0.1), 70); setTimeout(() => beep(1100, 0.1, "sine", 0.1), 140); if (navigator.vibrate) navigator.vibrate(30); }
    function playFire() { beep(440, 0.05, "square", 0.08); }
    function playWave() { beep(300, 0.1, "sine", 0.1); setTimeout(() => beep(500, 0.1, "sine", 0.1), 100); setTimeout(() => beep(700, 0.15, "sine", 0.12), 200); }

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
      orbs.push({ x: sx, y: sy, vx: (dx / dist) * spd, vy: (dy / dist) * spd, r: ORB_R, alive: true, trail: [] });
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
      }
    }

    const LEVEL_TARGETS = [5, 7, 9, 11, 15];

    function checkLevelUp() {
      if (level > 5) return;
      if (levelKills < LEVEL_TARGETS[level - 1]) return;
      if (level === 5) {
        state = "win";
        const ws = document.getElementById("winScoreEl");
        if (ws) ws.textContent = score;
        const wo = document.getElementById("winOverlay");
        if (wo) wo.classList.remove("hidden");
        beep(500, 0.2, "sine", 0.2);
        setTimeout(() => beep(700, 0.2, "sine", 0.2), 200);
        setTimeout(() => beep(900, 0.4, "sine", 0.2), 400);
        return;
      }
      level++;
      levelKills = 0;
      state = "levelup";
      const lt = document.getElementById("levelTitle");
      if (lt) lt.textContent = "LEVEL " + level;
      const lo = document.getElementById("levelOverlay");
      if (lo) lo.classList.remove("hidden");
      lives = 3;
      if (livesEl) livesEl.textContent = lives;
      if (levelEl) levelEl.textContent = level;
      playWave();
    }

    function startGame(diff = "medium") {
      try { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
      difficulty = diff;
      const s = DIFF_SETTINGS[diff];
      BOLT_SPEED = s.boltSpeed; RELOAD_TIME = s.reload; BOLT_R = s.boltR; reloadTimer = 0;
      score = 0; lives = 3; level = 1; levelKills = 0; combo = 0; comboTimer = 0;
      totalHits = 0; bestCombo = 0; shields = 3;
      orbs = []; bolts = []; particles = []; powerups = [];
      state = "playing";
      if (scoreEl) scoreEl.textContent = "0";
      if (levelEl) levelEl.textContent = "1";
      if (livesEl) livesEl.textContent = "3";
      if (comboEl) comboEl.textContent = "0";
      if (comboBar) comboBar.style.width = "0%";
      updateShieldUI();
      ["startOverlay","gameoverOverlay","winOverlay"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
      });
      initDanger();
      orbSpawnTimer = getSpawnInterval();
      spawnPowerup();
      playWave();
      setMsg("AIM — MISSION: " + diff.toUpperCase());
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
      else { last = performance.now(); }
    }

    function endGame() {
      state = "gameover";
      if (score > highScore) highScore = score;
      const fs = document.getElementById("finalScore"); if (fs) fs.textContent = score;
      const fw = document.getElementById("finalWave"); if (fw) fw.textContent = level;
      const fh = document.getElementById("finalHits"); if (fh) fh.textContent = totalHits;
      const fc = document.getElementById("finalCombo"); if (fc) fc.textContent = bestCombo;
      const fhi = document.getElementById("finalHigh"); if (fhi) fhi.textContent = highScore;
      const go = document.getElementById("gameoverOverlay"); if (go) go.classList.remove("hidden");
      playDanger();
    }

    let last = 0;
    function loop(ts) {
      const rawDt = Math.min((ts - last) / 1000, 0.05); last = ts;
      const dt = timeDilated ? rawDt * 0.2 : rawDt;
      update(dt, rawDt);
      draw();
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
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (Math.hypot(o.x - danger.x, o.y - danger.y) < o.r + danger.r - 4) {
          o.alive = false;
          spawnParticles(o.x, o.y, "#ff1744", 24, 160);
          spawnRing(danger.x, danger.y, "#ff1744");
          lives--;
          if (livesEl) livesEl.textContent = lives;
          combo = 0; if (comboEl) comboEl.textContent = "0"; comboTimer = 0; if (comboBar) comboBar.style.width = "0%";
          setMsg("ORB HIT DANGER ZONE!");
          playDanger();
          if (lives <= 0) { setTimeout(endGame, 600); state = "dying"; }
        }
      });

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
            const LEVEL_PTS = [30, 50, 70, 100, 120];
            const pts = (LEVEL_PTS[level - 1] || 120) * Math.max(1, combo);
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
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      // BG
      ctx.fillStyle = "#020a14"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(0,229,255,0.04)"; ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 38) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 38) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const bw = 24;
      ctx.strokeStyle = "rgba(0,229,255,0.25)"; ctx.lineWidth = 1.5;
      [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]].forEach(([cx,cy,sx,sy]) => {
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
        ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(4,0); ctx.lineTo(-4,-4); ctx.lineTo(-4,4); ctx.fill();
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
          ctx.strokeStyle = `rgba(191,0,255,${a * 0.35})`; ctx.lineWidth = a * 5;
          ctx.beginPath(); ctx.moveTo(o.trail[i-1].x, o.trail[i-1].y); ctx.lineTo(o.trail[i].x, o.trail[i].y); ctx.stroke();
        }
        if (o.alive) {
          ctx.strokeStyle = "#bf00ff"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = "rgba(191,0,255,0.2)";
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.beginPath(); ctx.arc(o.x - 3, o.y - 4, 4, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(191,0,255,0.3)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 5, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      });

      // Bolts
      bolts.forEach(b => {
        if (!b.alive && b.trail.length === 0) return;
        ctx.save();
        for (let i = 1; i < b.trail.length; i++) {
          const a = i / b.trail.length;
          ctx.strokeStyle = `rgba(0,229,255,${a * 0.6})`; ctx.lineWidth = a * 4;
          ctx.beginPath(); ctx.moveTo(b.trail[i-1].x, b.trail[i-1].y); ctx.lineTo(b.trail[i].x, b.trail[i].y); ctx.stroke();
        }
        if (b.alive) {
          ctx.fillStyle = "#00e5ff";
          ctx.beginPath(); ctx.arc(b.x, b.y, BOLT_R, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(b.x, b.y, BOLT_R, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      });

      // Intercept line
      const ao = orbs.find(o => o.alive);
      if (ao) {
        const tp = getTurretPos();
        const ip = computeIntercept(ao.x, ao.y, ao.vx, ao.vy, tp.x, tp.y, BOLT_SPEED);
        if (ip) {
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
        i === 0 ? ctx.moveTo(Math.cos(a)*(TURRET_R+2), Math.sin(a)*(TURRET_R+2)) : ctx.lineTo(Math.cos(a)*(TURRET_R+2), Math.sin(a)*(TURRET_R+2));
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
    const onRestart = () => { const so = document.getElementById("startOverlay"); if (so) so.classList.remove("hidden"); const go = document.getElementById("gameoverOverlay"); if (go) go.classList.add("hidden"); state = "idle"; };
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

    // Service Worker
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
          .then(reg => console.log("SW:", reg.scope))
          .catch(err => console.log("SW failed:", err));
      });
    }

    // Start loop
    last = performance.now();
    raf = requestAnimationFrame(loop);

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
    };
  }, []);

  return (
    <div id="app">
      {/* HUD */}
      <div id="hud">
        <div className="hud-block"><div className="hud-label">SCORE</div><div className="hud-val" id="scoreEl">0</div></div>
        <div className="hud-block"><div className="hud-label">LEVEL</div><div className="hud-val" id="levelEl" style={{color:"var(--green)"}}>1</div></div>
        <div className="hud-block"><div className="hud-label">COMBO</div><div className="hud-val combo" id="comboEl">0</div></div>
        <div className="hud-block">
          <div className="hud-label">SHIELD</div>
          <div id="shield-wrap">
            <div className="shield-pip active" id="pip0"></div>
            <div className="shield-pip active" id="pip1"></div>
            <div className="shield-pip active" id="pip2"></div>
          </div>
        </div>
        <div className="hud-block"><div className="hud-label">LIVES</div><div className="hud-val lives" id="livesEl">3</div></div>
      </div>
      <div id="combo-bar-wrap"><div id="combo-bar-bg"><div id="combo-bar"></div></div></div>

      {/* Canvas */}
      <div id="canvas-wrap" ref={wrapRef}>
        <canvas id="c" ref={canvasRef}></canvas>
        <div id="dilation-ring"></div>
        <div id="wave-flash"></div>
      </div>

      {/* Controls */}
      <div id="controls">
        <button className="ctrl-btn" id="startBtn">NEW GAME</button>
        <div id="msg-bar">TAP SCREEN TO FIRE</div>
        <button className="ctrl-btn danger" id="shieldBtn">SHIELD</button>
      </div>

      {/* Start overlay */}
      <div className="overlay" id="startOverlay">
        <div className="ov-title" style={{color:"var(--green)",textShadow:"0 0 40px rgba(0,230,118,0.7)",fontSize:"32px",letterSpacing:".12em"}}>🌍 SAVE THE EARTH</div>
        <div className="ov-subtitle" style={{color:"rgba(0,230,118,0.8)",fontSize:"13px",letterSpacing:".1em"}}>INTERCEPT PROTOCOL INITIATED</div>
        <div className="ov-subtitle" style={{fontSize:"11px",lineHeight:"2",border:"1px solid rgba(0,230,118,0.2)",borderRadius:"6px",padding:"10px 14px",background:"rgba(0,230,118,0.05)"}}>
          ☄️ Incoming orbs threaten the Earth<br/>
          🎯 CLICK / TAP to fire interceptor bolt<br/>
          ⏱ HOLD to activate Time Dilation near Earth<br/>
          🛡 SHIELD eliminates the nearest orb<br/>
          🔴 Red arrows on Earth show incoming threats
        </div>
        <div className="ov-subtitle" style={{fontSize:"10px",color:"rgba(0,230,118,0.5)"}}>5 LEVELS · INTERCEPT ORBS TO ADVANCE · DEFEND EARTH</div>
        <div style={{display:"flex",gap:"10px",width:"100%",marginTop:"10px"}}>
          <button className="big-btn" id="startEasy" style={{borderColor:"var(--green)",color:"var(--green)",background:"rgba(0,230,118,0.08)",flex:"1",padding:"14px 0"}}>EASY</button>
          <button className="big-btn" id="startMedium" style={{borderColor:"var(--amber)",color:"var(--amber)",background:"rgba(255,171,0,0.08)",flex:"1",padding:"14px 0"}}>MED</button>
          <button className="big-btn" id="startHard" style={{borderColor:"var(--red)",color:"var(--red)",background:"rgba(255,23,68,0.08)",flex:"1",padding:"14px 0"}}>HARD</button>
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
      <div className="overlay hidden" id="levelOverlay">
        <div className="ov-title" id="levelTitle" style={{color:"var(--amber)"}}>LEVEL 2</div>
        <div className="ov-subtitle">LIVES RESTORED TO 3</div>
        <button className="big-btn" id="nextLevelBtn">START LEVEL</button>
      </div>

      {/* Win overlay */}
      <div className="overlay hidden" id="winOverlay">
        <div className="ov-title" style={{color:"var(--green)",textShadow:"0 0 30px rgba(0,230,118,0.5)"}}>VICTORY</div>
        <div className="ov-subtitle">PROTOCOL SUCCESSFULLY DEFENDED</div>
        <div className="ov-score" id="winScoreEl">0</div>
        <button className="big-btn" id="winRestartBtn">PLAY AGAIN</button>
      </div>
    </div>
  );
}
