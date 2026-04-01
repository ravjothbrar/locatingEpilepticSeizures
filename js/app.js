/**
 * Main application orchestration.
 * Handles UI, file upload, synthetic data, inference, tutorial, and PCA insights.
 */

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

    this._updateStatus('Ready — upload EEG data or use demo');
    this._bindUI();
    this._initTutorial();

    // Non-blocking hand tracking init
    HandTracker.init().then(ok => {
      if (ok) document.getElementById('btn-hands').style.display = 'inline-flex';
    });
  },

  _bindUI() {
    document.getElementById('btn-demo').addEventListener('click', () => this._loadDemo());
    document.getElementById('btn-run').addEventListener('click', () => this._runInference());
    document.getElementById('btn-hands').addEventListener('click', async () => {
      const active = await HandTracker.toggle();
      document.getElementById('btn-hands').classList.toggle('active', active);
    });
    document.getElementById('btn-tutorial').addEventListener('click', () => this._showTutorial());
    document.getElementById('file-input').addEventListener('change', (e) => this._handleUpload(e));

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  },

  // === Tutorial ===
  _tutorialStep: 0,
  _initTutorial() {
    const seen = localStorage.getItem('ez-tutorial-seen');
    if (seen) {
      document.getElementById('tutorial-overlay').classList.add('hidden');
      this._showBrainHints();
      return;
    }

    document.getElementById('tutorial-next').addEventListener('click', () => this._tutorialNav(1));
    document.getElementById('tutorial-prev').addEventListener('click', () => this._tutorialNav(-1));
  },

  _showTutorial() {
    this._tutorialStep = 0;
    this._tutorialUpdate();
    document.getElementById('tutorial-overlay').classList.remove('hidden');
  },

  _tutorialNav(dir) {
    this._tutorialStep += dir;
    if (this._tutorialStep > 3) {
      document.getElementById('tutorial-overlay').classList.add('hidden');
      localStorage.setItem('ez-tutorial-seen', '1');
      this._showBrainHints();
      return;
    }
    this._tutorialStep = Math.max(0, this._tutorialStep);
    this._tutorialUpdate();
  },

  _tutorialUpdate() {
    const steps = document.querySelectorAll('.tutorial-step');
    steps.forEach(s => s.style.display = 'none');
    const current = document.querySelector(`.tutorial-step[data-step="${this._tutorialStep}"]`);
    if (current) current.style.display = 'block';

    const dots = document.querySelectorAll('.tutorial-dot');
    dots.forEach((d, i) => d.classList.toggle('active', i === this._tutorialStep));

    document.getElementById('tutorial-prev').style.visibility = this._tutorialStep === 0 ? 'hidden' : 'visible';
    const nextBtn = document.getElementById('tutorial-next');
    nextBtn.textContent = this._tutorialStep === 3 ? 'Get Started' : 'Next';
  },

  _showBrainHints() {
    const hints = document.getElementById('brain-hints');
    hints.style.display = 'flex';
    setTimeout(() => { hints.style.display = 'none'; }, 4500);
  },

  // === Synthetic Data ===
  _generateSyntheticEEG() {
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

    // Seizure in left temporal channels starting at t=3s
    const onset = 3 * fs;
    for (const ch of [1, 2, 5, 6]) {
      for (let t = onset; t < T; t++) {
        const el = (t - onset) / fs;
        const env = Math.min(1, el / 2) * 3;
        const f = 15 + el * 5;
        eeg[t][ch] += env * Math.sin(2 * Math.PI * f * t / fs);
        eeg[t][ch] += env * 0.4 * Math.sin(2 * Math.PI * f * 2 * t / fs);
      }
    }

    // Z-score normalize
    for (let ch = 0; ch < nCh; ch++) {
      let s = 0, s2 = 0;
      for (let t = 0; t < T; t++) { s += eeg[t][ch]; s2 += eeg[t][ch] ** 2; }
      const mu = s / T, sig = Math.sqrt(s2 / T - mu * mu) || 1;
      for (let t = 0; t < T; t++) eeg[t][ch] = (eeg[t][ch] - mu) / sig;
    }

    return eeg;
  },

  _loadDemo() {
    this.eegData = this._generateSyntheticEEG();
    this._updateStatus('Synthetic demo data loaded — click Run Analysis');
    document.getElementById('btn-run').disabled = false;
    Viz.renderEEG(this.eegData, this.metadata.channels, this.metadata.fs, 3.0, 'chart-eeg');
    document.querySelector('[data-tab="eeg"]').click();
  },

  _handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    this._updateStatus('Parsing uploaded file...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = Papa.parse(ev.target.result, { dynamicTyping: true, header: false });
        const rows = parsed.data.filter(r => r.length >= 18 && r.every(v => typeof v === 'number'));

        if (rows.length < 256) {
          this._updateStatus('Error: need at least 1 second of data (256 rows at 256 Hz)');
          return;
        }

        // Pad or trim to 2560
        while (rows.length < 2560) rows.push([...rows[rows.length - 1]]);
        this.eegData = rows.slice(0, 2560);

        // Z-score normalize
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
        this._updateStatus('Error parsing file: ' + err.message);
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
    this._updateStatus('Running PINN inference with HH physics optimization...');

    try {
      const result = await PINN.infer(this.eegData, (step, loss) => {
        const pct = ((step + 1) / 30 * 100).toFixed(0);
        progressBar.style.width = pct + '%';
        progressText.textContent = `Physics optimization: step ${step + 1}/30 — HH residual: ${loss.toFixed(6)}`;
        Brain3D.updateEZProgress(step, 30);
      });

      progress.style.display = 'none';

      // 3D brain
      Brain3D.showEZ(result.coord, this.metadata);

      // Results panel
      this._renderResults(result);

      // Charts (defer non-critical ones)
      Viz.renderConvergence(result.hhHistory, 'chart-convergence');
      Viz.renderPhysicsStates(result.physics, this.metadata.fs, 'chart-physics');

      // PCA — run async to not block UI
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

          // Generate insight buttons
          this._renderPCAInsights(pcaResult, correlations);
        }
      });

      this._updateStatus('Analysis complete');

    } catch (err) {
      console.error(err);
      this._updateStatus('Error during inference: ' + err.message);
    }

    runBtn.textContent = 'Run Analysis';
    runBtn.disabled = false;
    this.isRunning = false;
  },

  // === Results Rendering ===
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
            <span class="coord-label">Y (anterior-posterior)</span>
            <span class="coord-value">${c.mni_y.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Z (superior-inferior)</span>
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
          ${result.physicsCompliance > 0.7 ? 'Prediction is physically plausible' :
            result.physicsCompliance > 0.4 ? 'Moderate physics compliance' :
            'Low physics compliance — interpret with caution'}
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

  // === PCA Insights ===
  _renderPCAInsights(pcaResult, correlations) {
    const container = document.getElementById('pca-insights');
    const insights = [];
    const ev = pcaResult.explainedVariance;

    // Insight 1: Dimensionality
    const cumul90 = ev.findIndex((_, i) => ev.slice(0, i + 1).reduce((a, b) => a + b, 0) >= 0.9) + 1;
    if (cumul90 > 0 && cumul90 <= 5) {
      insights.push({
        icon: '&#9889;',
        title: `Low-dimensional representation (${cumul90} PCs capture 90%)`,
        text: `The model's latent space is highly structured — only ${cumul90} principal components explain 90% of the variance. This means the model found a compact, interpretable encoding of the EEG dynamics.`,
        tag: 'good', tagText: 'Highly interpretable'
      });
    } else if (cumul90 > 5) {
      insights.push({
        icon: '&#128200;',
        title: `${cumul90} PCs needed for 90% variance`,
        text: `The latent representation is moderately complex. The model is using many dimensions to encode the EEG, which may reflect the complexity of this patient's seizure dynamics.`,
        tag: 'neutral', tagText: 'Complex representation'
      });
    }

    // Insight 2: Dominant PC
    if (ev[0] > 0.3) {
      insights.push({
        icon: '&#127919;',
        title: `PC1 dominates (${(ev[0] * 100).toFixed(1)}% variance)`,
        text: `A single latent dimension captures ${(ev[0] * 100).toFixed(1)}% of the model's internal variance. This dominant component likely encodes the primary seizure vs. baseline distinction.`,
        tag: 'good', tagText: 'Clear signal'
      });
    }

    // Insight 3: HH correlations
    const hhNames = { V: 'membrane voltage (V)', m: 'sodium activation (m)', h: 'sodium inactivation (h)', n: 'potassium activation (n)' };
    const hhVars = ['V', 'm', 'h', 'n'];
    let strongestCorr = { pc: 0, hh: 'V', r: 0 };

    correlations.forEach((row, pc) => {
      hhVars.forEach(hh => {
        if (Math.abs(row[hh]) > Math.abs(strongestCorr.r)) {
          strongestCorr = { pc, hh, r: row[hh] };
        }
      });
    });

    if (Math.abs(strongestCorr.r) > 0.5) {
      insights.push({
        icon: '&#129516;',
        title: `PC${strongestCorr.pc + 1} correlates with ${hhNames[strongestCorr.hh]} (r=${strongestCorr.r.toFixed(2)})`,
        text: `This means the model's internal feature PC${strongestCorr.pc + 1} tracks ${hhNames[strongestCorr.hh]} — evidence that the Hodgkin-Huxley physics constraints shaped what the model learned, not just statistical patterns.`,
        tag: 'good', tagText: 'Physics-informed features'
      });
    } else if (Math.abs(strongestCorr.r) > 0.2) {
      insights.push({
        icon: '&#128268;',
        title: `Moderate HH correlation (max r=${strongestCorr.r.toFixed(2)} on PC${strongestCorr.pc + 1})`,
        text: `The model's internal features show moderate alignment with Hodgkin-Huxley variables. The physics constraints influenced the learned representation, but the model also encodes non-HH patterns.`,
        tag: 'neutral', tagText: 'Partial physics alignment'
      });
    } else {
      insights.push({
        icon: '&#128300;',
        title: 'Weak HH correlation across all PCs',
        text: 'The model\'s internal features don\'t strongly align with individual HH variables. This could mean the model learned higher-order combinations of ion channel dynamics, or that the physics constraints need more training to shape the features.',
        tag: 'warn', tagText: 'Investigate further'
      });
    }

    // Insight 4: Multiple HH variables correlated
    const strongPCs = correlations.filter((row, pc) =>
      hhVars.some(hh => Math.abs(row[hh]) > 0.4)
    ).length;
    if (strongPCs >= 3) {
      insights.push({
        icon: '&#129504;',
        title: `${strongPCs} PCs encode distinct HH dynamics`,
        text: `Multiple principal components each align with different Hodgkin-Huxley variables, suggesting the model disentangled ion channel dynamics into separate latent features. This is ideal for interpretability.`,
        tag: 'good', tagText: 'Disentangled features'
      });
    }

    // Render
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

  // === Helpers ===
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
