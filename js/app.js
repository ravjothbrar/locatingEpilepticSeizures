const App = {
  eegData: null,
  metadata: null,
  isRunning: false,
  modelReady: false,
  lastPCAResult: null,
  lastCorrelations: null,

  async init() {
    // 1. Bind ALL UI immediately so everything is interactive
    this._bindUI();

    // 2. Start 3D brain spinning right away (no electrodes yet)
    try {
      Brain3D.init('brain-container');
      this._initTheme();
    } catch (err) {
      console.error('Brain3D init failed:', err);
    }

    // 3. Load model in background with progress
    this._showLoadingBar(true);
    this._updateStatus('Loading model...');

    try {
      await PINN.load((progress) => {
        this._updateLoadingBar(progress);
        this._updateStatus(`Loading model... ${(progress * 100).toFixed(0)}%`);
      });
      this.metadata = PINN.metadata;
      this.modelReady = true;

      // Now add electrodes to the already-spinning brain
      Brain3D.setElectrodes(this.metadata.mni_coords, this.metadata.channels);

      this._updateStatus('Ready — choose a patient or upload EEG');

      // If user already loaded data while model was loading, enable Run
      if (this.eegData) {
        document.getElementById('btn-run').disabled = false;
      }
    } catch (err) {
      console.error('Model load failed:', err);
      this._updateStatus('Load failed — try refreshing');
    }

    this._showLoadingBar(false);

    // Non-blocking hand tracking
    HandTracker.init().then(ok => {
      if (ok) document.getElementById('btn-hands').style.display = 'inline-flex';
    });
  },

  _showLoadingBar(show) {
    const bar = document.getElementById('model-loading');
    if (bar) bar.style.display = show ? 'flex' : 'none';
  },

  _updateLoadingBar(fraction) {
    const fill = document.getElementById('model-loading-fill');
    const text = document.getElementById('model-loading-text');
    if (fill) fill.style.width = (fraction * 100).toFixed(0) + '%';
    if (text) text.textContent = (fraction * 100).toFixed(0) + '%';
  },

  _bindUI() {
    const menu = document.getElementById('demo-menu');
    this._patients.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'demo-item';
      item.innerHTML = `<div class="demo-item-title">${p.title}</div><div class="demo-item-desc">${p.desc}</div><span class="demo-item-region">${p.region}</span>`;
      item.addEventListener('click', () => this._loadDemo(i));
      menu.appendChild(item);
    });

    document.getElementById('btn-run').addEventListener('click', () => this._runInference());
    document.getElementById('btn-hands').addEventListener('click', async () => {
      const active = await HandTracker.toggle();
      document.getElementById('btn-hands').classList.toggle('active', active);
      if (active) {
        // Show gesture guide popup when activating gesture mode
        const overlay = document.getElementById('gesture-overlay');
        if (overlay) overlay.classList.remove('hidden');
      }
    });

    const gestureOverlay = document.getElementById('gesture-overlay');
    const gestureClose = document.getElementById('gesture-close');
    if (gestureClose) gestureClose.addEventListener('click', () => gestureOverlay.classList.add('hidden'));
    if (gestureOverlay) gestureOverlay.addEventListener('click', (e) => {
      if (e.target === gestureOverlay) gestureOverlay.classList.add('hidden');
    });
    document.getElementById('btn-tutorial').addEventListener('click', (e) => {
      e.stopPropagation();
      this._showWelcome();
    });
    document.getElementById('file-input').addEventListener('change', (e) => this._handleUpload(e));

    // Theme toggle
    document.getElementById('btn-theme').addEventListener('click', () => this._toggleTheme());

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  },

  // === Welcome Popup (single, click-outside-to-dismiss) ===
  _dismissWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.classList.add('hidden');
    localStorage.setItem('ez-welcome-seen', '1');
    if (this._welcomeTimer) { clearTimeout(this._welcomeTimer); this._welcomeTimer = null; }
  },

  _welcomeTimer: null,

  _initWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    if (!overlay) return;

    // ALWAYS set up listeners (so ? button works after first dismissal)
    const card = document.getElementById('welcome-card');
    card.addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('click', () => this._dismissWelcome());
    document.addEventListener('keydown', () => this._dismissWelcome());

    const seen = localStorage.getItem('ez-welcome-seen');
    if (seen) {
      overlay.classList.add('hidden');
    } else {
      this._welcomeTimer = setTimeout(() => this._dismissWelcome(), 5000);
    }
  },

  _showWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    overlay.classList.remove('hidden');
    // No auto-dismiss when user manually opens via '?' — stays until clicked off
    if (this._welcomeTimer) { clearTimeout(this._welcomeTimer); this._welcomeTimer = null; }
    const hint = document.getElementById('welcome-hint');
    if (hint) hint.textContent = 'Click anywhere outside to dismiss';
  },

  // === ASCII Art ===
  _initASCII() {
    // Wider/more horizontal brain; brainstem shifted right and more horizontal
    const brainArt = [
      '      ____---~~~---____         ',
      '    _/    __----__    \\_        ',
      '   / _---~  /  ~--_    \\       ',
      '   /  /  __/  \\  ~-\\    \\      ',
      '   | | /~  \\  \\~\\  |\\   |      ',
      '   | |  \\  \\__/~  \\| \\  |      ',
      '    \\  ~-_  __-~~  /  \\/       ',
      '     \\____~~~  ___-~  /        ',
      '               \\___/ \\___-_    ',
      '                          \\_|  ',
    ];
    const text = brainArt.join('\n');

    // ── Popup: 12px JetBrains Mono ─────────────────────────────────────────
    // char width ≈ 7.2 px, line height ≈ 14.4 px  →  positions (col*7.2, line*14.4)
    const popup = document.getElementById('ascii-art');
    if (popup) {
      popup.style.position = 'relative';
      popup.style.overflow = 'visible';
      popup.textContent = '';
      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:0;white-space:pre;display:inline-block';
      pre.textContent = text;
      popup.appendChild(pre);

      // All 8 labels placed INSIDE the brain outline (col*7.2 px, line*14.4 px)
      const popupLabels = [
        { text: 'dV/dt', top: '14px',  left: '94px'  },  // line1, col13 – top center
        { text: 'Na\u207A',  top: '29px',  left: '151px' },  // line2, col21 – upper right
        { text: 'Ca\u00B2\u207A', top: '29px', left: '36px'  },  // line2, col5  – upper left
        { text: 'HH',   top: '43px',  left: '94px'  },  // line3, col13 – centre
        { text: 'K\u207A',  top: '58px',  left: '36px'  },  // line4, col5  – mid left
        { text: 'gNa',  top: '58px',  left: '144px' },  // line4, col20 – mid right
        { text: 'I\u2098',  top: '72px',  left: '101px' },  // line5, col14 – low centre
        { text: 'E\u2099\u2090', top: '86px', left: '50px'  },  // line6, col7  – lower left
      ];
      popupLabels.forEach(l => {
        const span = document.createElement('span');
        span.className = 'ascii-label';
        span.textContent = l.text;
        span.style.top  = l.top;
        span.style.left = l.left;
        popup.appendChild(span);
      });
    }

    // ── Header: 7px JetBrains Mono ─────────────────────────────────────────
    // char width ≈ 4.2 px, line height ≈ 7.35 px  →  positions (col*4.2, line*7.35)
    const header = document.getElementById('header-ascii-art');
    if (header) {
      header.textContent = text;
      const wrap = header.closest('.header-ascii-wrap');
      if (wrap) {
        wrap.style.position = 'relative';
        wrap.style.overflow = 'visible';
        // 6 labels inside the brain
        const headerLabels = [
          { text: 'dV/dt', top: '7px',  left: '55px' },  // line1, col13
          { text: 'Na\u207A',  top: '15px', left: '88px' },  // line2, col21
          { text: 'HH',   top: '22px', left: '55px' },  // line3, col13
          { text: 'K\u207A',  top: '29px', left: '21px' },  // line4, col5
          { text: 'gNa',  top: '29px', left: '84px' },  // line4, col20
          { text: 'I\u2098',  top: '37px', left: '59px' },  // line5, col14
        ];
        headerLabels.forEach(l => {
          const span = document.createElement('span');
          span.className = 'ascii-label ascii-label-sm';
          span.textContent = l.text;
          span.style.top  = l.top;
          span.style.left = l.left;
          wrap.appendChild(span);
        });
      }
    }
  },

  // === Sample Patient Datasets ===
  _patients: [
    {
      id: 'ltl', title: 'Patient 1 — Left Temporal Lobe',
      desc: '8yo female. Mesial temporal seizure with rhythmic theta onset in left temporal chain.',
      region: 'Left Temporal', channels: [1, 2, 3],
      onset: 3.0, freq: 14, freqDrift: 4, amp: 3.0, harmonic: 0.4
    },
    {
      id: 'rtl', title: 'Patient 2 — Right Temporal Lobe',
      desc: '11yo male. Right temporal seizure with sharp waves propagating posteriorly.',
      region: 'Right Temporal', channels: [13, 14, 15],
      onset: 2.5, freq: 12, freqDrift: 6, amp: 3.2, harmonic: 0.5
    },
    {
      id: 'lf', title: 'Patient 3 — Left Frontal',
      desc: '6yo female. Frontal seizure with high-frequency beta onset in left frontal electrodes.',
      region: 'Left Frontal', channels: [0, 4, 5],
      onset: 2.0, freq: 22, freqDrift: 3, amp: 2.5, harmonic: 0.3
    },
    {
      id: 'rf', title: 'Patient 4 — Right Frontal',
      desc: '9yo male. Brief frontal seizure with rapid spread. Low-voltage fast activity.',
      region: 'Right Frontal', channels: [8, 9, 12],
      onset: 4.0, freq: 25, freqDrift: 2, amp: 2.2, harmonic: 0.25
    },
    {
      id: 'lp', title: 'Patient 5 — Left Parietal',
      desc: '7yo female. Parietal focus with rhythmic alpha activity spreading occipitally.',
      region: 'Left Parietal', channels: [6, 7, 3],
      onset: 3.5, freq: 10, freqDrift: 3, amp: 2.8, harmonic: 0.35
    },
    {
      id: 'rp', title: 'Patient 6 — Right Parietal',
      desc: '10yo male. Right parietal onset with spike-and-wave morphology.',
      region: 'Right Parietal', channels: [10, 11, 15],
      onset: 2.8, freq: 11, freqDrift: 4, amp: 2.9, harmonic: 0.45
    },
    {
      id: 'lo', title: 'Patient 7 — Left Occipital',
      desc: '5yo female. Occipital seizure with visual aura history. Rhythmic delta onset.',
      region: 'Left Occipital', channels: [3, 7],
      onset: 3.2, freq: 8, freqDrift: 5, amp: 3.5, harmonic: 0.5
    },
    {
      id: 'bt', title: 'Patient 8 — Bilateral Temporal',
      desc: '12yo male. Independent bilateral temporal foci. Simultaneous onset both sides.',
      region: 'Bilateral Temporal', channels: [1, 2, 13, 14],
      onset: 2.2, freq: 13, freqDrift: 5, amp: 2.7, harmonic: 0.4
    },
    {
      id: 'cp', title: 'Patient 9 — Centroparietal',
      desc: '8yo female. Midline centroparietal onset with generalised spread.',
      region: 'Centroparietal', channels: [16, 17, 6, 10],
      onset: 3.8, freq: 16, freqDrift: 3, amp: 2.4, harmonic: 0.3
    },
    {
      id: 'mf', title: 'Patient 10 — Multifocal Left',
      desc: '13yo male. Widespread left hemisphere involving frontal, central, temporal.',
      region: 'Left Hemisphere', channels: [0, 1, 5, 6, 2, 7],
      onset: 1.8, freq: 18, freqDrift: 6, amp: 2.0, harmonic: 0.35
    }
  ],

  _generateSyntheticEEG(patient) {
    const T = 2560, nCh = 18, fs = 256;
    const eeg = new Array(T);
    for (let t = 0; t < T; t++) eeg[t] = new Float32Array(nCh);

    for (let ch = 0; ch < nCh; ch++) {
      let prev = 0;
      for (let t = 0; t < T; t++) {
        prev = 0.98 * prev + 0.02 * (Math.random() - 0.5) * 2;
        eeg[t][ch] = prev + Math.sin(2 * Math.PI * 10 * t / fs) * 0.3;
      }
    }

    const onset = Math.round(patient.onset * fs);
    for (const ch of patient.channels) {
      for (let t = onset; t < T; t++) {
        const el = (t - onset) / fs;
        const env = Math.min(1, el / 2) * patient.amp;
        const f = patient.freq + el * patient.freqDrift;
        eeg[t][ch] += env * Math.sin(2 * Math.PI * f * t / fs);
        eeg[t][ch] += env * patient.harmonic * Math.sin(2 * Math.PI * f * 2 * t / fs);
      }
    }

    for (let ch = 0; ch < nCh; ch++) {
      let s = 0, s2 = 0;
      for (let t = 0; t < T; t++) { s += eeg[t][ch]; s2 += eeg[t][ch] ** 2; }
      const mu = s / T, sig = Math.sqrt(s2 / T - mu * mu) || 1;
      for (let t = 0; t < T; t++) eeg[t][ch] = (eeg[t][ch] - mu) / sig;
    }

    return eeg;
  },

  _channels: ['FP1-F7','F7-T7','T7-P7','P7-O1','FP1-F3','F3-C3','C3-P3','P3-O1',
               'FP2-F4','F4-C4','C4-P4','P4-O2','FP2-F8','F8-T8','T8-P8','P8-O2','FZ-CZ','CZ-PZ'],
  _fs: 256,

  _loadDemo(patientIdx) {
    const patient = this._patients[patientIdx];
    this.eegData = this._generateSyntheticEEG(patient);
    this._updateStatus(this.modelReady ? `${patient.title} loaded` : `${patient.title} loaded (model still loading...)`);
    document.getElementById('btn-run').disabled = !this.modelReady;
    Viz.renderEEG(this.eegData, this._channels, this._fs, patient.onset, 'chart-eeg');
    document.querySelector('[data-tab="eeg"]').click();
    document.getElementById('demo-menu').style.display = 'none';
    setTimeout(() => document.getElementById('demo-menu').style.display = '', 200);
  },

  _handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    this._updateStatus('Parsing...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = Papa.parse(ev.target.result, { dynamicTyping: true, header: false });
        const rows = parsed.data.filter(r => r.length >= 18 && r.every(v => typeof v === 'number'));

        if (rows.length < 256) {
          this._updateStatus('Error: need >= 256 rows (1 second at 256 Hz)');
          return;
        }

        while (rows.length < 2560) rows.push([...rows[rows.length - 1]]);
        this.eegData = rows.slice(0, 2560);

        for (let ch = 0; ch < 18; ch++) {
          let s = 0, s2 = 0;
          for (let t = 0; t < 2560; t++) { s += this.eegData[t][ch]; s2 += this.eegData[t][ch] ** 2; }
          const mu = s / 2560, sig = Math.sqrt(s2 / 2560 - mu * mu) || 1;
          for (let t = 0; t < 2560; t++) this.eegData[t][ch] = (this.eegData[t][ch] - mu) / sig;
        }

        this._updateStatus(this.modelReady ? 'File loaded — click Run Analysis' : 'File loaded (model still loading...)');
        document.getElementById('btn-run').disabled = !this.modelReady;
        Viz.renderEEG(this.eegData, this._channels, this._fs, null, 'chart-eeg');
        document.querySelector('[data-tab="eeg"]').click();
      } catch (err) {
        this._updateStatus('Parse error: ' + err.message);
      }
    };
    reader.readAsText(file);
  },

  // === Inference ===
  async _runInference() {
    if (this.isRunning || !this.eegData) return;
    if (!this.modelReady) {
      this._updateStatus('Model still loading — please wait');
      return;
    }
    this.isRunning = true;

    const runBtn = document.getElementById('btn-run');
    runBtn.disabled = true;
    runBtn.textContent = 'Analyzing...';

    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    progress.style.display = 'block';

    document.querySelector('[data-tab="results"]').click();
    this._updateStatus('Running PINN inference...');

    try {
      const result = await PINN.infer(this.eegData, (step, loss, totalSteps) => {
        const pct = ((step + 1) / totalSteps * 100).toFixed(0);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Physics optimization: ${step + 1}/${totalSteps} — HH residual: ${loss.toFixed(6)}`;
        Brain3D.updateEZProgress(step, totalSteps);
      });

      progress.style.display = 'none';

      Brain3D.showEZ(result.coord, this.metadata);
      this._renderResults(result);

      Viz.renderEEG(this.eegData, this._channels, this._fs, null, 'chart-eeg');

      this._updateStatus('Analysis complete');
    } catch (err) {
      console.error(err);
      this._updateStatus('Error: ' + err.message);
    }

    runBtn.textContent = 'Run Analysis';
    runBtn.disabled = false;
    this.isRunning = false;
  },

  _renderResults(result) {
    const c = result.coord;
    const badge = result.physicsCompliance > 0.7 ? 'compliance-high' :
                  result.physicsCompliance > 0.4 ? 'compliance-med' : 'compliance-low';
    const region = this._mniToRegion(c.mni_x, c.mni_y, c.mni_z);

    document.getElementById('results-content').innerHTML = `
      <div class="result-card">
        <h3>Predicted Epileptogenic Zone</h3>
        <div class="region-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2C8 2 4 5.5 4 10c0 3 1.5 5.5 4 7l1 5h6l1-5c2.5-1.5 4-4 4-7 0-4.5-4-8-8-8z"/></svg>
          ${region}
        </div>
        <div class="coord-grid">
          <div class="coord-item">
            <span class="coord-label">X (lateral)</span>
            <span class="coord-value">${c.mni_x.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Y (anterior-post)</span>
            <span class="coord-value">${c.mni_y.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Z (superior-inf)</span>
            <span class="coord-value">${c.mni_z.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Spread (&sigma;)</span>
            <span class="coord-value">${c.sigma.toFixed(3)}</span>
          </div>
        </div>
      </div>

      <div class="result-card">
        <h3>Physics Compliance</h3>
        <div class="compliance-bar">
          <div class="compliance-fill ${badge}" style="width: ${(result.physicsCompliance * 100).toFixed(0)}%"></div>
        </div>
        <p class="compliance-text">
          ${(result.physicsCompliance * 100).toFixed(1)}% —
          ${result.physicsCompliance > 0.7 ? 'Physically plausible' :
            result.physicsCompliance > 0.4 ? 'Moderate compliance' :
            'Low compliance — interpret with caution'}
        </p>
        <p class="compliance-detail">HH Residual: ${result.hhResidual.toFixed(6)}</p>
      </div>

      <div class="result-card">
        <h3>Nearest Electrodes</h3>
        <div id="chart-ranked"></div>
      </div>

      <div class="result-card summary-card">
        <h3>Summary</h3>
        <p class="summary-text">
          The epileptic seizure was located at <strong>MNI (${c.mni_x.toFixed(1)}, ${c.mni_y.toFixed(1)}, ${c.mni_z.toFixed(1)}) mm</strong>
          with a spread radius of <strong>&sigma; = ${c.sigma.toFixed(3)}</strong>
          and a physical plausibility of <strong>${(result.physicsCompliance * 100).toFixed(1)}%</strong>.
          ${result.physicsCompliance > 0.7
            ? 'The prediction is consistent with Hodgkin-Huxley neuronal dynamics, suggesting a physically plausible seizure origin.'
            : result.physicsCompliance > 0.4
            ? 'The prediction shows moderate consistency with HH dynamics. Results should be interpreted with some caution.'
            : 'The prediction shows low consistency with HH dynamics. Results should be interpreted with caution.'}
        </p>
      </div>
    `;

    setTimeout(() => {
      Viz.renderRankedRegions(result.coord, this.metadata, 'chart-ranked');
    }, 50);
  },

  // === MNI → Brain Region ===
  _mniToRegion(mx, my, mz) {
    const ax = Math.abs(mx);
    const side = mx >= 0 ? 'Right' : 'Left';

    if (mz < -25 && my < -42) return 'Cerebellum';
    if (ax < 14 && mz < -5 && my < -20) return 'Brainstem';
    if (my < -70) return `${side} Occipital Lobe`;
    if (ax > 14 && ax < 36 && my > -35 && my < 5 && mz < -18) return `${side} Hippocampus`;
    if (ax > 14 && ax < 34 && my > -8 && my < 8 && mz < -12) return `${side} Amygdala`;
    if (ax > 30 && my > -68 && my < 18 && mz < 16) return `${side} Temporal Lobe`;
    if (ax < 16 && my > -28 && my < -2 && mz > -2 && mz < 22) return 'Thalamus';
    if (ax > 8 && ax < 26 && my > -12 && my < 28 && mz > 2 && mz < 26) return `${side} Basal Ganglia`;
    if (ax < 13 && my > -38 && my < 48 && mz > 5 && mz < 48) return 'Cingulate Cortex';
    if (ax > 28 && ax < 52 && mz > -14 && mz < 24) return `${side} Insular Cortex`;
    if (my < -12 && my > -70 && mz > 30) return `${side} Parietal Lobe`;
    if (my > 22) return `${side} Frontal Lobe`;
    if (my > -2 && mz > 42) return `${side} Motor / Premotor Cortex`;
    if (my > -15 && mz > 22) return `${side} Central Region`;
    return `${side} Temporal–Parietal Junction`;
  },

  _updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  },

  _isDark: true,

  _toggleTheme() {
    this._isDark = !this._isDark;
    document.body.classList.toggle('light-mode', !this._isDark);
    Brain3D.setTheme(this._isDark);
    localStorage.setItem('ez-theme', this._isDark ? 'dark' : 'light');
  },

  _initTheme() {
    const saved = localStorage.getItem('ez-theme');
    if (saved === 'light') {
      this._isDark = false;
      document.body.classList.add('light-mode');
      Brain3D.setTheme(false);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  // Welcome popup MUST be set up immediately, before async model load blocks
  App._initWelcome();
  App._initASCII();
  App.init();
});
