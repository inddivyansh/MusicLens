import React, { useState } from 'react';
import {
  Copy,
  Check,
  FileSpreadsheet,
  Code2,
  BookOpen,
} from 'lucide-react';
import SectionHeader from './ui/SectionHeader';

export default function PowerBiTab() {
  const [copiedIndex, setCopiedIndex] = useState(null);

  const DAX_MEASURES = [
    {
      name: 'Total Tracks',
      code: `Total Tracks = \nDISTINCTCOUNT('Fact_Tracks'[track_id])`,
      desc: 'Count of unique Spotify song records in catalog',
    },
    {
      name: 'Catalog Stream Share %',
      code: `Catalog Stream Share % = \nDIVIDE(\n    [Total Tracks],\n    CALCULATE([Total Tracks], ALL('Fact_Tracks')),\n    0\n)`,
      desc: 'Percentage contribution of genre to total catalog',
    },
    {
      name: 'Popularity 95% CI Upper & Lower',
      code: `Popularity 95CI Upper = \n[Avg Popularity] + 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)\n\nPopularity 95CI Lower = \n[Avg Popularity] - 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)`,
      desc: 'Statistical confidence interval bounds for popularity',
    },
    {
      name: 'User Mood Classification (Circumplex)',
      code: `User Mood Classification = \nSWITCH(\n    TRUE(),\n    [Avg Energy %] >= 50 && [Avg Valence %] >= 50, "Upbeat / Euphoric",\n    [Avg Energy %] < 50  && [Avg Valence %] >= 50, "Chill / Peaceful",\n    [Avg Energy %] >= 50 && [Avg Valence %] < 50,  "Intense / Aggressive",\n    "Melancholic / Sad"\n)`,
      desc: 'Circumplex 2D energy/valence classification',
    },
    {
      name: 'Composite Dance Energy Score',
      code: `Composite Dance Energy Score = \nSQRT([Avg Danceability %] * [Avg Energy %])`,
      desc: 'Geometric mean combining rhythmic and energetic dimensions',
    },
  ];

  const handleCopy = async (text, idx) => {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      setCopiedIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <SectionHeader
        eyebrow="Developer & Analytics Spec"
        title="Data Model & BI Blueprint"
        description="Architecture blueprint, calculated DAX metrics, and data structures for external business intelligence."
      />

      {/* Dashboard Architecture Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-5 space-y-3 border-t-2 border-t-indigo-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Report 1</span>
            <span className="text-[10px] text-[#6b6b8f] font-mono">Overview</span>
          </div>
          <h2 className="text-base font-bold text-white font-heading">Catalog Summary</h2>
          <p className="text-xs text-[#a1a1c2] leading-relaxed">
            High-level metrics, genre distribution, popularity confidence intervals, and artist leaderboards.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-white/5 text-[11px] font-mono text-[#a1a1c2]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              <span>Catalog volume KPIs</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              <span>Genre volume share charts</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              <span>Mean popularity error bars</span>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5 space-y-3 border-t-2 border-t-purple-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Report 2</span>
            <span className="text-[10px] text-[#6b6b8f] font-mono">Acoustic Stats</span>
          </div>
          <h2 className="text-base font-bold text-white font-heading">Acoustic Analytics</h2>
          <p className="text-xs text-[#a1a1c2] leading-relaxed">
            Multi-feature radar charts, statistical ANOVA effect sizes, circumplex mood quadrants, and scatter plots.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-white/5 text-[11px] font-mono text-[#a1a1c2]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span>Radar acoustic profile</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span>ANOVA effect size table</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span>Circumplex mood distribution</span>
            </div>
          </div>
        </div>

        <div className="glass-panel p-5 space-y-3 border-t-2 border-t-teal-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-teal-400 uppercase tracking-wider">Report 3</span>
            <span className="text-[10px] text-[#6b6b8f] font-mono">Personalization</span>
          </div>
          <h2 className="text-base font-bold text-white font-heading">Taste Profile &amp; Match</h2>
          <p className="text-xs text-[#a1a1c2] leading-relaxed">
            Listening profile synthesis, personality archetype classification, and explainable recommendations.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-white/5 text-[11px] font-mono text-[#a1a1c2]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span>Archetype classification</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span>Feature benchmark matrix</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              <span>Recommendation attribution</span>
            </div>
          </div>
        </div>
      </div>

      {/* DAX Measures Reference Library */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white font-heading">
              Calculated Measures Reference Library
            </h2>
            <p className="text-xs text-[#a1a1c2]">
              DAX metric formulas for external reporting tools
            </p>
          </div>
          <span className="text-xs font-mono text-purple-300 bg-purple-500/10 px-2.5 py-1 rounded-md border border-purple-500/20">
            {DAX_MEASURES.length} Core Measures
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {DAX_MEASURES.map((m, idx) => (
            <div key={m.name} className="glass-card-interactive p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm text-white">{m.name}</span>
                  <span className="text-xs text-[#a1a1c2] block">{m.desc}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(m.code, idx)}
                  className="px-3 py-1.5 rounded-xl bg-[#1e1533] hover:bg-[#2a1f45] text-xs font-mono flex items-center gap-1.5 transition-colors border border-white/10 text-purple-300"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-purple-300" />
                      <span>Copy Formula</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 bg-[#140e24] rounded-xl text-xs font-mono text-purple-200 overflow-x-auto border border-white/5">
                {m.code}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
