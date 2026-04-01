/**
 * Real-time PCA on latent activations.
 * Pure JS implementation — no dependencies.
 */

const PCAModule = {
  /**
   * Fit PCA and transform data.
   * @param {Float32Array|number[][]} data  [N, D] matrix
   * @param {number} nComponents  target dimensions
   * @returns {{ projected, components, explainedVariance, correlations }}
   */
  fitTransform(data, nComponents = 15) {
    const N = data.length;
    const D = data[0].length;
    const nc = Math.min(nComponents, D, N);

    // Mean center
    const mean = new Float32Array(D);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < D; j++)
        mean[j] += data[i][j] / N;

    const centered = data.map(row => row.map((v, j) => v - mean[j]));

    // Covariance matrix (D x D)
    const cov = Array.from({ length: D }, () => new Float32Array(D));
    for (let i = 0; i < N; i++)
      for (let a = 0; a < D; a++)
        for (let b = a; b < D; b++) {
          cov[a][b] += centered[i][a] * centered[i][b] / (N - 1);
          if (a !== b) cov[b][a] = cov[a][b];
        }

    // Power iteration for top eigenvectors
    const components = [];
    const eigenvalues = [];
    const covCopy = cov.map(r => Float32Array.from(r));

    for (let k = 0; k < nc; k++) {
      let v = new Float32Array(D);
      for (let i = 0; i < D; i++) v[i] = Math.random() - 0.5;

      for (let iter = 0; iter < 200; iter++) {
        const w = new Float32Array(D);
        for (let i = 0; i < D; i++)
          for (let j = 0; j < D; j++)
            w[i] += covCopy[i][j] * v[j];

        let norm = 0;
        for (let i = 0; i < D; i++) norm += w[i] * w[i];
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < D; i++) v[i] = w[i] / norm;
      }

      // Eigenvalue = v^T * cov * v
      let ev = 0;
      for (let i = 0; i < D; i++)
        for (let j = 0; j < D; j++)
          ev += v[i] * covCopy[i][j] * v[j];

      components.push(Array.from(v));
      eigenvalues.push(ev);

      // Deflate
      for (let i = 0; i < D; i++)
        for (let j = 0; j < D; j++)
          covCopy[i][j] -= ev * v[i] * v[j];
    }

    // Project data
    const projected = centered.map(row =>
      components.map(pc => pc.reduce((s, v, i) => s + v * row[i], 0))
    );

    // Explained variance
    const totalVar = eigenvalues.reduce((s, v) => s + Math.abs(v), 0) || 1;
    const explainedVariance = eigenvalues.map(v => Math.abs(v) / totalVar);

    return { projected, components, explainedVariance, mean: Array.from(mean) };
  },

  /**
   * Correlate PCA components with HH variable names.
   * @param {number[][]} components  [nc, D]
   * @param {string[]} featureNames  names for each dimension
   * @returns {Object[]} per-component top correlations
   */
  correlateWithFeatures(components, featureNames) {
    return components.map((pc, idx) => {
      const absWeights = pc.map((w, i) => ({ name: featureNames[i] || `dim${i}`, weight: Math.abs(w), raw: w }));
      absWeights.sort((a, b) => b.weight - a.weight);
      return { pc: idx, topFeatures: absWeights.slice(0, 5) };
    });
  }
};
