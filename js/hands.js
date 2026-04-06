const HandTracker = {
  hands: null,
  camera: null,
  video: null,
  canvas: null,
  ctx: null,
  active: false,

  // Per-hand EMA-smoothed landmark arrays (up to 2 hands)
  _smoothed: [null, null],
  // EMA factor: 0 = instant/raw, 1 = frozen. ~0.5 gives a smooth but responsive feel
  _ALPHA: 0.50,

  // Pinch state with hysteresis to avoid flickering
  _pinchActive: false,
  _PINCH_CLOSE: 0.07,   // threshold to enter pinch
  _PINCH_OPEN:  0.10,   // threshold to exit pinch (hysteresis gap)
  prevPinch: null,

  // Spread state for two-hand zoom
  prevSpread: null,

  // Fist debounce: require N consecutive frames before triggering reset
  _fistFrames: 0,
  _FIST_FRAMES_REQ: 10,

  async init() {
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    this.canvas = document.getElementById('hand-preview');
    if (this.canvas) this.ctx = this.canvas.getContext('2d');

    try {
      this.hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6
      });

      this.hands.onResults((r) => this._onResults(r));

      this.camera = new Camera(this.video, {
        onFrame: async () => {
          if (this.active) await this.hands.send({ image: this.video });
        },
        width: 320,
        height: 240
      });

      return true;
    } catch (e) {
      console.warn('Hand tracking unavailable:', e.message);
      return false;
    }
  },

  async toggle() {
    this.active = !this.active;
    if (this.active) {
      await this.camera.start();
      if (this.canvas) this.canvas.style.display = 'block';
      // OrbitControls stays enabled — mouse and gestures coexist
    } else {
      this.camera.stop();
      if (this.canvas) this.canvas.style.display = 'none';
      this._reset();
    }
    return this.active;
  },

  _reset() {
    this.prevPinch   = null;
    this.prevSpread  = null;
    this._smoothed   = [null, null];
    this._pinchActive = false;
    this._fistFrames  = 0;
  },

  // ── EMA smoothing ──────────────────────────────────────────────────────────
  _smooth(raw, idx) {
    const a = this._ALPHA;
    if (!this._smoothed[idx] || this._smoothed[idx].length !== raw.length) {
      // First frame: initialise with raw values (deep copy)
      this._smoothed[idx] = raw.map(p => ({ x: p.x, y: p.y, z: p.z }));
      return this._smoothed[idx];
    }
    const s = this._smoothed[idx];
    for (let i = 0; i < raw.length; i++) {
      s[i].x = a * s[i].x + (1 - a) * raw[i].x;
      s[i].y = a * s[i].y + (1 - a) * raw[i].y;
      s[i].z = a * s[i].z + (1 - a) * raw[i].z;
    }
    return s;
  },

  // ── Main result handler ────────────────────────────────────────────────────
  _onResults(results) {
    // Always redraw hand preview
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      if (this.ctx) this._reset();
      return;
    }

    const raw = results.multiHandLandmarks;

    // Draw skeleton on preview canvas for each detected hand
    if (this.ctx) {
      raw.forEach((lm, i) => this._drawSkeleton(lm));
    }

    // Smooth each hand separately
    const hands = raw.map((lm, i) => this._smooth(lm, i));

    if (hands.length === 1) {
      this._handleSingleHand(hands[0]);
      this.prevSpread = null;
    } else {
      this._handleTwoHands(hands[0], hands[1]);
      // Release single-hand state when two hands detected
      this.prevPinch    = null;
      this._pinchActive = false;
      this._fistFrames  = 0;
    }
  },

  // ── Single-hand: pinch→pan  +  fist→reset ─────────────────────────────────
  _handleSingleHand(lm) {
    const thumb = lm[4], index = lm[8];
    const dist  = this._dist3(thumb, index);

    // Hysteresis: avoid flickering at the pinch boundary
    if (!this._pinchActive && dist < this._PINCH_CLOSE) this._pinchActive = true;
    if ( this._pinchActive && dist > this._PINCH_OPEN)  { this._pinchActive = false; this.prevPinch = null; }

    if (this._pinchActive) {
      const cx = (thumb.x + index.x) / 2;
      const cy = (thumb.y + index.y) / 2;

      if (this.prevPinch && Brain3D.controls) {
        const dx = cx - this.prevPinch.x;
        const dy = cy - this.prevPinch.y;
        const DEAD = 0.004; // ignore micro-jitter
        if (Math.abs(dx) > DEAD || Math.abs(dy) > DEAD) {
          Brain3D.controls.target.x -= dx * 3.2;
          Brain3D.controls.target.y += dy * 3.2; // screen Y is inverted vs world Y
          Brain3D.controls.update();
        }
      }
      this.prevPinch = { x: cx, y: cy };
    }

    // Fist: require sustained gesture across multiple frames to avoid false triggers
    if (this._isFist(lm)) {
      this._fistFrames++;
      if (this._fistFrames >= this._FIST_FRAMES_REQ && Brain3D.controls) {
        Brain3D.controls.target.set(0, 0, 0);
        Brain3D.controls.reset();
        this._fistFrames = 0;
      }
    } else {
      this._fistFrames = 0;
    }
  },

  // ── Two-hand: palm spread/close → zoom ────────────────────────────────────
  _handleTwoHands(h1, h2) {
    // Use 2-D palm-centre distance (x+y only — more stable than including z)
    const p1 = this._palmCenter(h1);
    const p2 = this._palmCenter(h2);
    const spread = this._dist2(p1, p2);

    if (this.prevSpread !== null) {
      const delta = spread - this.prevSpread;
      const DEAD  = 0.006; // ignore noise
      if (Math.abs(delta) > DEAD && Brain3D.camera && Brain3D.controls) {
        const cam    = Brain3D.camera;
        const target = Brain3D.controls.target;
        const dir    = cam.position.clone().sub(target);
        const dist   = dir.length();
        // Palms apart → zoom in (smaller dist); palms together → zoom out
        const newDist = Math.max(2, Math.min(8, dist - delta * 8));
        cam.position.copy(target).addScaledVector(dir.normalize(), newDist);
        Brain3D.controls.update();
      }
    }
    this.prevSpread = spread;
  },

  // ── Helpers ────────────────────────────────────────────────────────────────
  _palmCenter(lm) {
    // Average wrist (0) and middle-finger MCP (9)
    return { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
  },

  _isFist(lm) {
    // All four fingertips below their base MCPs (in screen-Y = down)
    const tips = [8, 12, 16, 20];
    const mcps = [5,  9, 13, 17];
    return tips.every((t, i) => lm[t].y > lm[mcps[i]].y);
  },

  _dist3(a, b) {
    return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
  },

  _dist2(a, b) {
    return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2);
  },

  // ── Hand skeleton preview ──────────────────────────────────────────────────
  _drawSkeleton(lm) {
    if (!this.ctx || !this.canvas) return;
    const W = this.canvas.width, H = this.canvas.height;
    const px = (p) => p.x * W;
    const py = (p) => p.y * H;

    const bones = [
      [0,1],[1,2],[2,3],[3,4],         // thumb
      [0,5],[5,6],[6,7],[7,8],         // index
      [0,9],[9,10],[10,11],[11,12],     // middle
      [0,13],[13,14],[14,15],[15,16],   // ring
      [0,17],[17,18],[18,19],[19,20],   // pinky
      [5,9],[9,13],[13,17],            // palm knuckles
    ];

    // Bones
    this.ctx.strokeStyle = 'rgba(139,92,246,0.65)';
    this.ctx.lineWidth   = 1.2;
    this.ctx.lineCap     = 'round';
    for (const [a, b] of bones) {
      this.ctx.beginPath();
      this.ctx.moveTo(px(lm[a]), py(lm[a]));
      this.ctx.lineTo(px(lm[b]), py(lm[b]));
      this.ctx.stroke();
    }

    // Joints
    for (const p of lm) {
      this.ctx.beginPath();
      this.ctx.arc(px(p), py(p), 2.8, 0, Math.PI * 2);
      this.ctx.fillStyle = '#a78bfa';
      this.ctx.fill();
    }

    // Highlight pinch fingers
    for (const tip of [4, 8]) {
      this.ctx.beginPath();
      this.ctx.arc(px(lm[tip]), py(lm[tip]), 4, 0, Math.PI * 2);
      this.ctx.fillStyle = this._pinchActive ? '#f43f5e' : '#c4b5fd';
      this.ctx.fill();
    }
  },
};
