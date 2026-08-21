import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import OverviewTab from './components/OverviewTab';
import AudioAnalyticsTab from './components/AudioAnalyticsTab';
import RecommenderTab from './components/RecommenderTab';
import PowerBiTab from './components/PowerBiTab';
import { AlertCircle, RefreshCw, Github } from 'lucide-react';
import { applyDatasetStats } from './utils/recommenderClient';

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  }
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON. Re-run pipeline/07_export_analytics.py.`);
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState(null);
  const [searchCatalog, setSearchCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);

        const [bundle, search] = await Promise.all([
          fetchJson('/analytics/dashboard_bundle.json'),
          fetchJson('/analytics/search_index.json'),
        ]);

        if (!bundle || typeof bundle !== 'object' || !bundle.kpis) {
          throw new Error('dashboard_bundle.json is missing expected KPI fields.');
        }
        if (!Array.isArray(search) || search.length === 0) {
          throw new Error('search_index.json is empty. The recommender needs the curated catalog.');
        }

        applyDatasetStats(bundle.feature_ranges);
        setDashboardData(bundle);
        setSearchCatalog(search);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error loading analytics datasets.';
        setError(message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-body">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 pb-12">
        {loading ? (
          <div className="glass-panel p-16 text-center space-y-4 my-12">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Loading MusicLens Analytics</h2>
              <p className="text-xs text-slate-400 font-mono">
                Fetching precomputed warehouse exports and the search catalog...
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="glass-panel p-12 text-center space-y-4 my-12 border-red-500/30 bg-red-950/20">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Analytics could not be loaded</h2>
              <p className="text-xs text-slate-400">{error}</p>
              <p className="text-xs text-slate-500 font-mono">
                Expected files: /analytics/dashboard_bundle.json and /analytics/search_index.json
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 inline-flex items-center gap-2 border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <div>
            {activeTab === 'overview' && <OverviewTab data={dashboardData} />}
            {activeTab === 'audio' && <AudioAnalyticsTab data={dashboardData} />}
            {activeTab === 'recommender' && <RecommenderTab searchCatalog={searchCatalog} />}
            {activeTab === 'powerbi' && <PowerBiTab />}
          </div>
        )}
      </main>

      <footer className="glass-panel border-t border-slate-800/80 bg-slate-950/80 mt-auto py-6 px-4 lg:px-8 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="font-bold text-slate-200">MusicLens</span>
            <span>•</span>
            <span>Spotify 30,000 Songs</span>
            <span>•</span>
            <span className="text-emerald-400">Static Vite on Vercel</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400">
            <span className="font-mono text-[11px]">React + Vite • PostgreSQL analytics • Client recommender</span>
            <span className="text-slate-600">|</span>
            <a
              href="https://github.com/inddivyansh/MusicLens"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-400 flex items-center gap-1 transition-colors"
            >
              <Github className="w-3.5 h-3.5" /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
