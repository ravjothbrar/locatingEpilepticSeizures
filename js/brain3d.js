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
    this.camera.position.set(0, 0, 4);

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
    const geo = new THREE.SphereGeometry(1, 80, 60);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Seeded noise function for reproducible brain folds
    const hash = (x, y, z) => {
      let h = x * 374761393 + y * 668265263 + z * 1274126177;
      h = Math.sin(h) * 43758.5453;
      return h - Math.floor(h);
    };

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

      // Brain proportions: elongated front-back, wider at sides, flatter top-bottom
      y *= 1.3;   // elongate anterior-posterior
      z *= 0.85;  // flatten superior-inferior
      x *= 1.08;  // slight lateral width

      // Interhemispheric fissure — deep midline split
      const fissureWidth = 0.06;
      const fissureDepth = 0.25 * Math.exp(-x * x / (2 * fissureWidth * fissureWidth));
      const topFactor = Math.max(0, z * 1.5); // deeper on top surface
      z -= fissureDepth * topFactor;

      // Flatten the base (inferior surface)
      if (z < -0.25) z = -0.25 + (z + 0.25) * 0.25;

      // Frontal narrowing
      const frontFactor = Math.max(0, y - 0.4) * 0.3;
      x *= (1 - frontFactor * 0.15);

      // Occipital rounding (slight protrusion at back)
      if (y < -0.6) {
        const backPush = (y + 0.6) * 0.08;
        y += backPush;
      }

      // Temporal lobe bulges (lower lateral)
      const temporalAngle = Math.atan2(z, Math.abs(x));
      if (temporalAngle < -0.3 && Math.abs(x) > 0.3) {
        const bulge = 0.06 * Math.exp(-((temporalAngle + 0.8) * (temporalAngle + 0.8)) * 4);
        const r = Math.sqrt(x * x + z * z) || 1;
        x += (x / r) * bulge;
        z += (z / r) * bulge;
      }

      // Major sulci (deep grooves) — using sine waves at brain-scale frequencies
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      const theta = Math.atan2(x, y); // azimuthal
      const phi = Math.acos(z / r);   // polar

      // Central sulcus (Rolandic fissure) — runs roughly coronal
      const centralSulcus = Math.exp(-((y - 0.05) * (y - 0.05)) * 60) *
                            Math.max(0, z) * 0.04 * Math.cos(x * 3);

      // Lateral (Sylvian) fissure — horizontal on sides
      const sylvian = Math.exp(-((z + 0.05) * (z + 0.05)) * 40) *
                      Math.max(0, Math.abs(x) - 0.3) * 0.04 *
                      Math.exp(-((y - 0.1) * (y - 0.1)) * 3);

      // Gyri folds — multi-frequency procedural displacement
      const g1 = Math.sin(theta * 8 + phi * 6) * 0.018;
      const g2 = Math.sin(theta * 14 + phi * 10 + 1.3) * 0.012;
      const g3 = Math.sin(theta * 22 + phi * 18 + 2.7) * 0.006;
      const g4 = Math.sin(x * 18 + y * 12 + z * 15) * 0.008;
      const g5 = Math.cos(x * 25 + y * 20 - z * 10 + 0.5) * 0.005;
      const gyri = g1 + g2 + g3 + g4 + g5;

      // Apply sulci (inward) and gyri (in/out along normal)
      const sulcusTotal = centralSulcus + sylvian;
      x += (x / r) * (gyri - sulcusTotal);
      y += (y / r) * (gyri - sulcusTotal);
      z += (z / r) * (gyri - sulcusTotal);

      pos.setXYZ(i, x, y, z);

      // Vertex colors: pinkish-purple cortex with subtle variation in sulci
      const depth = gyri - sulcusTotal; // negative = sulcus
      const sulcusDarkness = Math.max(0, -depth * 12);
      const baseR = 0.82 - sulcusDarkness * 0.2;
      const baseG = 0.68 - sulcusDarkness * 0.25;
      const baseB = 0.78 - sulcusDarkness * 0.15;
      // Slight hue variation across cortex
      const hueShift = Math.sin(theta * 3 + phi * 2) * 0.04;
      colors[i * 3] = Math.max(0.4, Math.min(1, baseR + hueShift));
      colors[i * 3 + 1] = Math.max(0.3, Math.min(1, baseG - hueShift * 0.5));
      colors[i * 3 + 2] = Math.max(0.4, Math.min(1, baseB + hueShift * 0.3));
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Solid cortex material with vertex colors for realistic shading
    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      roughness: 0.85,
      metalness: 0.02,
      side: THREE.DoubleSide,
      depthWrite: true,
      clearcoat: 0.1,
      clearcoatRoughness: 0.8,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    // Subtle purple wireframe overlay for the tech aesthetic
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.03 })
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
      mni[0] / 55 * 1.05,
      mni[1] / 60 * 1.25,
      mni[2] / 55 * 0.88
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
