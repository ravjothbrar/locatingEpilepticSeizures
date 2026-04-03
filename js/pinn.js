/**
 * PINN inference engine.
 * Loads pre-trained model, runs inference with test-time HH optimization.
 */

const PINN = {
  model: null,
  metadata: null,

  async load(onProgress) {
    const progressFn = onProgress || (() => {});

    // Load model weights and metadata in parallel
    const [model, resp] = await Promise.all([
      tf.loadLayersModel('model/model.json', { onProgress: progressFn }),
      fetch('model/metadata.json')
    ]);
    this.model = model;
    this.metadata = await resp.json();
    console.log('PINN loaded, backend:', tf.getBackend());
    return this;
  },

  /**
   * Apply PCA preprocessing to raw EEG.
   * @param {number[][]} eeg [2560, 18] raw EEG channels
   * @returns {Float32Array} [2560, 18] PCA-transformed
   */
  applyPCA(eeg) {
    const { components, mean } = this.metadata.pca;
    const T = eeg.length, D = eeg[0].length;
    const out = new Float32Array(T * D);
    for (let t = 0; t < T; t++) {
      for (let c = 0; c < D; c++) {
        let val = 0;
        for (let d = 0; d < D; d++)
          val += components[c][d] * (eeg[t][d] - mean[d]);
        out[t * D + c] = val;
      }
    }
    return out;
  },

  /**
   * Run full inference pipeline with HH optimization.
   * @param {number[][]} eeg  [2560, 18] raw EEG
   * @param {Function} onStep  callback(step, hhLoss) for animation
   * @returns {Object} { coord, physicsCompliance, hhHistory, latent, physicsStates }
   */
  async infer(eeg, onStep = null) {
    const T = this.metadata.window_samples;
    const nCh = this.metadata.n_channels;

    // PCA preprocessing
    const pcaData = this.applyPCA(eeg);

    // Forward pass — extract data then dispose tensors immediately
    const tensors = tf.tidy(() => {
      const inputTensor = tf.tensor3d(pcaData, [1, T, nCh]);
      return this.model.predict(inputTensor); // returned tensors survive tidy
    });
    const [coordData, physData, latentData] = await Promise.all(
      tensors.map(t => t.data())
    );
    tensors.forEach(t => t.dispose());

    // Post-process coordinate: tanh for xyz, softplus for sigma
    const coord = {
      x: Math.tanh(coordData[0]),
      y: Math.tanh(coordData[1]),
      z: Math.tanh(coordData[2]),
      sigma: Math.log(1 + Math.exp(coordData[3]))
    };

    // Denormalize to MNI mm
    const { mni_min, mni_max } = this.metadata;
    coord.mni_x = (coord.x + 1) / 2 * (mni_max[0] - mni_min[0]) + mni_min[0];
    coord.mni_y = (coord.y + 1) / 2 * (mni_max[1] - mni_min[1]) + mni_min[1];
    coord.mni_z = (coord.z + 1) / 2 * (mni_max[2] - mni_min[2]) + mni_min[2];

    // Extract physics states into typed arrays for speed
    const V_arr = new Float32Array(T), m_arr = new Float32Array(T);
    const h_arr = new Float32Array(T), n_arr = new Float32Array(T);
    const I_arr = new Float32Array(T);
    for (let t = 0; t < T; t++) {
      const base = t * 5;
      V_arr[t] = sigmoid(physData[base]) * 120 - 80;
      m_arr[t] = sigmoid(physData[base + 1]);
      h_arr[t] = sigmoid(physData[base + 2]);
      n_arr[t] = sigmoid(physData[base + 3]);
      I_arr[t] = physData[base + 4] * 20;
    }

    // Extract full latent matrix [T, 128] for PCA across timesteps
    const latentMatrix = new Array(T);
    for (let t = 0; t < T; t++) {
      const row = new Float64Array(128);
      const off = t * 128;
      for (let d = 0; d < 128; d++) row[d] = latentData[off + d];
      latentMatrix[t] = row;
    }

    // --- Test-time HH optimization (output-space) ---
    // Create variable + init tensors from the same buffer (one allocation each)
    const V_t = tf.variable(tf.tensor2d(V_arr, [1, T]));
    const m_t = tf.variable(tf.tensor2d(m_arr, [1, T]));
    const h_t = tf.variable(tf.tensor2d(h_arr, [1, T]));
    const n_t = tf.variable(tf.tensor2d(n_arr, [1, T]));
    const I_t = tf.variable(tf.tensor2d(I_arr, [1, T]));

    const V_init = tf.tensor2d(V_arr, [1, T]);
    const m_init = tf.tensor2d(m_arr, [1, T]);
    const h_init = tf.tensor2d(h_arr, [1, T]);
    const n_init = tf.tensor2d(n_arr, [1, T]);

    const optimizer = tf.train.adam(0.01);
    const hhHistory = [];
    const nSteps = 40;

    for (let step = 0; step < nSteps; step++) {
      const lossVal = optimizer.minimize(() => {
        return tf.tidy(() => {
          const { loss: hhLoss } = HH.computeResiduals(V_t, m_t, h_t, n_t, I_t);
          const consist = tf.add(tf.add(tf.add(
            tf.losses.meanSquaredError(V_init, V_t),
            tf.losses.meanSquaredError(m_init, m_t)),
            tf.losses.meanSquaredError(h_init, h_t)),
            tf.losses.meanSquaredError(n_init, n_t));
          return tf.add(tf.mul(hhLoss, 0.5), tf.mul(consist, 0.5));
        });
      }, true, [V_t, m_t, h_t, n_t, I_t]);

      const lv = (await lossVal.data())[0];
      hhHistory.push(lv);
      lossVal.dispose();

      if (onStep) {
        await onStep(step, lv, nSteps);
        await tf.nextFrame();
      }
    }

    // Final HH residual + refined states in one pass
    const finalLoss = tf.tidy(() => HH.computeResiduals(V_t, m_t, h_t, n_t, I_t).loss);
    const [finalLossVal, refinedV, refinedM, refinedH, refinedN] = await Promise.all([
      finalLoss.data(), V_t.data(), m_t.data(), h_t.data(), n_t.data()
    ]);
    finalLoss.dispose();

    const physicsCompliance = HH.complianceScore(finalLossVal[0]);

    // Cleanup
    [V_t, m_t, h_t, n_t, I_t, V_init, m_init, h_init, n_init].forEach(t => t.dispose());
    optimizer.dispose();

    return {
      coord,
      physicsCompliance,
      hhResidual: finalLossVal[0],
      hhHistory,
      latentMatrix,
      physics: {
        V: Array.from(refinedV),
        m: Array.from(refinedM),
        h: Array.from(refinedH),
        n: Array.from(refinedN)
      }
    };
  }
};

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
