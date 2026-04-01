/**
 * 3D brain visualization using Three.js + WebGL.
 * Procedural brain mesh with electrode positions and EZ hotspot.
 */

const Brain3D = {
  scene: null, camera: null, renderer: null, controls: null,
  brainMesh: null, electrodes: [], ezHotspot: null, ezGlow: null,
  container: null, raycaster: null, mouse: null,
  autoRotate: true, tooltip: null,
  mniCoords: null, electrodeNames: null,

  init(containerId) {
    this.container = document.getElementById(containerId);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 8, 20);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 0, 4);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;

    // Lights
    const ambient = new THREE.AmbientLight(0x404060, 0.8);
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dir1.position.set(5, 5, 5);
    const dir2 = new THREE.DirectionalLight(0x4488ff, 0.4);
    dir2.position.set(-5, -3, -5);
    this.scene.add(ambient, dir1, dir2);

    // Brain mesh
    this._createBrain();

    // Raycaster for interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Tooltip
    this.tooltip = document.getElementById('tooltip');

    // Events
    this.renderer.domElement.addEventListener('click', e => this._onClick(e));
    this.renderer.domElement.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false;
    });
    window.addEventListener('resize', () => this._onResize());

    this._animate();
    return this;
  },

  _createBrain() {
    // Procedural brain: two hemispheres with fissure and gyri
    const geo = new THREE.SphereGeometry(1, 64, 48);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      // Elongate anterior-posterior (y axis)
      y *= 1.25;

      // Slight vertical compression
      z *= 0.88;

      // Widen laterally
      x *= 1.05;

      // Longitudinal fissure
      const fissureDepth = Math.exp(-x * x * 30) * 0.18;
      z -= fissureDepth * Math.max(0, z);

      // Flatten bottom
      if (z < -0.3) z = -0.3 + (z + 0.3) * 0.3;

      // Gyri/sulci bumps
      const freq1 = Math.sin(x * 12.3 + y * 7.1) * Math.cos(z * 9.7 + x * 5.3);
      const freq2 = Math.sin(y * 15.7 + z * 11.3) * Math.cos(x * 8.9);
      const noise = (freq1 * 0.6 + freq2 * 0.4) * 0.025;

      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      x += (x / r) * noise;
      y += (y / r) * noise;
      z += (z / r) * noise;

      pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xddbbcc,
      transparent: true,
      opacity: 0.35,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    // Wireframe overlay
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x6644aa, transparent: true, opacity: 0.06 })
    );
    this.scene.add(wire);
  },

  /**
   * Set electrode positions from metadata MNI coordinates.
   */
  setElectrodes(mniCoords, names) {
    this.mniCoords = mniCoords;
    this.electrodeNames = names;

    // Remove old electrodes
    this.electrodes.forEach(e => this.scene.remove(e));
    this.electrodes = [];

    const geo = new THREE.SphereGeometry(0.04, 16, 12);

    mniCoords.forEach((mni, idx) => {
      const pos = this._mniToScene(mni);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x44aaff,
        emissive: 0x112244,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.userData = { index: idx, name: names[idx], mni };
      this.scene.add(mesh);
      this.electrodes.push(mesh);
    });
  },

  /** Convert MNI coordinates (mm) to scene space. */
  _mniToScene(mni) {
    // MNI ranges roughly: x[-63,63], y[-68,62], z[-5,70]
    // Map to scene space fitting inside brain mesh (~radius 1.2)
    return new THREE.Vector3(
      mni[0] / 55 * 1.05,   // lateral
      mni[1] / 60 * 1.25,   // anterior-posterior
      mni[2] / 55 * 0.88    // superior-inferior
    );
  },

  /** Convert normalized coords [-1,1] to scene space. */
  _normToScene(nx, ny, nz, meta) {
    const mm_x = (nx + 1) / 2 * (meta.mni_max[0] - meta.mni_min[0]) + meta.mni_min[0];
    const mm_y = (ny + 1) / 2 * (meta.mni_max[1] - meta.mni_min[1]) + meta.mni_min[1];
    const mm_z = (nz + 1) / 2 * (meta.mni_max[2] - meta.mni_min[2]) + meta.mni_min[2];
    return this._mniToScene([mm_x, mm_y, mm_z]);
  },

  /**
   * Show EZ prediction as a glowing hotspot.
   * @param {Object} coord  { x, y, z, sigma } normalized
   * @param {Object} meta   metadata with mni_min, mni_max
   */
  showEZ(coord, meta) {
    // Remove old
    if (this.ezHotspot) this.scene.remove(this.ezHotspot);
    if (this.ezGlow) this.scene.remove(this.ezGlow);

    const pos = this._normToScene(coord.x, coord.y, coord.z, meta);
    const radius = Math.max(0.05, Math.min(0.4, coord.sigma * 0.3));

    // Core hotspot
    const coreGeo = new THREE.SphereGeometry(radius, 32, 24);
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

    // Glow aura
    const glowGeo = new THREE.SphereGeometry(radius * 2.5, 32, 24);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.15,
      side: THREE.BackSide,
    });
    this.ezGlow = new THREE.Mesh(glowGeo, glowMat);
    this.ezGlow.position.copy(pos);
    this.scene.add(this.ezGlow);

    // Color electrodes by distance to EZ
    this.electrodes.forEach(el => {
      const dist = el.position.distanceTo(pos);
      const t = Math.min(1, dist / 2); // 0=close, 1=far
      const color = new THREE.Color();
      color.setHSL(t * 0.65, 0.9, 0.5); // red → blue
      el.material.color.copy(color);
      el.material.emissive.copy(color).multiplyScalar(0.3);
    });
  },

  /** Update EZ hotspot opacity during optimization steps. */
  updateEZProgress(step, totalSteps) {
    if (this.ezHotspot) {
      const progress = step / totalSteps;
      this.ezHotspot.material.emissiveIntensity = 0.5 + progress * 2.0;
      this.ezGlow.material.opacity = 0.05 + progress * 0.15;
    }
  },

  _onClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.electrodes);

    if (hits.length > 0 && this.tooltip) {
      const el = hits[0].object;
      const data = el.userData;
      const screen = this._toScreen(el.position);
      this.tooltip.innerHTML = `<strong>${data.name}</strong><br>MNI: (${data.mni.map(v => v.toFixed(0)).join(', ')})`;
      this.tooltip.style.left = screen.x + 'px';
      this.tooltip.style.top = (screen.y - 60) + 'px';
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

    // Pulse EZ hotspot
    if (this.ezHotspot) {
      const t = Date.now() * 0.003;
      this.ezHotspot.material.emissiveIntensity = 1.5 + Math.sin(t) * 0.5;
      this.ezGlow.scale.setScalar(1 + Math.sin(t * 0.7) * 0.1);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  },

  /** External camera control (used by hand tracking). */
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
