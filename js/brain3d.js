const Brain3D = {
  scene: null, camera: null, renderer: null, controls: null,
  brainMesh: null, electrodes: [], ezHotspot: null, ezGlow: null,
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
    // Real brain proportions: ~17cm AP, ~14cm lateral, ~13cm SI
    // Normalized: AP=1.3, lateral=1.07, SI=1.0
    const geo = new THREE.SphereGeometry(1, 96, 72);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

      // Base ellipsoid — real brain proportions (y=AP, x=lateral, z=SI)
      y *= 1.3;
      x *= 1.07;
      z *= 1.0;

      // --- Cerebrum shape: frontal pole curves down, occipital is rounder ---

      // Frontal pole: narrows laterally and curves downward
      const frontness = Math.max(0, (y - 0.5) / 0.8); // 0 at center, 1 at front
      x *= 1 - frontness * 0.2;
      z -= frontness * frontness * 0.15; // frontal lobe curves down

      // Occipital region: slightly pointed at back
      const backness = Math.max(0, (-y - 0.7) / 0.6);
      x *= 1 - backness * 0.15;
      z += backness * 0.05; // occipital slightly higher

      // --- Flatten the base (inferior surface) ---
      if (z < -0.35) z = -0.35 + (z + 0.35) * 0.2;

      // --- Interhemispheric fissure (deep midline split on top) ---
      const fissureStrength = 0.2 * Math.exp(-x * x / (2 * 0.04 * 0.04));
      const topness = Math.max(0, z * 2.0);
      z -= fissureStrength * topness;

      // --- Temporal lobe: prominent bulge below Sylvian fissure ---
      const absX = Math.abs(x);
      // Temporal lobe extends forward and down on lateral sides
      if (absX > 0.25 && z < 0.1 && y > -0.4) {
        const temporalBulge = 0.1 * Math.exp(-((z + 0.15) * (z + 0.15)) * 8)
                                   * Math.exp(-((absX - 0.7) * (absX - 0.7)) * 3)
                                   * (1 - Math.max(0, -y - 0.2) * 2);
        const r = Math.sqrt(x * x + z * z) || 1;
        x += (x / r) * temporalBulge * 0.5;
        z -= temporalBulge * 0.3;
      }

      // Temporal pole: pointed forward extension
      if (absX > 0.4 && z < -0.1 && y > 0.2) {
        y += 0.08 * Math.exp(-((z + 0.2) * (z + 0.2)) * 10) * Math.exp(-((absX - 0.6) * (absX - 0.6)) * 5);
      }

      // --- Sylvian fissure: deep lateral groove separating temporal from frontal/parietal ---
      const sylvianDepth = 0.035 * Math.max(0, absX - 0.3)
                                  * Math.exp(-((z + 0.02) * (z + 0.02)) * 25)
                                  * Math.exp(-((y - 0.15) * (y - 0.15)) * 1.5);

      // --- Central sulcus: diagonal groove separating frontal from parietal ---
      const centralDepth = 0.025 * Math.max(0, z)
                                  * Math.exp(-((y - 0.1 + absX * 0.3) * (y - 0.1 + absX * 0.3)) * 40);

      // --- Pre/postcentral and other major sulci ---
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      const theta = Math.atan2(x, y);
      const phi = Math.acos(Math.min(1, Math.max(-1, z / r)));

      // Gyri: multi-scale cortical folds
      const g1 = Math.sin(theta * 7 + phi * 5) * 0.02;
      const g2 = Math.sin(theta * 13 + phi * 9 + 1.7) * 0.013;
      const g3 = Math.sin(theta * 21 + phi * 16 + 3.1) * 0.007;
      const g4 = Math.sin(x * 16 + y * 11 + z * 14) * 0.009;
      const g5 = Math.cos(x * 23 + y * 18 - z * 12 + 0.8) * 0.005;
      const g6 = Math.sin(theta * 30 + phi * 25 + 0.3) * 0.004;
      const gyri = g1 + g2 + g3 + g4 + g5 + g6;

      // Apply all deformations along surface normal
      const totalDeform = gyri - sylvianDepth - centralDepth;
      x += (x / r) * totalDeform;
      y += (y / r) * totalDeform;
      z += (z / r) * totalDeform;

      // --- Brainstem hint: small downward extension at posterior-inferior ---
      if (y < -0.5 && z < -0.2) {
        const stemFactor = Math.exp(-((y + 0.9) * (y + 0.9)) * 8) * Math.exp(-((z + 0.4) * (z + 0.4)) * 6);
        z -= stemFactor * 0.15;
        x *= 1 - stemFactor * 0.4;
      }

      pos.setXYZ(i, x, y, z);

      // Vertex colors: pinkish cortex with red-tinted gyri, darker sulci
      const sulcusAmount = Math.max(0, -(totalDeform) * 15);
      // Base cortex: warm pinkish (like reference image)
      let cr = 0.85 - sulcusAmount * 0.15;
      let cg = 0.62 - sulcusAmount * 0.2;
      let cb = 0.65 - sulcusAmount * 0.12;

      // Regional tinting:
      // Frontal lobe: slightly pinker
      if (y > 0.3 && z > -0.1) { cr += 0.04; cg -= 0.02; }
      // Temporal lobe: slightly redder
      if (absX > 0.4 && z < 0.05) { cr += 0.06; cg -= 0.04; cb -= 0.03; }
      // Parietal: slightly lighter
      if (z > 0.3) { cr += 0.02; cg += 0.02; cb += 0.03; }

      // Subtle cortex variation
      const hueNoise = Math.sin(theta * 4 + phi * 3) * 0.03;
      colors[i * 3] = Math.max(0.35, Math.min(1, cr + hueNoise));
      colors[i * 3 + 1] = Math.max(0.25, Math.min(0.9, cg - hueNoise * 0.3));
      colors[i * 3 + 2] = Math.max(0.3, Math.min(0.9, cb + hueNoise * 0.2));
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transparent: false,
      roughness: 0.82,
      metalness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: true,
      clearcoat: 0.08,
      clearcoatRoughness: 0.85,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    // Very subtle wireframe
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.02 })
    );
    this.scene.add(wire);
  },

  setElectrodes(mniCoords, names) {
    this.mniCoords = mniCoords;
    this.electrodeNames = names;

    this.electrodes.forEach(e => this.scene.remove(e));
    this.electrodes = [];

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
    });
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
    const radius = Math.max(0.05, Math.min(0.4, coord.sigma * 0.3));

    const coreGeo = new THREE.SphereGeometry(radius, 24, 16);
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2200,
      emissive: 0xff4400,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.85,
      roughness: 0.2,
    });
    this.ezHotspot = new THREE.Mesh(coreGeo, coreMat);
    this.ezHotspot.position.copy(pos);
    this.scene.add(this.ezHotspot);

    const glowGeo = new THREE.SphereGeometry(radius * 2.5, 16, 12);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
    });
    this.ezGlow = new THREE.Mesh(glowGeo, glowMat);
    this.ezGlow.position.copy(pos);
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

  updateEZProgress(step, totalSteps) {
    if (this.ezHotspot) {
      const p = step / totalSteps;
      this.ezHotspot.material.emissiveIntensity = 0.5 + p * 2.0;
      this.ezGlow.material.opacity = 0.04 + p * 0.12;
    }
  },

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

    if (this.ezHotspot) {
      const t = this.clock.getElapsedTime() * 3;
      this.ezHotspot.material.emissiveIntensity = 1.5 + Math.sin(t) * 0.5;
      this.ezGlow.scale.setScalar(1 + Math.sin(t * 0.7) * 0.1);
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
  }
};
