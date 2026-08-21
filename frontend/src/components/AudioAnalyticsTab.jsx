import React, { useState } from 'react';
import { 
  BarChart3, 
  Activity, 
  Sparkles, 
  Compass, 
  Sliders, 
  Zap, 
  Heart, 
  Radio,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';

export default function AudioAnalyticsTab({ data }) {
  const [activeGenre, setActiveGenre] = useState('pop');
  const genres = data?.genres || [];
  const activeGenreData = genres.find(g => g.genre.toLowerCase() === activeGenre.toLowerCase()) || genres[0] || {};

  // Audio dimensions to compare
  const features = [
    { key: 'avg_energy', label: 'Energy', icon: Zap, color: '#ef4444', desc: 'Perceptual intensity & activity' },
    { key: 'avg_danceability', label: 'Danceability', icon: Activity, color: '#3b82f6', desc: 'Rhythm regularity & beat strength' },
    { key: 'avg_valence', label: 'Valence (Mood)', icon: Heart, color: '#10b981', desc: 'Musical positiveness / happiness' },
    { key: 'avg_acousticness', label: 'Acousticness', icon: Radio, color: '#f59e0b', desc: 'Confidence of natural acoustic instruments' },
    { key: 'avg_speechiness', label: 'Speechiness', icon: Sliders, color: '#8b5cf6', desc: 'Presence of spoken words / rap cadence' },
  ];

  // Hypothesis Test Results (from Step 03 EDA ANOVA / Kruskal-Wallis)
  const hypothesisResults = [
    { feature: 'Danceability', anovaF: '154.8', pVal: '< 0.001', etaSq: '0.187', effect: 'Large', leader: 'Rap (0.72) & Latin (0.71)' },
    { feature: 'Energy', anovaF: '188.4', pVal: '< 0.001', etaSq: '0.142', effect: 'Large', leader: 'EDM (0.80) & Rock (0.73)' },
    { feature: 'Speechiness', anovaF: '124.6', pVal: '< 0.001', etaSq: '0.115', effect: 'Medium', leader: 'Rap (0.22) vs Rock (0.05)' },
    { feature: 'Valence', anovaF: '94.2', pVal: '< 0.001', etaSq: '0.078', effect: 'Medium', leader: 'Latin (0.61) vs EDM (0.40)' },
    { feature: 'Acousticness', anovaF: '76.1', pVal: '< 0.001', etaSq: '0.065', effect: 'Medium', leader: 'R&B (0.22) & Pop (0.18)' },
  ];

  const moodSource = data?.mood_distribution || {};
  const moodPct = (label, fallback) => {
    const entry = moodSource[label];
    const value = entry?.percentage ?? fallback;
    return `${value}%`;
  };

  // Russell's Circumplex Mood Quadrants
  const moodQuadrants = [
    { title: 'Upbeat / Euphoric', range: 'High Energy • High Valence', pct: moodPct('Upbeat / Euphoric', 46.64), color: 'from-emerald-500/20 to-teal-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', desc: 'Dominant in Latin & Pop commercial anthems' },
    { title: 'Intense / Aggressive', range: 'High Energy • Low Valence', pct: moodPct('Intense / Aggressive', 38.13), color: 'from-red-500/20 to-orange-500/10', border: 'border-red-500/30', text: 'text-red-400', desc: 'Dominant in EDM drops & Hard Rock' },
    { title: 'Melancholic / Sad', range: 'Low Energy • Low Valence', pct: moodPct('Melancholic / Sad', 9.97), color: 'from-blue-500/20 to-indigo-500/10', border: 'border-blue-500/30', text: 'text-blue-400', desc: 'Dominant in Acoustic R&B & Indie ballads' },
    { title: 'Chill / Peaceful', range: 'Low Energy • High Valence', pct: moodPct('Chill / Peaceful', 5.27), color: 'from-purple-500/20 to-pink-500/10', border: 'border-purple-500/30', text: 'text-purple-400', desc: 'Dominant in Lo-Fi & Ambient pop' },
  ];

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="glass-panel p-6 bg-gradient-to-r from-purple-950/40 via-slate-900/60 to-blue-950/40 border border-purple-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-400 mb-2">
          <BarChart3 className="w-4 h-4" />
          Acoustic Intelligence & Statistical Inference • Page 2 of 3
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
          Audio Feature Dimensions & Cross-Genre Variation
        </h1>
        <p className="text-sm text-slate-300 max-w-3xl mt-1">
          Analysis of Spotify Echo Nest continuous acoustic features. One-Way ANOVA and Kruskal-Wallis hypothesis tests
          confirm statistically significant acoustic differentiation (p &lt; 0.001) across all macro-genres.
        </p>
      </div>

      {/* Row 1: Interactive Audio Profile Explorer by Genre */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Genre Selector Column */}
        <div className="glass-panel p-6 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Select Genre Profile</h2>
            <p className="text-xs text-slate-400">Inspect normalized acoustic signatures</p>
          </div>

          <div className="space-y-2">
            {genres.length === 0 && (
              <p className="text-xs text-slate-400">No genre audio profiles are present in the analytics bundle.</p>
            )}
            {genres.map((g) => {
              const isActive = activeGenre.toLowerCase() === g.genre.toLowerCase();
              return (
                <button
                  key={g.genre}
                  onClick={() => setActiveGenre(g.genre)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-blue-600/30 border border-blue-500 text-white shadow-lg shadow-blue-500/10'
                      : 'bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="capitalize text-sm">{g.genre}</span>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-slate-400 text-[11px]">{g.unique_tracks} tracks</span>
                    <span className="text-amber-400 font-bold">{g.avg_popularity} pop</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature Bars Breakdown for Selected Genre */}
        <div className="lg:col-span-2 glass-panel p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold capitalize text-white font-heading">
                  {activeGenreData.genre}
                </span>
                <span className="text-xs text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">
                  {activeGenreData.unique_tracks?.toLocaleString()} tracks
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Continuous acoustic feature averages [0.0 to 1.0]</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">Tempo</span>
              <span className="text-sm font-bold font-mono text-indigo-400">{activeGenreData.avg_tempo} BPM</span>
            </div>
          </div>

          <div className="space-y-4">
            {features.map((f) => {
              const val = activeGenreData[f.key] || 0;
              const pct = (val * 100).toFixed(1);
              const Icon = f.icon;
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color: f.color }} />
                      <span className="font-semibold text-slate-200">{f.label}</span>
                      <span className="text-[11px] text-slate-500 hidden sm:inline">— {f.desc}</span>
                    </div>
                    <span className="font-mono font-bold text-slate-100">{pct}%</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${pct}%`, backgroundColor: f.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg text-center">
              <span className="text-[10px] uppercase text-slate-500 font-semibold block">Loudness</span>
              <span className="text-sm font-bold font-mono text-slate-200">{activeGenreData.avg_loudness} dB</span>
            </div>
            <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg text-center">
              <span className="text-[10px] uppercase text-slate-500 font-semibold block">Instrumentalness</span>
              <span className="text-sm font-bold font-mono text-slate-200">{(activeGenreData.avg_instrumentalness * 100).toFixed(1)}%</span>
            </div>
            <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg text-center">
              <span className="text-[10px] uppercase text-slate-500 font-semibold block">Liveness</span>
              <span className="text-sm font-bold font-mono text-slate-200">{(activeGenreData.avg_liveness * 100).toFixed(1)}%</span>
            </div>
            <div className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-lg text-center">
              <span className="text-[10px] uppercase text-slate-500 font-semibold block">Popularity</span>
              <span className="text-sm font-bold font-mono text-amber-400">{activeGenreData.avg_popularity}</span>
            </div>
          </div>
        </div>

      </div>

      {/* Row 2: Russell's Circumplex Mood Quadrants */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Russell's Circumplex Mood Model Segmentation</h2>
            <p className="text-xs text-slate-400">2D Energy vs Valence mood classification across 28,352 songs</p>
          </div>
          <span className="text-xs font-mono text-blue-400 bg-blue-950/60 border border-blue-800/80 px-2.5 py-1 rounded-md">
            Circumplex 2D Model
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {moodQuadrants.map((m) => (
            <div key={m.title} className={`p-4 rounded-xl bg-gradient-to-b ${m.color} border ${m.border} space-y-2`}>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${m.text}`}>{m.title}</span>
                <span className="text-lg font-extrabold font-mono text-white">{m.pct}</span>
              </div>
              <span className="text-[11px] text-slate-400 block font-mono">{m.range}</span>
              <p className="text-xs text-slate-300">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Hypothesis Testing & ANOVA Effect Size Table */}
      <div className="glass-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Cross-Genre Statistical Significance (ANOVA &amp; Kruskal-Wallis)</h2>
            <p className="text-xs text-slate-400">Parametric F-test and Non-Parametric H-test evaluating whether audio feature variance across genres is real</p>
          </div>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-md flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            All p &lt; 0.001
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse font-mono">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="pb-3 pl-2">Feature</th>
                <th className="pb-3">ANOVA F-Statistic</th>
                <th className="pb-3">p-value</th>
                <th className="pb-3">Eta-Squared (&eta;&sup2;)</th>
                <th className="pb-3">Effect Size</th>
                <th className="pb-3 pr-2">Leading Genre Contrast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {hypothesisResults.map((r) => (
                <tr key={r.feature} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 pl-2 font-sans font-semibold text-slate-100">{r.feature}</td>
                  <td className="py-2.5 text-blue-400 font-bold">{r.anovaF}</td>
                  <td className="py-2.5 text-emerald-400">{r.pVal}</td>
                  <td className="py-2.5 text-amber-400">{r.etaSq}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.effect === 'Large' ? 'bg-purple-950/80 text-purple-300 border border-purple-800' : 'bg-blue-950/80 text-blue-300 border border-blue-800'
                    }`}>
                      {r.effect} Effect
                    </span>
                  </td>
                  <td className="py-2.5 pr-2 font-sans text-slate-300">{r.leader}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
