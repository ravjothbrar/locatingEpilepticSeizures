/**
 * Hodgkin-Huxley equations in TensorFlow.js
 * All 4 ODEs for membrane voltage and gating variables.
 */

const HH = {
  // Constants (mS/cm², mV, µF/cm²)
  g_Na: 120, g_K: 36, g_L: 0.3,
  E_Na: 50, E_K: -77, E_L: -54.4,
  C_m: 1.0,

  /** Safe x/(1-exp(-x)) — fully differentiable (no tf.where/greater) */
  _s(x) {
    return tf.tidy(() => {
      const eps = 1e-7;
      return tf.div(tf.add(x, eps), tf.add(tf.sub(1, tf.exp(tf.neg(x))), eps));
    });
  },

  alphaM(V) { return tf.tidy(() => tf.mul(0.1, this._s(tf.div(tf.add(V, 40), 10)))); },
  betaM(V)  { return tf.tidy(() => tf.mul(4.0, tf.exp(tf.div(tf.add(V, 65), -18)))); },
  alphaH(V) { return tf.tidy(() => tf.mul(0.07, tf.exp(tf.div(tf.add(V, 65), -20)))); },
  betaH(V)  { return tf.tidy(() => tf.div(1.0, tf.add(1.0, tf.exp(tf.div(tf.add(V, 35), -10))))); },
  alphaN(V) { return tf.tidy(() => tf.mul(0.01, this._s(tf.div(tf.add(V, 55), 10)))); },
  betaN(V)  { return tf.tidy(() => tf.mul(0.125, tf.exp(tf.div(tf.add(V, 65), -80)))); },

  /**
   * Compute residual of all 4 HH equations.
   * @param {tf.Tensor} V  [B, T] membrane voltage (mV)
   * @param {tf.Tensor} m  [B, T] sodium activation
   * @param {tf.Tensor} h  [B, T] sodium inactivation
   * @param {tf.Tensor} n  [B, T] potassium activation
   * @param {tf.Tensor} I  [B, T] external current (µA/cm²)
   * @param {number} dt    time step (seconds)
   * @returns {{ loss: tf.Scalar, residuals: {R_V, R_m, R_h, R_n} }}
   */
  computeResiduals(V, m, h, n, I, dt = 1 / 256) {
    return tf.tidy(() => {
      const mid = x => tf.div(tf.add(x.slice([0, 1], [-1, -1]), x.slice([0, 0], [-1, x.shape[1] - 1])), 2);
      const d = x => tf.div(tf.sub(x.slice([0, 1], [-1, -1]), x.slice([0, 0], [-1, x.shape[1] - 1])), dt);

      const Vm = mid(V), mm = mid(m), hm = mid(h), nm = mid(n), Im = mid(I);

      const am = this.alphaM(Vm), bm = this.betaM(Vm);
      const ah = this.alphaH(Vm), bh = this.betaH(Vm);
      const an = this.alphaN(Vm), bn = this.betaN(Vm);

      const I_Na = tf.mul(tf.mul(tf.mul(this.g_Na, tf.pow(mm, 3)), hm), tf.sub(Vm, this.E_Na));
      const I_K  = tf.mul(tf.mul(this.g_K, tf.pow(nm, 4)), tf.sub(Vm, this.E_K));
      const I_L  = tf.mul(this.g_L, tf.sub(Vm, this.E_L));

      const R_V = tf.sub(d(V), tf.div(tf.sub(tf.sub(tf.sub(Im, I_Na), I_K), I_L), this.C_m));
      const R_m = tf.sub(d(m), tf.sub(tf.mul(am, tf.sub(1, mm)), tf.mul(bm, mm)));
      const R_h = tf.sub(d(h), tf.sub(tf.mul(ah, tf.sub(1, hm)), tf.mul(bh, hm)));
      const R_n = tf.sub(d(n), tf.sub(tf.mul(an, tf.sub(1, nm)), tf.mul(bn, nm)));

      const loss = tf.add(tf.add(tf.add(
        tf.mean(tf.square(R_V)),
        tf.mean(tf.square(R_m))),
        tf.mean(tf.square(R_h))),
        tf.mean(tf.square(R_n)));

      return { loss, R_V, R_m, R_h, R_n };
    });
  },

  /** Physics compliance score: 0 (bad) to 1 (perfect). */
  complianceScore(loss) {
    return Math.max(0, Math.min(1, 1 - Math.log10(Math.max(loss, 1e-10)) / 5));
  }
};
