/**
 * MediaPipe Hands integration for spatial interaction.
 * Controls the 3D brain via webcam hand gestures.
 */

const HandTracker = {
  hands: null,
  camera: null,
  video: null,
  canvas: null,
  ctx: null,
  active: false,

  // Gesture state
  prevPinch: null,
  prevPan: null,
  azimuth: 0,
  elevation: 20,
  distance: 4,

  async init() {
    // Create video element for webcam
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.style.display = 'none';
    document.body.appendChild(this.video);

    // Mini preview canvas
    this.canvas = document.getElementById('hand-preview');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }

    try {
      // Load MediaPipe Hands
      this.hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
      });

      this.hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5
      });

      this.hands.onResults((results) => this._onResults(results));

      this.camera = new Camera(this.video, {
        onFrame: async () => {
          if (this.active) await this.hands.send({ image: this.video });
        },
        width: 320,
        height: 240
      });

      console.log('Hand tracking initialized');
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
    // Draw preview
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(results.image, 0, 0, this.canvas.width, this.canvas.height);

      if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
          this._drawHand(landmarks);
        }
      }
    }

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      this.prevPinch = null;
      this.prevPan = null;
      return;
    }

    const hands = results.multiHandLandmarks;

    if (hands.length === 1) {
      this._handleSingleHand(hands[0]);
    } else if (hands.length === 2) {
      this._handleTwoHands(hands[0], hands[1]);
    }

    Brain3D.setCamera(this.azimuth, this.elevation, this.distance);
  },

  _handleSingleHand(landmarks) {
    const thumb = landmarks[4];
    const index = landmarks[8];
    const pinchDist = this._dist(thumb, index);

    // Pinch gesture → rotate
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

    // Fist detection → reset
    const fist = this._isFist(landmarks);
    if (fist) {
      this.azimuth = 0;
      this.elevation = 20;
      this.distance = 4;
    }
  },

  _handleTwoHands(hand1, hand2) {
    // Two-hand pinch distance → zoom
    const center1 = hand1[8];
    const center2 = hand2[8];
    const dist = this._dist(center1, center2);

    if (this.prevPan) {
      const delta = dist - this.prevPan;
      this.distance = Math.max(2, Math.min(8, this.distance - delta * 10));
    }
    this.prevPan = dist;
    this.prevPinch = null;
  },

  _isFist(landmarks) {
    // All fingertips below their MCP joints
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    let fist = true;
    for (let i = 0; i < tips.length; i++) {
      if (landmarks[tips[i]].y < landmarks[mcps[i]].y) fist = false;
    }
    return fist;
  },

  _dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  },

  _drawHand(landmarks) {
    if (!this.ctx) return;
    this.ctx.fillStyle = '#00ff88';
    for (const lm of landmarks) {
      this.ctx.beginPath();
      this.ctx.arc(lm.x * this.canvas.width, lm.y * this.canvas.height, 3, 0, 2 * Math.PI);
      this.ctx.fill();
    }
  }
};
