const App = {
  eegData: null,
  metadata: null,
  isRunning: false,
  lastPCAResult: null,
  lastCorrelations: null,

  async init() {
    this._updateStatus('Loading PINN model...');
    await PINN.load();
    this.metadata = PINN.metadata;

    Brain3D.init('brain-container');
    Brain3D.setElectrodes(this.metadata.mni_coords, this.metadata.channels);

    this._updateStatus('Ready');
    this._bindUI();
    this._initWelcome();
    this._initASCII();

    HandTracker.init().then(ok => {
      if (ok) document.getElementById('btn-hands').style.display = 'inline-flex';
    });
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
    });
    document.getElementById('btn-tutorial').addEventListener('click', () => this._showWelcome());
    document.getElementById('file-input').addEventListener('change', (e) => this._handleUpload(e));

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
  _initWelcome() {
    const overlay = document.getElementById('welcome-overlay');
    const card = document.getElementById('welcome-card');
    const seen = localStorage.getItem('ez-welcome-seen');

    if (seen) {
      overlay.classList.add('hidden');
      return;
    }

    overlay.addEventListener('click', (e) => {
      if (!card.contains(e.target)) {
        overlay.classList.add('hidden');
        localStorage.setItem('ez-welcome-seen', '1');
      }
    });
  },

  _showWelcome() {
    document.getElementById('welcome-overlay').classList.remove('hidden');
  },

  // === ASCII Art ===
  _initASCII() {
    const art = document.getElementById('ascii-art');
    if (!art) return;

    const brain = [
      '          ___---^^^---___          ',
      '       _--~   /    \\   ~--_       ',
      '     _-  __  / PINN  \\  __  -_    ',
      '    / ,-~  ~-\\  HH  /-~  ~-. \\   ',
      '   | /  V m   \\    /  h n   \\ |   ',
      '   |/ dV/dt    \\  /  dm/dt   \\|   ',
      '   \\  Na+ K+   ----  gating   /   ',
      '    \\_  ion channels  EZ    _/    ',
      '      ~--___     ___--~          ',
      '            ~~~~~                ',
    ];
    art.textContent = brain.join('\n');
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

  _loadDemo(patientIdx) {
    const patient = this._patients[patientIdx];
    this.eegData = this._generateSyntheticEEG(patient);
    this._updateStatus(`${patient.title} loaded`);
    document.getElementById('btn-run').disabled = false;
    Viz.renderEEG(this.eegData, this.metadata.channels, this.metadata.fs, patient.onset, 'chart-eeg');
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

        this._updateStatus('File loaded — click Run Analysis');
        document.getElementById('btn-run').disabled = false;
        Viz.renderEEG(this.eegData, this.metadata.channels, this.metadata.fs, null, 'chart-eeg');
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
      const result = await PINN.infer(this.eegData, (step, loss) => {
        const pct = ((step + 1) / 20 * 100).toFixed(0);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Physics optimization: ${step + 1}/20 — HH residual: ${loss.toFixed(6)}`;
        Brain3D.updateEZProgress(step, 20);
      });

      progress.style.display = 'none';

      Brain3D.showEZ(result.coord, this.metadata);
      this._renderResults(result);

      Viz.renderConvergence(result.hhHistory, 'chart-convergence');
      Viz.renderPhysicsStates(result.physics, this.metadata.fs, 'chart-physics');

      requestAnimationFrame(() => {
        if (result.latentMatrix && result.latentMatrix.length > 1) {
          const step = 10;
          const subLatent = result.latentMatrix.filter((_, i) => i % step === 0);
          const pcaResult = PCAModule.fitTransform(subLatent, 10);
          this.lastPCAResult = pcaResult;

          const subPhysics = {
            V: result.physics.V.filter((_, i) => i % step === 0),
            m: result.physics.m.filter((_, i) => i % step === 0),
            h: result.physics.h.filter((_, i) => i % step === 0),
            n: result.physics.n.filter((_, i) => i % step === 0),
          };

          const correlations = this._correlatePCsWithHH(pcaResult.projected, subPhysics);
          this.lastCorrelations = correlations;

          Viz.renderPCAScree(pcaResult.explainedVariance, 'chart-pca');
          Viz.renderPCATimecourse(pcaResult.projected, this.metadata.fs, step, 'chart-pca-time');
          Viz.renderPCAHHCorrelation(correlations, 'chart-pca-corr');
          this._renderPCAInsights(pcaResult, correlations);
        }
      });

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

    document.getElementById('results-content').innerHTML = `
      <div class="result-card">
        <h3>Predicted Epileptogenic Zone</h3>
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
    `;

    setTimeout(() => {
      Viz.renderRankedRegions(result.coord, this.metadata, 'chart-ranked');
    }, 50);
  },

  _renderPCAInsights(pcaResult, correlations) {
    const container = document.getElementById('pca-insights');
    const insights = [];
    const ev = pcaResult.explainedVariance;

    const cumul90 = ev.findIndex((_, i) => ev.slice(0, i + 1).reduce((a, b) => a + b, 0) >= 0.9) + 1;
    if (cumul90 > 0 && cumul90 <= 5) {
      insights.push({
        icon: '&#9889;', title: `Low-dimensional (${cumul90} PCs for 90%)`,
        text: `Only ${cumul90} principal components explain 90% of variance — the model found a compact encoding.`,
        tag: 'good', tagText: 'Interpretable'
      });
    } else if (cumul90 > 5) {
      insights.push({
        icon: '&#128200;', title: `${cumul90} PCs for 90% variance`,
        text: `Moderately complex latent space, reflecting the complexity of this seizure's dynamics.`,
        tag: 'neutral', tagText: 'Complex'
      });
    }

    if (ev[0] > 0.3) {
      insights.push({
        icon: '&#127919;', title: `PC1 dominates (${(ev[0] * 100).toFixed(1)}%)`,
        text: `A single dimension captures ${(ev[0] * 100).toFixed(1)}% of variance — likely the seizure/baseline distinction.`,
        tag: 'good', tagText: 'Clear signal'
      });
    }

    const hhNames = { V: 'membrane voltage', m: 'Na+ activation', h: 'Na+ inactivation', n: 'K+ activation' };
    const hhVars = ['V', 'm', 'h', 'n'];
    let best = { pc: 0, hh: 'V', r: 0 };

    correlations.forEach((row, pc) => {
      hhVars.forEach(hh => {
        if (Math.abs(row[hh]) > Math.abs(best.r)) best = { pc, hh, r: row[hh] };
      });
    });

    if (Math.abs(best.r) > 0.5) {
      insights.push({
        icon: '&#129516;', title: `PC${best.pc + 1} tracks ${hhNames[best.hh]} (r=${best.r.toFixed(2)})`,
        text: `The model's learned features align with HH physics — evidence of physics-informed learning.`,
        tag: 'good', tagText: 'Physics-aligned'
      });
    } else if (Math.abs(best.r) > 0.2) {
      insights.push({
        icon: '&#128268;', title: `Moderate HH alignment (r=${best.r.toFixed(2)})`,
        text: `Partial alignment with HH variables. The model encodes both physics and statistical patterns.`,
        tag: 'neutral', tagText: 'Partial alignment'
      });
    } else {
      insights.push({
        icon: '&#128300;', title: 'Weak HH correlation',
        text: `Features don't strongly align with individual HH variables — may encode higher-order combinations.`,
        tag: 'warn', tagText: 'Investigate'
      });
    }

    const strongPCs = correlations.filter(row =>
      hhVars.some(hh => Math.abs(row[hh]) > 0.4)
    ).length;
    if (strongPCs >= 3) {
      insights.push({
        icon: '&#129504;', title: `${strongPCs} PCs encode distinct HH dynamics`,
        text: `Multiple PCs each align with different HH variables — the model disentangled ion channel dynamics.`,
        tag: 'good', tagText: 'Disentangled'
      });
    }

    container.innerHTML = insights.map(i => `
      <div class="insight-card">
        <div class="insight-icon">${i.icon}</div>
        <div class="insight-body">
          <h4>${i.title}</h4>
          <p>${i.text}</p>
          <span class="insight-tag ${i.tag}">${i.tagText}</span>
        </div>
      </div>
    `).join('');
  },

  _correlatePCsWithHH(projected, physics) {
    const hhVars = ['V', 'm', 'h', 'n'];
    const N = projected.length;

    function pearson(a, b) {
      let sA = 0, sB = 0, sAB = 0, sA2 = 0, sB2 = 0;
      for (let i = 0; i < N; i++) {
        sA += a[i]; sB += b[i]; sAB += a[i] * b[i];
        sA2 += a[i] * a[i]; sB2 += b[i] * b[i];
      }
      const num = N * sAB - sA * sB;
      const den = Math.sqrt((N * sA2 - sA * sA) * (N * sB2 - sB * sB));
      return den < 1e-10 ? 0 : num / den;
    }

    return projected[0].map((_, pc) => {
      const vals = projected.map(row => row[pc]);
      const row = {};
      for (const hh of hhVars) row[hh] = pearson(vals, physics[hh]);
      return row;
    }).slice(0, 10);
  },

  _updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());
