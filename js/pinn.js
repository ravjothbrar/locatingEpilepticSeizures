/**
 * PINN inference engine.
 * Loads pre-trained model, runs inference with test-time HH optimization.
 */

const PINN = {
  model: null,
  metadata: null,

  async load() {
    const [model, resp] = await Promise.all([
      tf.loadLayersModel('model/model.json'),
      fetch('model/metadata.json')
    ]);
    this.model = model;
    this.metadata = await resp.json();
    console.log('PINN loaded:', model.inputs[0].shape);
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
    const inputTensor = tf.tensor3d(pcaData, [1, T, nCh]);

    // Initial forward pass
    const [rawCoord, rawPhys, rawLatent] = this.model.predict(inputTensor);

    // Post-process coordinate: tanh for xyz, softplus for sigma
    const coordData = await rawCoord.data();
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

    // Extract physics states
    const physData = await rawPhys.data(); // [1, 2560, 5] flattened
    const V_arr = [], m_arr = [], h_arr = [], n_arr = [], I_arr = [];
    for (let t = 0; t < T; t++) {
      const base = t * 5;
      V_arr.push(sigmoid(physData[base]) * 120 - 80);
      m_arr.push(sigmoid(physData[base + 1]));
      h_arr.push(sigmoid(physData[base + 2]));
      n_arr.push(sigmoid(physData[base + 3]));
      I_arr.push(physData[base + 4] * 20);
    }

    // Extract full latent matrix [T, 128] for PCA across timesteps
    const latentData = await rawLatent.data();
    const latentMatrix = [];
    for (let t = 0; t < T; t++) {
      const row = new Array(128);
      for (let d = 0; d < 128; d++)
        row[d] = latentData[t * 128 + d];
      latentMatrix.push(row);
    }

    // --- Test-time HH optimization (output-space) ---
    const V_t = tf.variable(tf.tensor2d([V_arr], [1, T]));
    const m_t = tf.variable(tf.tensor2d([m_arr], [1, T]));
    const h_t = tf.variable(tf.tensor2d([h_arr], [1, T]));
    const n_t = tf.variable(tf.tensor2d([n_arr], [1, T]));
    const I_t = tf.variable(tf.tensor2d([I_arr], [1, T]));

    const V_init = tf.tensor2d([V_arr], [1, T]);
    const m_init = tf.tensor2d([m_arr], [1, T]);
    const h_init = tf.tensor2d([h_arr], [1, T]);
    const n_init = tf.tensor2d([n_arr], [1, T]);

    const optimizer = tf.train.adam(0.01);
    const hhHistory = [];
    const nSteps = 30;

    for (let step = 0; step < nSteps; step++) {
      const lossVal = optimizer.minimize(() => {
        return tf.tidy(() => {
          // HH physics residual
          const { loss: hhLoss } = HH.computeResiduals(V_t, m_t, h_t, n_t, I_t);

          // Consistency: don't drift far from model's prediction
          const consist = tf.add(tf.add(tf.add(
            tf.losses.meanSquaredError(V_init, V_t),
            tf.losses.meanSquaredError(m_init, m_t)),
            tf.losses.meanSquaredError(h_init, h_t)),
            tf.losses.meanSquaredError(n_init, n_t));

          return tf.add(tf.mul(hhLoss, 0.5), tf.mul(consist, 0.5));
        });
      }, true, [V_t, m_t, h_t, n_t, I_t]);

      const lv = await lossVal.data();
      hhHistory.push(lv[0]);
      lossVal.dispose();

      if (onStep) {
        await onStep(step, lv[0]);
        await tf.nextFrame();
      }
    }

    // Final HH residual
    const finalResidual = tf.tidy(() => {
      const { loss } = HH.computeResiduals(V_t, m_t, h_t, n_t, I_t);
      return loss;
    });
    const finalLoss = (await finalResidual.data())[0];
    finalResidual.dispose();

    const physicsCompliance = HH.complianceScore(finalLoss);

    // Get refined physics states
    const refinedV = await V_t.data();
    const refinedM = await m_t.data();
    const refinedH = await h_t.data();
    const refinedN = await n_t.data();

    // Cleanup
    [inputTensor, rawCoord, rawPhys, rawLatent, V_t, m_t, h_t, n_t, I_t, V_init, m_init, h_init, n_init].forEach(t => t.dispose());

    return {
      coord,
      physicsCompliance,
      hhResidual: finalLoss,
      hhHistory,
      latentMatrix,  // [2560, 128] — full per-timestep latent for PCA
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
