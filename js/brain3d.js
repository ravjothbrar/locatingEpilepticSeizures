const Brain3D = {
  scene: null, camera: null, renderer: null, controls: null,
  brainMesh: null, headMesh: null, electrodes: [], ezHotspot: null, ezGlow: null,
  electrodeLabels: [],
  container: null, raycaster: null, mouse: null,
  tooltip: null, mniCoords: null, electrodeNames: null,
  clock: null, _ezDepthRatio: 0,

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
      depthWrite: false,
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

  // --- Transparent head outline (skull + neck + shoulders) ---
  _createHead() {
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0x9aaac8,
      transparent: true,
      opacity: 0.13,
      roughness: 0.4,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x99aadd,
      transparent: true,
      opacity: 0.22,
    });

    // ── 1. Skull ──────────────────────────────────────────────────────────────
    const skullGeo = new THREE.SphereGeometry(1, 64, 48);
    const sp = skullGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      let x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);

      x *= 1.22; y *= 1.45; z *= 1.15;

      // Forehead bulge (anterior+superior)
      const front = Math.max(0, (y - 0.55) / 0.8);
      z += front * 0.14;

      // Chin/jaw
      if (z < -0.28 && y > 0.1) {
        const jf = Math.max(0, -z - 0.28) * Math.max(0, y - 0.1) * 0.7;
        z -= jf * 0.55; x *= 1 - jf * 0.28;
      }
      if (z < -0.55) { const nf = Math.max(0, -z - 0.55) * 0.5; x *= 1 - nf * 0.38; }
      if (z < -0.85 && y > 0.15) { y += Math.max(0, -z - 0.85) * 0.25; }

      // Posterior round
      if (y < -0.82) { y -= Math.max(0, -y - 0.82) * 0.08; }

      sp.setXYZ(i, x, y, z);
    }
    skullGeo.computeVertexNormals();

    this.headMesh = new THREE.Mesh(skullGeo, headMat);
    this.scene.add(this.headMesh);
    this.scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(skullGeo, 18), wireMat.clone()));

    // ── 2. Neck ───────────────────────────────────────────────────────────────
    // Extends in -Z (inferior) from bottom of skull, slightly anterior (y>0)
    const neckGeo = new THREE.CylinderGeometry(0.20, 0.24, 0.55, 20);
    neckGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    // Position: inferior to skull base, slightly forward
    const neck = new THREE.Mesh(neckGeo, headMat.clone());
    neck.position.set(0, 0.12, -1.22);
    this.scene.add(neck);
    const neckWire = new THREE.LineSegments(new THREE.EdgesGeometry(neckGeo, 25), wireMat.clone());
    neckWire.position.copy(neck.position);
    this.scene.add(neckWire);

    // ── 3. Shoulders (truncated cone — wider at bottom) ────────────────────
    const shoulderGeo = new THREE.CylinderGeometry(0.72, 0.88, 0.28, 24);
    shoulderGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const shoulder = new THREE.Mesh(shoulderGeo, headMat.clone());
    shoulder.position.set(0, 0.04, -1.64);
    this.scene.add(shoulder);
    const shoulderWire = new THREE.LineSegments(new THREE.EdgesGeometry(shoulderGeo, 20), wireMat.clone());
    shoulderWire.position.copy(shoulder.position);
    this.scene.add(shoulderWire);

    // ── 4. Chest cap (flat disc at base of shoulders) ─────────────────────
    const chestGeo = new THREE.CylinderGeometry(0.88, 0.92, 0.08, 24);
    chestGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const chest = new THREE.Mesh(chestGeo, headMat.clone());
    chest.position.set(0, 0.02, -1.84);
    this.scene.add(chest);
    const chestWire = new THREE.LineSegments(new THREE.EdgesGeometry(chestGeo, 20), wireMat.clone());
    chestWire.position.copy(chest.position);
    this.scene.add(chestWire);
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

    // Compute depth: cast ray from sphere outward, measure distance to brain surface
    // depthRatio = 0 means at surface, 1 means very deep inside
    this._ezDepthRatio = 0;
    if (this.brainMesh) {
      const outDir = pos.clone().normalize();
      if (outDir.length() < 0.001) outDir.set(0, 0, 1);
      const raycaster = new THREE.Raycaster(pos, outDir);
      const hits = raycaster.intersectObject(this.brainMesh, false);
      if (hits.length > 0) {
        // Distance from sphere to brain surface along outward ray
        const distToSurface = hits[0].distance;
        // Brain surface radius is roughly 1.0-1.4 scene units from center
        this._ezDepthRatio = Math.min(1, distToSurface / 1.3);
      }
    }

    // Base opacity/emissive scaled by depth — then reduced 25% across the board
    const depthR = this._ezDepthRatio;
    const baseOpacity = (0.82 - depthR * 0.60) * 0.75;   // surface→0.615, deep→0.165
    const baseEmissive = (0.75 - depthR * 0.58) * 0.75;  // surface→0.563, deep→0.128

    // 3D sphere core
    const coreGeo = new THREE.SphereGeometry(radius, 24, 18);
    const coreMat = new THREE.MeshPhongMaterial({
      color: 0xff2200,
      emissive: 0xff3300,
      emissiveIntensity: baseEmissive,
      shininess: 60,
      transparent: true,
      opacity: baseOpacity,
      depthTest: false,
    });
    this.ezHotspot = new THREE.Mesh(coreGeo, coreMat);
    this.ezHotspot.position.copy(pos);
    this.ezHotspot.renderOrder = 10;
    this.scene.add(this.ezHotspot);

    // Pulsing glow aura — slightly larger at depth to simulate light scattering through tissue
    const glowRadius = radius * (3 + depthR * 1.5);
    const glowGeo = new THREE.SphereGeometry(glowRadius, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.0,
      depthTest: false,
    });
    this.ezGlow = new THREE.Mesh(glowGeo, glowMat);
    this.ezGlow.position.copy(pos);
    this.ezGlow.renderOrder = 9;
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
      // Depth-based pulsing: deeper = dimmer at rest but bigger pulse
      const depth = this._ezDepthRatio;
      const baseOpacity  = (0.82 - depth * 0.60) * 0.75;
      const baseEmissive = (0.75 - depth * 0.58) * 0.75;
      const pulseAmp     = (0.18 + depth * 0.65) * 0.75; // scaled 25% too

      const cycle = elapsed % 1.7;
      let pulse = 0;
      if (cycle < 0.7) {
        pulse = Math.sin((cycle / 0.7) * Math.PI);
      }

      this.ezHotspot.material.emissiveIntensity = baseEmissive + pulse * (1.2 + depth * 0.6);
      this.ezHotspot.material.opacity = Math.min(1, baseOpacity + pulse * pulseAmp);
      // Glow aura: subtle at surface, more visible when deep (light through tissue)
      this.ezGlow.material.opacity = (depth * 0.08) + pulse * (0.22 + depth * 0.18);
      this.ezGlow.scale.setScalar(1 + pulse * 0.45);
    }

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
