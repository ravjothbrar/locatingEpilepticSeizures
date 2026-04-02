const Viz = {
  _font: { color: '#b0aecc', family: 'Inter, sans-serif', size: 11 },
  _bg: 'transparent',

  renderRankedRegions(coord, meta, containerId) {
    const ez = [coord.mni_x, coord.mni_y, coord.mni_z];
    const dists = meta.mni_coords.map((mni, i) => ({
      name: meta.channels[i],
      dist: Math.sqrt(mni.reduce((s, v, j) => s + (v - ez[j]) ** 2, 0)),
    }));
    dists.sort((a, b) => a.dist - b.dist);

    const maxDist = Math.max(...dists.map(d => d.dist));
    const scores = dists.map(d => ({ name: d.name, score: Math.max(0, 1 - d.dist / maxDist) }));

    Plotly.newPlot(containerId, [{
      y: scores.map(s => s.name),
      x: scores.map(s => s.score),
      type: 'bar',
      orientation: 'h',
      marker: { color: scores.map(s => `hsl(${270 - s.score * 30}, 70%, ${40 + s.score * 25}%)`) },
    }], {
      xaxis: { title: 'Proximity Score', range: [0, 1], gridcolor: '#1e1e3a' },
      yaxis: { autorange: 'reversed' },
      margin: { l: 80, r: 16, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, height: 420,
    }, { responsive: true, displayModeBar: false });
  },

  renderPCAScree(explainedVariance, containerId) {
    const cumul = [];
    let sum = 0;
    explainedVariance.forEach(v => { sum += v; cumul.push(sum); });

    Plotly.newPlot(containerId, [
      {
        x: explainedVariance.map((_, i) => `PC${i + 1}`),
        y: explainedVariance, type: 'bar', name: 'Individual',
        marker: { color: '#8b5cf6' }
      },
      {
        x: explainedVariance.map((_, i) => `PC${i + 1}`),
        y: cumul, type: 'scatter', mode: 'lines+markers', name: 'Cumulative',
        marker: { color: '#c084fc', size: 5 }, yaxis: 'y2'
      }
    ], {
      yaxis: { title: 'Variance', side: 'left', gridcolor: '#1e1e3a' },
      yaxis2: { title: 'Cumulative', side: 'right', overlaying: 'y', range: [0, 1] },
      margin: { l: 44, r: 44, t: 10, b: 50 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, legend: { x: 0.3, y: 1.15, orientation: 'h' },
      height: 260,
    }, { responsive: true, displayModeBar: false });
  },

  renderConvergence(hhHistory, containerId) {
    Plotly.newPlot(containerId, [{
      y: hhHistory,
      x: hhHistory.map((_, i) => i + 1),
      type: 'scatter', mode: 'lines+markers',
      marker: { color: '#22d3a0', size: 4 },
      line: { color: '#22d3a0', width: 2 },
    }], {
      xaxis: { title: 'Step', gridcolor: '#1e1e3a' },
      yaxis: { title: 'HH Residual', type: 'log', gridcolor: '#1e1e3a' },
      margin: { l: 52, r: 16, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, height: 260,
    }, { responsive: true, displayModeBar: false });
  },

  renderEEG(eeg, channels, fs, seizureOnset, containerId) {
    const T = eeg.length;
    const time = Array.from({ length: T }, (_, i) => i / fs);

    const traces = channels.slice(0, 8).map((name, ch) => ({
      x: time,
      y: eeg.map(row => row[ch] + ch * 4),
      type: 'scatter', mode: 'lines', name,
      line: { width: 0.8 },
    }));

    const layout = {
      xaxis: { title: 'Time (s)', gridcolor: '#1e1e3a' },
      yaxis: { title: '', showticklabels: false, gridcolor: '#1e1e3a' },
      margin: { l: 32, r: 16, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, showlegend: true,
      legend: { font: { size: 9 } }, height: 320,
    };

    if (seizureOnset) {
      layout.shapes = [{
        type: 'line', x0: seizureOnset, x1: seizureOnset,
        y0: -2, y1: 35,
        line: { color: '#f43f5e', width: 2, dash: 'dash' },
      }];
      layout.annotations = [{
        x: seizureOnset, y: 35, text: 'Seizure Onset',
        font: { color: '#f43f5e', size: 10 }, showarrow: false,
      }];
    }

    Plotly.newPlot(containerId, traces, layout, { responsive: true, displayModeBar: false });
  },

  renderPCATimecourse(projected, fs, subsampleStep, containerId) {
    const N = projected.length;
    const time = Array.from({ length: N }, (_, i) => i * subsampleStep / fs);
    const nShow = Math.min(5, projected[0].length);

    const colors = ['#8b5cf6', '#c084fc', '#22d3a0', '#f59e0b', '#f43f5e'];
    const traces = [];
    for (let pc = 0; pc < nShow; pc++) {
      traces.push({
        x: time, y: projected.map(row => row[pc]),
        type: 'scatter', mode: 'lines', name: `PC${pc + 1}`,
        line: { width: 1.5, color: colors[pc] },
      });
    }

    Plotly.newPlot(containerId, traces, {
      xaxis: { title: 'Time (s)', gridcolor: '#1e1e3a' },
      yaxis: { title: 'Activation', gridcolor: '#1e1e3a' },
      margin: { l: 44, r: 16, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, legend: { x: 0, y: 1.2, orientation: 'h' },
      height: 250,
    }, { responsive: true, displayModeBar: false });
  },

  renderPCAHHCorrelation(correlations, containerId) {
    const hhVars = ['V', 'm', 'h', 'n'];
    const nPCs = correlations.length;
    const z = hhVars.map(hh => correlations.map(row => row[hh]));

    Plotly.newPlot(containerId, [{
      z,
      x: Array.from({ length: nPCs }, (_, i) => `PC${i + 1}`),
      y: hhVars.map(v => ({ V: 'Voltage', m: 'Na+ act.', h: 'Na+ inact.', n: 'K+ act.' }[v])),
      type: 'heatmap',
      colorscale: [
        [0, '#6d28d9'], [0.25, '#2d1b69'], [0.5, '#0c0c1d'],
        [0.75, '#69201e'], [1, '#f43f5e']
      ],
      zmin: -1, zmax: 1,
      colorbar: { title: 'r', titleside: 'right' },
    }], {
      margin: { l: 80, r: 50, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, height: 200,
    }, { responsive: true, displayModeBar: false });
  },

  renderPhysicsStates(physics, fs, containerId) {
    const T = physics.V.length;
    const time = Array.from({ length: T }, (_, i) => i / fs);

    const traces = [
      { y: physics.V, name: 'V (mV)', yaxis: 'y', line: { color: '#8b5cf6' } },
      { y: physics.m, name: 'm', yaxis: 'y2', line: { color: '#22d3a0' } },
      { y: physics.h, name: 'h', yaxis: 'y2', line: { color: '#f59e0b' } },
      { y: physics.n, name: 'n', yaxis: 'y2', line: { color: '#f43f5e' } },
    ].map(t => ({ ...t, x: time, type: 'scatter', mode: 'lines', line: { ...t.line, width: 1.2 } }));

    Plotly.newPlot(containerId, traces, {
      xaxis: { title: 'Time (s)', gridcolor: '#1e1e3a' },
      yaxis: { title: 'V (mV)', side: 'left', gridcolor: '#1e1e3a' },
      yaxis2: { title: 'Gating', side: 'right', overlaying: 'y', range: [0, 1] },
      margin: { l: 44, r: 44, t: 10, b: 36 },
      paper_bgcolor: this._bg, plot_bgcolor: this._bg,
      font: this._font, legend: { x: 0, y: 1.2, orientation: 'h' },
      height: 270,
    }, { responsive: true, displayModeBar: false });
  }
};
