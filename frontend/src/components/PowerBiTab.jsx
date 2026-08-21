import React, { useState } from 'react';
import { 
  Radio, 
  Database, 
  Copy, 
  Check, 
  Layers, 
  BarChart, 
  Sliders, 
  FileSpreadsheet, 
  ExternalLink,
  Code2
} from 'lucide-react';

export default function PowerBiTab() {
  const [copiedIndex, setCopiedIndex] = useState(null);

  const DAX_MEASURES = [
    {
      name: 'Total Tracks',
      code: `Total Tracks = \nDISTINCTCOUNT('Fact_Tracks'[track_id])`,
      desc: 'Count of unique Spotify song records'
    },
    {
      name: 'Catalog Stream Share %',
      code: `Catalog Stream Share % = \nDIVIDE(\n    [Total Tracks],\n    CALCULATE([Total Tracks], ALL('Fact_Tracks')),\n    0\n)`,
      desc: 'Percentage contribution of genre to total catalog'
    },
    {
      name: 'Popularity 95% CI Upper & Lower',
      code: `Popularity 95CI Upper = \n[Avg Popularity] + 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)\n\nPopularity 95CI Lower = \n[Avg Popularity] - 1.96 * DIVIDE([Popularity StdDev], SQRT([Total Tracks]), 0)`,
      desc: 'Statistical confidence interval error bars for popularity'
    },
    {
      name: 'User Mood Classification (Circumplex)',
      code: `User Mood Classification = \nSWITCH(\n    TRUE(),\n    [Avg Energy %] >= 50 && [Avg Valence %] >= 50, "Upbeat / Euphoric",\n    [Avg Energy %] < 50  && [Avg Valence %] >= 50, "Chill / Peaceful",\n    [Avg Energy %] >= 50 && [Avg Valence %] < 50,  "Intense / Aggressive",\n    "Melancholic / Sad"\n)`,
      desc: 'Russell Circumplex 2D energy/valence classification'
    },
    {
      name: 'Composite Dance Energy Score',
      code: `Composite Dance Energy Score = \nSQRT([Avg Danceability %] * [Avg Energy %])`,
      desc: 'Geometric mean combining rhythmic and energetic dimensions'
    }
  ];

  const handleCopy = async (text, idx) => {
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard is not available');
      }
      await navigator.clipboard.writeText(text);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      setCopiedIndex(null);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="glass-panel p-6 bg-gradient-to-r from-amber-950/40 via-slate-900/60 to-blue-950/40 border border-amber-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400 mb-2">
          <Radio className="w-4 h-4" />
          Enterprise BI &amp; Dashboard Specification • Page 4 of 4
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
          Power BI Integration &amp; 3-Page Dashboard Blueprint
        </h1>
        <p className="text-sm text-slate-300 max-w-3xl mt-1">
          This tab is a dashboard specification and DAX reference — not a published Power BI Service report.
          Connect Power BI Desktop to PostgreSQL locally, or import CSV views from
          <code className="text-amber-400 bg-slate-900 px-1 py-0.5 rounded">data/exports/powerbi/</code>.
        </p>
      </div>

      {/* 3-Page Dashboard Architecture Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Page 1 Spec Card */}
        <div className="glass-panel p-5 space-y-3 border-t-4 border-t-blue-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Page 1</span>
            <span className="text-[10px] text-slate-500 font-mono">Executive Summary</span>
          </div>
          <h2 className="text-lg font-bold text-white">Music Catalog Overview</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            High-level KPI cards, macro-genre volume breakdown, popularity distribution with 95% confidence intervals, and prolific artist leaderboards.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              <span>5 KPI Summary Cards (Tracks, Artists, Genres)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              <span>Horizontal Clustered Bar (Genre Share %)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              <span>Error Bar Column Chart (Mean Pop ± CI)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              <span>Top Artists Matrix Table with Data Bars</span>
            </div>
          </div>
        </div>

        {/* Page 2 Spec Card */}
        <div className="glass-panel p-5 space-y-3 border-t-4 border-t-purple-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">Page 2</span>
            <span className="text-[10px] text-slate-500 font-mono">Acoustic Stats</span>
          </div>
          <h2 className="text-lg font-bold text-white">Audio Feature Analytics</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Multi-feature radar charts, ANOVA statistical effect sizes (eta-squared), Russell circumplex mood quadrant donut visual, and regression scatter plots.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              <span>Spider / Radar Chart (Acoustic Profiles)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              <span>ANOVA Effect Size Table (&eta;&sup2; &gt; 0.14)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              <span>Circumplex Mood Donut Visual (4 Quadrants)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
              <span>Popularity vs Energy Scatter with Trendline</span>
            </div>
          </div>
        </div>

        {/* Page 3 Spec Card */}
        <div className="glass-panel p-5 space-y-3 border-t-4 border-t-emerald-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Page 3</span>
            <span className="text-[10px] text-slate-500 font-mono">Personalization</span>
          </div>
          <h2 className="text-lg font-bold text-white">User Profile &amp; Recommender</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Listening taste profile synthesis, personality archetype classification, acoustic benchmark comparison, and explainable top-N recommendations.
          </p>
          <div className="space-y-1.5 pt-2 border-t border-slate-800 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Archetype Callout Card (7 Archetypes)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>User Feature vs Catalog Benchmark Area</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Recommended Songs Matrix (Similarity %)</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>Primary Feature Attribution Indicators</span>
            </div>
          </div>
        </div>

      </div>

      {/* DAX Measures Reference Library */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">DAX Measures Reference Library</h2>
            <p className="text-xs text-slate-400">Production-ready DAX formulas for the Power BI measure table</p>
          </div>
          <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700">
            {DAX_MEASURES.length} Core Formulas
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {DAX_MEASURES.map((m, idx) => (
            <div key={m.name} className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm text-slate-200">{m.name}</span>
                  <span className="text-xs text-slate-400 block">{m.desc}</span>
                </div>
                <button
                  onClick={() => handleCopy(m.code, idx)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono flex items-center gap-1.5 transition-colors border border-slate-700"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy DAX</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto border border-slate-800/80">
                {m.code}
              </pre>
            </div>
          ))}
        </div>
      </div>

      {/* Database Connection Instructions */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-bold text-white">
          <Database className="w-5 h-5 text-blue-400" />
          Step-by-Step Connection Instructions
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
            <span className="font-bold text-blue-400 uppercase text-[11px] block">Option A: PostgreSQL / Neon Connection</span>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
              <li>Open Power BI Desktop → Click <strong>Get Data</strong> → <strong>PostgreSQL database</strong>.</li>
              <li>Enter the host from your local <code className="text-blue-300 bg-slate-950 px-1 py-0.5 rounded">DATABASE_URL</code> (never from the Vercel frontend).</li>
              <li>Enter Database name: <code className="text-blue-300 bg-slate-950 px-1 py-0.5 rounded">musiclens</code>.</li>
              <li>Select <strong>Import</strong> mode for sub-second visual performance.</li>
              <li>Select views: <code className="text-blue-300">v_genre_summary</code>, <code className="text-blue-300">v_artist_leaderboard</code>, <code className="text-blue-300">v_top_tracks</code>.</li>
            </ol>
          </div>

          <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
            <span className="font-bold text-amber-400 uppercase text-[11px] block">Option B: Offline CSV Import</span>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
              <li>Run the export script: <code className="text-amber-300 bg-slate-950 px-1 py-0.5 rounded">python pipeline/07_export_analytics.py</code>.</li>
              <li>Open Power BI Desktop → Click <strong>Get Data</strong> → <strong>Text/CSV</strong>.</li>
              <li>Browse to <code className="text-amber-300">data/exports/powerbi/</code>.</li>
              <li>Import <code className="text-amber-300">pbi_genre_summary.csv</code> and <code className="text-amber-300">pbi_artist_leaderboard.csv</code>.</li>
              <li>Apply the DAX formulas above to create relationships and visualizations.</li>
            </ol>
          </div>
        </div>
      </div>

    </div>
  );
}
