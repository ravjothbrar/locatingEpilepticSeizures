/**
 * Charts and secondary visualizations using Plotly.js.
 */

const Viz = {
  /** Ranked bar chart of brain regions by proximity to EZ. */
  renderRankedRegions(coord, meta, containerId) {
    const mniCoords = meta.mni_coords;
    const channels = meta.channels;
    const ez = [coord.mni_x, coord.mni_y, coord.mni_z];

    // Distance from each electrode to EZ
    const dists = mniCoords.map((mni, i) => ({
      name: channels[i],
      dist: Math.sqrt(mni.reduce((s, v, j) => s + (v - ez[j]) ** 2, 0)),
    }));
    dists.sort((a, b) => a.dist - b.dist);

    // Convert distance to probability-like score
    const maxDist = Math.max(...dists.map(d => d.dist));
    const scores = dists.map(d => ({
      name: d.name,
      score: Math.max(0, 1 - d.dist / maxDist)
    }));

    Plotly.newPlot(containerId, [{
      y: scores.map(s => s.name),
      x: scores.map(s => s.score),
      type: 'bar',
      orientation: 'h',
      marker: {
        color: scores.map(s => `hsl(${(1 - s.score) * 240}, 80%, 50%)`),
      }
    }], {
      title: 'EZ Proximity by Electrode',
      xaxis: { title: 'Proximity Score', range: [0, 1] },
      yaxis: { autorange: 'reversed' },
      margin: { l: 80, r: 20, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      height: 450,
    }, { responsive: true });
  },

  /** PCA scree plot. */
  renderPCAScree(explainedVariance, containerId) {
    const cumulative = [];
    let sum = 0;
    explainedVariance.forEach(v => {
      sum += v;
      cumulative.push(sum);
    });

    Plotly.newPlot(containerId, [
      {
        x: explainedVariance.map((_, i) => `PC${i + 1}`),
        y: explainedVariance,
        type: 'bar',
        name: 'Individual',
        marker: { color: '#4488ff' }
      },
      {
        x: explainedVariance.map((_, i) => `PC${i + 1}`),
        y: cumulative,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Cumulative',
        marker: { color: '#ff8844' },
        yaxis: 'y2'
      }
    ], {
      title: 'PCA Explained Variance',
      yaxis: { title: 'Variance Ratio', side: 'left' },
      yaxis2: { title: 'Cumulative', side: 'right', overlaying: 'y', range: [0, 1] },
      margin: { l: 50, r: 50, t: 40, b: 60 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      legend: { x: 0.5, y: 1.15, orientation: 'h' },
      height: 300,
    }, { responsive: true });
  },

  /** HH residual convergence during optimization. */
  renderConvergence(hhHistory, containerId) {
    Plotly.newPlot(containerId, [{
      y: hhHistory,
      x: hhHistory.map((_, i) => i + 1),
      type: 'scatter',
      mode: 'lines+markers',
      marker: { color: '#00ff88', size: 4 },
      line: { color: '#00ff88', width: 2 },
    }], {
      title: 'Physics Optimization Convergence',
      xaxis: { title: 'Step' },
      yaxis: { title: 'HH Residual + Consistency Loss', type: 'log' },
      margin: { l: 60, r: 20, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      height: 300,
    }, { responsive: true });
  },

  /** Raw EEG time series. */
  renderEEG(eeg, channels, fs, seizureOnset, containerId) {
    const T = eeg.length;
    const time = Array.from({ length: T }, (_, i) => i / fs);

    // Plot first 8 channels (stacked with offset)
    const traces = channels.slice(0, 8).map((name, ch) => ({
      x: time,
      y: eeg.map(row => row[ch] + ch * 4),
      type: 'scatter',
      mode: 'lines',
      name,
      line: { width: 0.8 },
    }));

    const layout = {
      title: 'EEG Channels',
      xaxis: { title: 'Time (s)' },
      yaxis: { title: 'Channel', showticklabels: false },
      margin: { l: 40, r: 20, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      showlegend: true,
      legend: { font: { size: 9 } },
      height: 350,
    };

    // Seizure onset marker
    if (seizureOnset) {
      layout.shapes = [{
        type: 'line',
        x0: seizureOnset, x1: seizureOnset,
        y0: -2, y1: 35,
        line: { color: '#ff4444', width: 2, dash: 'dash' },
      }];
      layout.annotations = [{
        x: seizureOnset, y: 35,
        text: 'Seizure Onset',
        font: { color: '#ff4444', size: 11 },
        showarrow: false,
      }];
    }

    Plotly.newPlot(containerId, traces, layout, { responsive: true });
  },

  /** PCA timecourse — how top PCs evolve over time (reveals seizure onset). */
  renderPCATimecourse(projected, fs, subsampleStep, containerId) {
    const N = projected.length;
    const time = Array.from({ length: N }, (_, i) => i * subsampleStep / fs);
    const nShow = Math.min(5, projected[0].length);

    const traces = [];
    for (let pc = 0; pc < nShow; pc++) {
      traces.push({
        x: time,
        y: projected.map(row => row[pc]),
        type: 'scatter',
        mode: 'lines',
        name: `PC${pc + 1}`,
        line: { width: 1.5 },
      });
    }

    Plotly.newPlot(containerId, traces, {
      title: 'Principal Components Over Time',
      xaxis: { title: 'Time (s)' },
      yaxis: { title: 'PC Activation' },
      margin: { l: 50, r: 20, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      legend: { x: 0, y: 1.2, orientation: 'h' },
      height: 280,
    }, { responsive: true });
  },

  /** Heatmap: correlation between PCs and HH variables. */
  renderPCAHHCorrelation(correlations, containerId) {
    const hhVars = ['V', 'm', 'h', 'n'];
    const nPCs = correlations.length;
    const z = hhVars.map(hh => correlations.map(row => row[hh]));

    Plotly.newPlot(containerId, [{
      z,
      x: Array.from({ length: nPCs }, (_, i) => `PC${i + 1}`),
      y: hhVars.map(v => ({ V: 'Voltage (V)', m: 'Na+ act. (m)', h: 'Na+ inact. (h)', n: 'K+ act. (n)' }[v])),
      type: 'heatmap',
      colorscale: [
        [0, '#4444ff'], [0.25, '#2222aa'], [0.5, '#111133'],
        [0.75, '#aa2222'], [1, '#ff4444']
      ],
      zmin: -1, zmax: 1,
      colorbar: { title: 'Pearson r', titleside: 'right' },
    }], {
      title: 'PC — Hodgkin-Huxley Correlation',
      margin: { l: 100, r: 60, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      height: 220,
    }, { responsive: true });
  },

  /** Physics states (V, m, h, n) plot. */
  renderPhysicsStates(physics, fs, containerId) {
    const T = physics.V.length;
    const time = Array.from({ length: T }, (_, i) => i / fs);

    const traces = [
      { y: physics.V, name: 'V (mV)', yaxis: 'y' },
      { y: physics.m, name: 'm (Na act.)', yaxis: 'y2' },
      { y: physics.h, name: 'h (Na inact.)', yaxis: 'y2' },
      { y: physics.n, name: 'n (K act.)', yaxis: 'y2' },
    ].map(t => ({ ...t, x: time, type: 'scatter', mode: 'lines', line: { width: 1.2 } }));

    Plotly.newPlot(containerId, traces, {
      title: 'Hodgkin-Huxley State Variables',
      xaxis: { title: 'Time (s)' },
      yaxis: { title: 'V (mV)', side: 'left' },
      yaxis2: { title: 'Gating (0-1)', side: 'right', overlaying: 'y', range: [0, 1] },
      margin: { l: 50, r: 50, t: 40, b: 40 },
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      font: { color: '#ccc' },
      legend: { x: 0, y: 1.2, orientation: 'h' },
      height: 300,
    }, { responsive: true });
  }
};
