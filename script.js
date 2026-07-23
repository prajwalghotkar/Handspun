// NeuroGrip — neural hand tracer
// Uses MediaPipe Hands for landmark detection, renders a glowing
// skeleton + comet trails on a canvas overlay, and derives simple
// gesture / speed metrics from the landmark geometry.

(function () {
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  const startOverlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');
  const errBox = document.getElementById('errBox');
  const handsCountEl = document.getElementById('handsCount');
  const fpsEl = document.getElementById('fpsVal');
  const gestureEl = document.getElementById('gestureVal');
  const speedEl = document.getElementById('speedVal');
  const clockEl = document.getElementById('clock');

  // finger color scheme, thumb -> pinky
  const FINGER_COLORS = ['#ffb84d', '#5ff0ff', '#9dff5a', '#ff3fa4', '#b78bff'];
  const FINGER_CHAINS = [
    [0, 1, 2, 3, 4],
    [0, 5, 6, 7, 8],
    [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16],
    [0, 17, 18, 19, 20],
  ];
  const PALM_LINKS = [[5, 9], [9, 13], [13, 17], [0, 5], [0, 17]];

  let W = 0, H = 0;
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    W = canvas.width = rect.width;
    H = canvas.height = rect.height;
  }
  window.addEventListener('resize', resize);

  // trailing history per fingertip, keyed by "handIdx-landmarkIdx"
  const trails = {};
  const TRAIL_LEN = 14;

  // for speed calc: previous wrist positions per hand
  let prevWrists = {};
  let lastFrameTime = performance.now();
  let smoothedSpeed = 0;
  let fpsHistory = [];

  function clockTick() {
    const now = new Date();
    clockEl.textContent = now.toTimeString().slice(0, 8);
  }
  setInterval(clockTick, 1000);
  clockTick();

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  function classifyGesture(landmarks) {
    // curl estimate: tip distance to wrist vs mcp-to-wrist baseline
    const wrist = landmarks[0];
    const tips = [4, 8, 12, 16, 20];
    const mcps = [2, 5, 9, 13, 17];
    let curled = 0;
    for (let i = 1; i < 5; i++) { // skip thumb for curl vote, index..pinky
      const tipD = dist(landmarks[tips[i]], wrist);
      const mcpD = dist(landmarks[mcps[i]], wrist);
      if (tipD < mcpD * 1.15) curled++;
    }
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const pinchDist = dist(thumbTip, indexTip);
    const handSpan = dist(landmarks[5], landmarks[17]) || 0.001;

    if (pinchDist / handSpan < 0.35) return 'Pinch';
    if (curled >= 3) return 'Fist';
    if (curled === 0) return 'Open Palm';

    // pointing: index extended, others curled
    const indexExt = dist(landmarks[8], wrist) > dist(landmarks[5], wrist) * 1.4;
    const othersCurled = curled >= 2;
    if (indexExt && othersCurled) return 'Point';
    return 'Relaxed';
  }

  function drawGlowLine(x1, y1, x2, y2, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawNode(x, y, color, r) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function onResults(results) {
    // motion-trail fade: draw translucent rect instead of full clear
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(5,7,10,0.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const now = performance.now();
    const dt = Math.max(now - lastFrameTime, 1);
    lastFrameTime = now;
    const fps = 1000 / dt;
    fpsHistory.push(fps);
    if (fpsHistory.length > 20) fpsHistory.shift();
    const avgFps = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
    fpsEl.textContent = Math.round(avgFps);

    const numHands = results.multiHandLandmarks ? results.multiHandLandmarks.length : 0;
    handsCountEl.textContent = numHands;
    handsCountEl.className = 'value ' + (numHands > 0 ? 'good' : '');

    let maxSpeedPct = 0;
    let activeGesture = '—';

    if (numHands > 0) {
      results.multiHandLandmarks.forEach((landmarks, handIdx) => {
        // mirror x because video is mirrored via CSS but landmarks come un-mirrored
        const pts = landmarks.map((lm) => ({
          x: (1 - lm.x) * W,
          y: lm.y * H,
          z: lm.z,
        }));

        // palm links
        PALM_LINKS.forEach(([a, b]) => {
          drawGlowLine(pts[a].x, pts[a].y, pts[b].x, pts[b].y, 'rgba(180,220,255,0.5)', 2);
        });

        // finger chains, colored, tapering glow
        FINGER_CHAINS.forEach((chain, fi) => {
          const color = FINGER_COLORS[fi];
          for (let i = 0; i < chain.length - 1; i++) {
            const a = pts[chain[i]];
            const b = pts[chain[i + 1]];
            drawGlowLine(a.x, a.y, b.x, b.y, color, 3 - i * 0.3);
          }
          // tip node
          const tipIdx = chain[chain.length - 1];
          drawNode(pts[tipIdx].x, pts[tipIdx].y, color, 4.5);

          // trailing comet for tip
          const key = handIdx + '-' + tipIdx;
          if (!trails[key]) trails[key] = [];
          trails[key].push({ x: pts[tipIdx].x, y: pts[tipIdx].y });
          if (trails[key].length > TRAIL_LEN) trails[key].shift();
          const trail = trails[key];
          for (let t = 0; t < trail.length - 1; t++) {
            const alpha = (t / trail.length) * 0.5;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(trail[t].x, trail[t].y);
            ctx.lineTo(trail[t + 1].x, trail[t + 1].y);
            ctx.stroke();
            ctx.restore();
          }
        });

        // wrist node
        drawNode(pts[0].x, pts[0].y, '#eaf6f8', 5);

        // speed calc based on wrist delta (normalized coords, not pixels)
        const wristNorm = { x: landmarks[0].x, y: landmarks[0].y };
        const prev = prevWrists[handIdx];
        if (prev) {
          const d = Math.hypot(wristNorm.x - prev.x, wristNorm.y - prev.y);
          const speedPct = Math.min(100, Math.round((d / dt) * 6000));
          maxSpeedPct = Math.max(maxSpeedPct, speedPct);
        }
        prevWrists[handIdx] = wristNorm;

        const g = classifyGesture(landmarks);
        if (handIdx === 0) activeGesture = g;
      });
    } else {
      prevWrists = {};
    }

    smoothedSpeed = smoothedSpeed * 0.7 + maxSpeedPct * 0.3;
    speedEl.textContent = Math.round(smoothedSpeed) + '%';
    speedEl.className = 'value ' + (smoothedSpeed > 60 ? 'warn' : smoothedSpeed > 20 ? 'good' : '');
    gestureEl.textContent = activeGesture;
  }

  let handsModel, camera;

  async function start() {
    try {
      errBox.textContent = '';
      resize();

      handsModel = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      handsModel.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      handsModel.onResults(onResults);

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();

      camera = new Camera(video, {
        onFrame: async () => {
          await handsModel.send({ image: video });
        },
        width: 640,
        height: 480,
      });
      camera.start();

      startOverlay.style.display = 'none';
    } catch (err) {
      console.error(err);
      errBox.textContent =
        'Camera access failed: ' + (err && err.message ? err.message : err) +
        '. If you are inside an embedded preview, try opening this file directly in your browser.';
    }
  }

  startBtn.addEventListener('click', start);
  resize();
})();
