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

    this.scene.add(new THREE.AmbientLight(0x404060, 0.7));
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(5, 5, 5);
    const dir2 = new THREE.DirectionalLight(0x8b5cf6, 0.3);
    dir2.position.set(-5, -3, -5);
    this.scene.add(dir1, dir2);

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
    const geo = new THREE.SphereGeometry(1, 56, 40);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

      y *= 1.25;
      z *= 0.88;
      x *= 1.05;

      const fissureDepth = Math.exp(-x * x * 30) * 0.18;
      z -= fissureDepth * Math.max(0, z);

      if (z < -0.3) z = -0.3 + (z + 0.3) * 0.3;

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
      color: 0xccaaee,
      transparent: true,
      opacity: 0.32,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.brainMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.brainMesh);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.05 })
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
