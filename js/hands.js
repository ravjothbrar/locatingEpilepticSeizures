const HandTracker = {
  hands: null,
  camera: null,
  video: null,
  canvas: null,
  ctx: null,
  active: false,
  prevPinch: null,
  prevSpread: null,
  azimuth: 0,
  elevation: 20,
  distance: 4,

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
        minTrackingConfidence: 0.5
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
      Brain3D.controls.enabled = false;
    } else {
      this.camera.stop();
      if (this.canvas) this.canvas.style.display = 'none';
      Brain3D.controls.enabled = true;
    }
    return this.active;
  },

  _onResults(results) {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);
      if (results.multiHandLandmarks) {
        for (const lm of results.multiHandLandmarks) this._drawHand(lm);
      }
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.prevPinch = null;
      this.prevSpread = null;
      return;
    }

    const hands = results.multiHandLandmarks;

    if (hands.length === 1) {
      this._handleSingleHand(hands[0]);
      this.prevSpread = null;
    } else if (hands.length === 2) {
      this._handleTwoHands(hands[0], hands[1]);
      this.prevPinch = null;
    }

    Brain3D.setCamera(this.azimuth, this.elevation, this.distance);
  },

  _handleSingleHand(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const pinchDist = this._dist(thumb, index);

    if (pinchDist < 0.08) {
      const center = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
      if (this.prevPinch) {
        const dx = (center.x - this.prevPinch.x) * 300;
        const dy = (center.y - this.prevPinch.y) * 200;
        this.azimuth += dx;
        this.elevation = Math.max(-80, Math.min(80, this.elevation - dy));
      }
      this.prevPinch = center;
    } else {
      this.prevPinch = null;
    }

    if (this._isFist(landmarks)) {
      this.azimuth = 0;
      this.elevation = 20;
      this.distance = 4;
    }
  },

  _handleTwoHands(hand1, hand2) {
    // Use palm centers (wrist=0 and middle finger MCP=9 midpoint)
    const palm1 = this._palmCenter(hand1);
    const palm2 = this._palmCenter(hand2);

    // Horizontal distance between palms (x-axis spread)
    const spread = Math.abs(palm1.x - palm2.x);

    if (this.prevSpread !== null) {
      const delta = spread - this.prevSpread;
      // Palms apart (spread increases) → zoom IN (decrease distance)
      // Palms together (spread decreases) → zoom OUT (increase distance)
      this.distance = Math.max(2, Math.min(8, this.distance - delta * 12));
    }
    this.prevSpread = spread;
  },

  _palmCenter(landmarks) {
    const w = landmarks[0];  // wrist
    const m = landmarks[9];  // middle finger MCP
    return { x: (w.x + m.x) / 2, y: (w.y + m.y) / 2 };
  },

  _isFist(landmarks) {
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    return tips.every((t, i) => landmarks[t].y > landmarks[mcps[i]].y);
  },

  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  },

  _drawHand(landmarks) {
    if (!this.ctx) return;
    this.ctx.fillStyle = '#8b5cf6';
    for (const lm of landmarks) {
      this.ctx.beginPath();
      this.ctx.arc(lm.x * this.canvas.width, lm.y * this.canvas.height, 2.5, 0, 2 * Math.PI);
      this.ctx.fill();
    }
  }
};
