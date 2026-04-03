const Brain3D = {
  scene: null, camera: null, renderer: null, controls: null,
  brainMesh: null, headMesh: null, electrodes: [], ezHotspot: null, ezGlow: null,
  electrodeLabels: [], floatingLabels: [],
  container: null, raycaster: null, mouse: null,
  tooltip: null, mniCoords: null, electrodeNames: null,
  clock: null,

  init(containerId) {
    this.container = document.getElementById(containerId);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06060e);
    this.scene.fog = new THREE.Fog(0x06060e, 8, 18);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 50);
    this.camera.position.set(0, 0, 5.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;
    this.controls.maxDistance = 8;
    this.controls.minDistance = 2;

    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
    const dir1 = new THREE.DirectionalLight(0xfff5ee, 1.0);
    dir1.position.set(5, 6, 5);
    const dir2 = new THREE.DirectionalLight(0x8b5cf6, 0.35);
    dir2.position.set(-5, -3, -5);
    const dir3 = new THREE.DirectionalLight(0xffe0e0, 0.25);
    dir3.position.set(-3, 4, 2);
    this.scene.add(dir1, dir2, dir3);

    this._createBrain();
    this._createHead();
    this._createFloatingLabels();

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.tooltip = document.getElementById('tooltip');
    this.clock = new THREE.Clock();

    this.renderer.domElement.addEventListener('click', e => this._onClick(e));
    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false;
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this._onResize(), 100);
    });

    this._animate();
    return this;
  },

  _createBrain() {
    const geo = new THREE.SphereGeometry(1, 96, 72);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

      y *= 1.3; x *= 1.07; z *= 1.0;

      const frontness = Math.max(0, (y - 0.5) / 0.8);
      x *= 1 - frontness * 0.2;
      z -= frontness * frontness * 0.15;

      const backness = Math.max(0, (-y - 0.7) / 0.6);
      x *= 1 - backness * 0.15;
      z += backness * 0.05;

      if (z < -0.35) z = -0.35 + (z + 0.35) * 0.2;

      const fissureStrength = 0.2 * Math.exp(-x * x / (2 * 0.04 * 0.04));
      const topness = Math.max(0, z * 2.0);
      z -= fissureStrength * topness;

      const absX = Math.abs(x);
      if (absX > 0.25 && z < 0.1 && y > -0.4) {
        const temporalBulge = 0.1 * Math.exp(-((z + 0.15) * (z + 0.15)) * 8)
                                   * Math.exp(-((absX - 0.7) * (absX - 0.7)) * 3)
                                   * (1 - Math.max(0, -y - 0.2) * 2);
        const r2 = Math.sqrt(x * x + z * z) || 1;
        x += (x / r2) * temporalBulge * 0.5;
        z -= temporalBulge * 0.3;
      }

      if (absX > 0.4 && z < -0.1 && y > 0.2) {
        y += 0.08 * Math.exp(-((z + 0.2) * (z + 0.2)) * 10) * Math.exp(-((absX - 0.6) * (absX - 0.6)) * 5);
      }

      const sylvianDepth = 0.035 * Math.max(0, absX - 0.3)
                                  * Math.exp(-((z + 0.02) * (z + 0.02)) * 25)
                                  * Math.exp(-((y - 0.15) * (y - 0.15)) * 1.5);

      const centralDepth = 0.025 * Math.max(0, z)
                                  * Math.exp(-((y - 0.1 + absX * 0.3) * (y - 0.1 + absX * 0.3)) * 40);

      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      const theta = Math.atan2(x, y);
      const phi = Math.acos(Math.min(1, Math.max(-1, z / r)));

      const g1 = Math.sin(theta * 7 + phi * 5) * 0.02;
      const g2 = Math.sin(theta * 13 + phi * 9 + 1.7) * 0.013;
      const g3 = Math.sin(theta * 21 + phi * 16 + 3.1) * 0.007;
      const g4 = Math.sin(x * 16 + y * 11 + z * 14) * 0.009;
      const g5 = Math.cos(x * 23 + y * 18 - z * 12 + 0.8) * 0.005;
      const g6 = Math.sin(theta * 30 + phi * 25 + 0.3) * 0.004;
      const gyri = g1 + g2 + g3 + g4 + g5 + g6;

      const totalDeform = gyri - sylvianDepth - centralDepth;
      x += (x / r) * totalDeform;
      y += (y / r) * totalDeform;
      z += (z / r) * totalDeform;

      if (y < -0.5 && z < -0.2) {
        const stemFactor = Math.exp(-((y + 0.9) * (y + 0.9)) * 8) * Math.exp(-((z + 0.4) * (z + 0.4)) * 6);
        z -= stemFactor * 0.15;
        x *= 1 - stemFactor * 0.4;
      }

      pos.setXYZ(i, x, y, z);

      const sulcusAmount = Math.max(0, -(totalDeform) * 15);
      let cr = 0.85 - sulcusAmount * 0.15;
      let cg = 0.62 - sulcusAmount * 0.2;
      let cb = 0.65 - sulcusAmount * 0.12;

      if (y > 0.3 && z > -0.1) { cr += 0.04; cg -= 0.02; }
      if (absX > 0.4 && z < 0.05) { cr += 0.06; cg -= 0.04; cb -= 0.03; }
      if (z > 0.3) { cr += 0.02; cg += 0.02; cb += 0.03; }

      const hueNoise = Math.sin(theta * 4 + phi * 3) * 0.03;
      colors[i * 3] = Math.max(0.35, Math.min(1, cr + hueNoise));
      colors[i * 3 + 1] = Math.max(0.25, Math.min(0.9, cg - hueNoise * 0.3));
      colors[i * 3 + 2] = Math.max(0.3, Math.min(0.9, cb + hueNoise * 0.2));
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: true,
      clearcoat: 0.08,
      clearcoatRoughness: 0.85,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.02 })
    );
    this.scene.add(wire);
  },

  // --- Transparent head outline ---
  _createHead() {
    const geo = new THREE.SphereGeometry(1, 64, 48);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

      // Skull shape: slightly larger than brain, rounder
      x *= 1.22;
      y *= 1.45;
      z *= 1.15;

      // Forehead: bulges forward and up
      const front = Math.max(0, (y - 0.6) / 0.8);
      z += front * 0.15;

      // Chin/jaw: extends downward at front
      if (z < -0.3 && y > 0) {
        const jawFactor = Math.max(0, -z - 0.3) * Math.max(0, y) * 0.8;
        z -= jawFactor * 0.6;
        x *= 1 - jawFactor * 0.3;
        y += jawFactor * 0.1;
      }

      // Narrow jaw
      if (z < -0.5) {
        const narrowFactor = Math.max(0, -z - 0.5) * 0.5;
        x *= 1 - narrowFactor * 0.4;
      }

      // Chin point
      if (z < -0.8 && y > 0.2) {
        y += Math.max(0, -z - 0.8) * 0.3;
      }

      // Nose bump
      if (y > 0.8 && z > -0.4 && z < 0.1 && Math.abs(x) < 0.15) {
        const noseFactor = Math.exp(-x * x * 80) * Math.exp(-((z + 0.15) * (z + 0.15)) * 8);
        y += noseFactor * 0.2;
      }

      // Back of head: rounder
      if (y < -0.8) {
        const backRound = Math.max(0, -y - 0.8) * 0.1;
        y -= backRound;
      }

      // Neck: narrow cylinder below
      if (z < -0.9) {
        const neckFactor = Math.max(0, -z - 0.9) * 0.4;
        x *= Math.max(0.3, 1 - neckFactor);
        y *= Math.max(0.3, 1 - neckFactor * 0.7);
      }

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x8899bb,
      transparent: true,
      opacity: 0.08,
      roughness: 0.5,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.headMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.headMesh);

    // Head outline wireframe
    const wireGeo = new THREE.EdgesGeometry(geo, 15);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x8899cc,
      transparent: true,
      opacity: 0.12,
    });
    const wireframe = new THREE.LineSegments(wireGeo, wireMat);
    this.scene.add(wireframe);
    this._headWire = wireframe;
  },

  // --- Floating labels inside brain ---
  _createFloatingLabels() {
    const labels = [
      { text: 'Na+', pos: [0.3, 0.4, 0.3] },
      { text: 'K+', pos: [-0.35, -0.3, 0.2] },
      { text: 'dV/dt', pos: [0.0, 0.2, 0.5] },
      { text: 'Ca2+', pos: [-0.2, 0.5, -0.1] },
      { text: 'Cl-', pos: [0.4, -0.4, 0.0] },
      { text: 'HH', pos: [0.0, -0.5, 0.3] },
      { text: 'gNa', pos: [-0.4, 0.2, 0.4] },
      { text: 'gK', pos: [0.3, -0.1, -0.2] },
      { text: 'I_m', pos: [0.15, 0.6, 0.1] },
      { text: 'dm/dt', pos: [-0.3, -0.1, 0.45] },
      { text: 'E_Na', pos: [0.25, -0.5, 0.15] },
      { text: 'E_K', pos: [-0.15, 0.35, -0.15] },
    ];

    labels.forEach(l => {
      const sprite = this._makeLabel(l.text, '#ffffff', 0.3);
      sprite.position.set(l.pos[0], l.pos[1], l.pos[2]);
      sprite.userData = { basePos: l.pos.slice(), drift: Math.random() * Math.PI * 2 };
      this.scene.add(sprite);
      this.floatingLabels.push(sprite);
    });
  },

  setElectrodes(mniCoords, names) {
    this.mniCoords = mniCoords;
    this.electrodeNames = names;

    this.electrodes.forEach(e => this.scene.remove(e));
    this.electrodeLabels.forEach(l => this.scene.remove(l));
    this.electrodes = [];
    this.electrodeLabels = [];

    const geo = new THREE.SphereGeometry(0.04, 12, 8);

    mniCoords.forEach((mni, idx) => {
      const pos = this._mniToScene(mni);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x8b5cf6,
        emissive: 0x2d1b69,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { index: idx, name: names[idx], mni };
      this.scene.add(mesh);
      this.electrodes.push(mesh);

      const label = this._makeLabel(names[idx], '#c4b5fd', 0.85);
      const dir = pos.clone().normalize();
      label.position.copy(pos).add(dir.multiplyScalar(0.15));
      this.scene.add(label);
      this.electrodeLabels.push(label);
    });
  },

  _makeLabel(text, color, opacity) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 32;
    ctx.font = 'bold 18px Inter, sans-serif';
    ctx.fillStyle = color || '#c4b5fd';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 16);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: opacity !== undefined ? opacity : 0.85,
      depthTest: false,
      sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.4, 0.1, 1);
    return sprite;
  },

  _mniToScene(mni) {
    return new THREE.Vector3(
      mni[0] / 55 * 1.07,
      mni[1] / 60 * 1.3,
      mni[2] / 55 * 1.0
    );
  },

  _normToScene(nx, ny, nz, meta) {
    const mm_x = (nx + 1) / 2 * (meta.mni_max[0] - meta.mni_min[0]) + meta.mni_min[0];
    const mm_y = (ny + 1) / 2 * (meta.mni_max[1] - meta.mni_min[1]) + meta.mni_min[1];
    const mm_z = (nz + 1) / 2 * (meta.mni_max[2] - meta.mni_min[2]) + meta.mni_min[2];
    return this._mniToScene([mm_x, mm_y, mm_z]);
  },

  showEZ(coord, meta) {
    if (this.ezHotspot) this.scene.remove(this.ezHotspot);
    if (this.ezGlow) this.scene.remove(this.ezGlow);

    const pos = this._normToScene(coord.x, coord.y, coord.z, meta);
    const radius = Math.max(0.03, Math.min(0.12, coord.sigma * 0.08));

    // 3D sphere core — uses Phong material for proper 3D shading
    const coreGeo = new THREE.SphereGeometry(radius, 24, 18);
    const coreMat = new THREE.MeshPhongMaterial({
      color: 0xff2200,
      emissive: 0xff3300,
      emissiveIntensity: 0.8,
      shininess: 60,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.ezHotspot = new THREE.Mesh(coreGeo, coreMat);
    this.ezHotspot.position.copy(pos);
    this.ezHotspot.renderOrder = 999;
    this.scene.add(this.ezHotspot);

    // Pulsing glow aura
    const glowGeo = new THREE.SphereGeometry(radius * 3, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.0,
      depthTest: false,
    });
    this.ezGlow = new THREE.Mesh(glowGeo, glowMat);
    this.ezGlow.position.copy(pos);
    this.ezGlow.renderOrder = 998;
    this.scene.add(this.ezGlow);

    this.electrodes.forEach(el => {
      const dist = el.position.distanceTo(pos);
      const t = Math.min(1, dist / 2);
      const color = new THREE.Color();
      color.setHSL(t * 0.65, 0.9, 0.5);
      el.material.color.copy(color);
      el.material.emissive.copy(color).multiplyScalar(0.3);
    });
  },

  updateEZProgress(step, totalSteps) {},

  _onClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.electrodes);

    if (hits.length > 0 && this.tooltip) {
      const data = hits[0].object.userData;
      const screen = this._toScreen(hits[0].object.position);
      this.tooltip.innerHTML = `<strong>${data.name}</strong><br>MNI: (${data.mni.map(v => v.toFixed(0)).join(', ')})`;
      this.tooltip.style.left = screen.x + 'px';
      this.tooltip.style.top = (screen.y - 55) + 'px';
      this.tooltip.style.display = 'block';
      setTimeout(() => { this.tooltip.style.display = 'none'; }, 3000);
    }
  },

  _toScreen(pos) {
    const v = pos.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: -(v.y - 1) / 2 * rect.height + rect.top
    };
  },

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  _animate() {
    requestAnimationFrame(() => this._animate());
    const elapsed = this.clock.getElapsedTime();

    if (this.ezHotspot) {
      // Core always visible; glow pulses: 0.7s on, 1.0s off
      const cycle = elapsed % 1.7;
      let pulse;
      if (cycle < 0.7) {
        const t = cycle / 0.7;
        pulse = Math.sin(t * Math.PI);
      } else {
        pulse = 0;
      }
      this.ezHotspot.material.emissiveIntensity = 0.6 + pulse * 0.8;
      this.ezHotspot.material.opacity = 0.85 + pulse * 0.15;
      this.ezGlow.material.opacity = pulse * 0.3;
      this.ezGlow.scale.setScalar(1 + pulse * 0.4);
    }

    // Floating labels drift gently
    this.floatingLabels.forEach(sprite => {
      const d = sprite.userData;
      sprite.position.x = d.basePos[0] + Math.sin(elapsed * 0.3 + d.drift) * 0.03;
      sprite.position.y = d.basePos[1] + Math.cos(elapsed * 0.25 + d.drift * 1.3) * 0.03;
      sprite.position.z = d.basePos[2] + Math.sin(elapsed * 0.2 + d.drift * 0.7) * 0.02;
      sprite.material.opacity = 0.18 + Math.sin(elapsed * 0.5 + d.drift) * 0.08;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  },

  setCamera(azimuth, elevation, distance) {
    const phi = elevation * Math.PI / 180;
    const theta = azimuth * Math.PI / 180;
    this.camera.position.set(
      distance * Math.cos(phi) * Math.sin(theta),
      distance * Math.sin(phi),
      distance * Math.cos(phi) * Math.cos(theta)
    );
    this.camera.lookAt(0, 0, 0);
  },

  // Called by theme toggle to update scene background
  setTheme(isDark) {
    const bg = isDark ? 0x06060e : 0xf0eef5;
    this.scene.background.set(bg);
    this.scene.fog.color.set(bg);
  }
};
