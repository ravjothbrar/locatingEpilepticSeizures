/**
 * Main application orchestration.
 * Handles UI, file upload, synthetic data generation, and inference pipeline.
 */

const App = {
  eegData: null,
  metadata: null,
  isRunning: false,

  async init() {
    this._updateStatus('Loading PINN model...');
    await PINN.load();
    this.metadata = PINN.metadata;

    Brain3D.init('brain-container');
    Brain3D.setElectrodes(this.metadata.mni_coords, this.metadata.channels);

    this._updateStatus('Ready — upload EEG data or use demo');
    this._bindUI();

    // Try init hand tracking (non-blocking)
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

  /** Generate synthetic EEG from Hodgkin-Huxley equations. */
  _generateSyntheticEEG() {
    const T = 2560, nCh = 18, fs = 256;
    const eeg = Array.from({ length: T }, () => new Array(nCh).fill(0));

    // Simulate each channel with pink noise + alpha rhythm
    for (let ch = 0; ch < nCh; ch++) {
      let prev = 0;
      for (let t = 0; t < T; t++) {
        // 1/f noise (simple approximation)
        const white = (Math.random() - 0.5) * 2;
        prev = 0.98 * prev + 0.02 * white;
        // Alpha rhythm (10 Hz)
        const alpha = Math.sin(2 * Math.PI * 10 * t / fs) * 0.3;
        eeg[t][ch] = prev + alpha;
      }
    }

    // Inject seizure in channels 5-8 (left temporal) starting at t=3s
    const onsetSample = 3 * fs;
    const seizureChannels = [1, 2, 5, 6]; // F7-T7, T7-P7, F3-C3, C3-P3 (left hemisphere)
    for (const ch of seizureChannels) {
      for (let t = onsetSample; t < T; t++) {
        const elapsed = (t - onsetSample) / fs;
        // Increasing amplitude oscillation (seizure-like)
        const envelope = Math.min(1, elapsed / 2) * 3;
        const freq = 15 + elapsed * 5; // increasing frequency
        eeg[t][ch] += envelope * Math.sin(2 * Math.PI * freq * t / fs);
        // Add harmonics
        eeg[t][ch] += envelope * 0.4 * Math.sin(2 * Math.PI * freq * 2 * t / fs);
      }
    }

    // Normalize per channel
    for (let ch = 0; ch < nCh; ch++) {
      let sum = 0, sum2 = 0;
      for (let t = 0; t < T; t++) { sum += eeg[t][ch]; sum2 += eeg[t][ch] ** 2; }
      const mean = sum / T;
      const std = Math.sqrt(sum2 / T - mean ** 2) || 1;
      for (let t = 0; t < T; t++) eeg[t][ch] = (eeg[t][ch] - mean) / std;
    }

    return eeg;
  },

  _loadDemo() {
    this.eegData = this._generateSyntheticEEG();
    this._updateStatus('Synthetic demo data loaded — click Run Analysis');
    document.getElementById('btn-run').disabled = false;

    Viz.renderEEG(this.eegData, this.metadata.channels, this.metadata.fs, 3.0, 'chart-eeg');

    // Switch to EEG tab to show the data
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
          this._updateStatus('Error: need at least 1 second of data (256 rows)');
          return;
        }

        // Pad or trim to 2560 samples
        while (rows.length < 2560) rows.push(rows[rows.length - 1]);
        this.eegData = rows.slice(0, 2560);

        // Normalize
        for (let ch = 0; ch < 18; ch++) {
          let sum = 0, sum2 = 0;
          for (let t = 0; t < 2560; t++) { sum += this.eegData[t][ch]; sum2 += this.eegData[t][ch] ** 2; }
          const mean = sum / 2560;
          const std = Math.sqrt(sum2 / 2560 - mean ** 2) || 1;
          for (let t = 0; t < 2560; t++) this.eegData[t][ch] = (this.eegData[t][ch] - mean) / std;
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

    // Switch to results tab
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

      // 3D brain hotspot
      Brain3D.showEZ(result.coord, this.metadata);

      // Results panel
      this._renderResults(result);

      // Charts
      Viz.renderRankedRegions(result.coord, this.metadata, 'chart-ranked');
      Viz.renderConvergence(result.hhHistory, 'chart-convergence');
      Viz.renderPhysicsStates(result.physics, this.metadata.fs, 'chart-physics');

      // PCA interpretability
      if (result.latent) {
        const latentMatrix = [result.latent];
        const pcaResult = PCAModule.fitTransform(latentMatrix, 15);
        Viz.renderPCAScree(
          this.metadata.pca.variance_ratio.slice(0, 15),
          'chart-pca'
        );
      }

      this._updateStatus('Analysis complete');

    } catch (err) {
      console.error(err);
      this._updateStatus('Error during inference: ' + err.message);
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
            <span class="coord-label">Y (anterior-posterior)</span>
            <span class="coord-value">${c.mni_y.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Z (superior-inferior)</span>
            <span class="coord-value">${c.mni_z.toFixed(1)} mm</span>
          </div>
          <div class="coord-item">
            <span class="coord-label">Spread (σ)</span>
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

    // Re-render ranked chart into the newly created div
    setTimeout(() => {
      Viz.renderRankedRegions(result.coord, this.metadata, 'chart-ranked');
    }, 50);
  },

  _updateStatus(msg) {
    const el = document.getElementById('status');
    if (el) el.textContent = msg;
  }
};

// Boot
window.addEventListener('DOMContentLoaded', () => App.init());
