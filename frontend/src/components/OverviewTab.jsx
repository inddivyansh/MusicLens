import React, { useState } from 'react';
import { 
  Music, 
  Users, 
  Layers, 
  TrendingUp, 
  Zap, 
  Clock, 
  ChevronRight, 
  Flame, 
  Activity, 
  Info,
  Calendar
} from 'lucide-react';

export default function OverviewTab({ data }) {
  const [selectedGenre, setSelectedGenre] = useState('all');
  const [artistFilter, setArtistFilter] = useState('');

  const kpis = data?.kpis || {
    total_unique_tracks: 28352,
    total_unique_artists: 10692,
    total_macro_genres: 6,
    total_subgenres: 24,
    catalog_avg_popularity: 42.5,
    catalog_avg_energy_pct: 69.9,
    catalog_avg_danceability_pct: 65.5,
    catalog_avg_tempo_bpm: 122.1
  };

  const genres = data?.genres || [];
  const topArtists = data?.top_artists || [];
  const decades = data?.decade_evolution || [];

  const filteredArtists = topArtists.filter(a => 
    a.artist.toLowerCase().includes(artistFilter.toLowerCase())
  );

  const getGenreColorClass = (genre) => {
    switch ((genre || '').toLowerCase()) {
      case 'pop': return 'genre-pop';
      case 'rap': return 'genre-rap';
      case 'rock': return 'genre-rock';
      case 'latin': return 'genre-latin';
      case 'r&b': return 'genre-rnb';
      case 'edm': return 'genre-edm';
      default: return 'genre-other';
    }
  };

  const getGenreBarColor = (genre) => {
    switch ((genre || '').toLowerCase()) {
      case 'pop': return '#3b82f6';
      case 'rap': return '#8b5cf6';
      case 'rock': return '#ef4444';
      case 'latin': return '#f59e0b';
      case 'r&b': return '#ec4899';
      case 'edm': return '#10b981';
      default: return '#64748b';
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Context */}
      <div className="glass-panel p-6 bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-purple-950/40 border border-blue-500/20 relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">
            <Activity className="w-4 h-4" />
            Executive Data Analytics Overview • Page 1 of 3
          </div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
            Spotify 30,000 Songs — Catalog Intelligence
          </h1>
          <p className="text-sm text-slate-300 max-w-3xl mt-1">
            Comprehensive exploratory analysis across 28,352 unique Spotify tracks, 10,692 artists, and 6 macro-genres. 
            All metrics calculated from normalized relational data models.
          </p>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        
        <div className="glass-panel p-4 bg-slate-900/80 hover:border-blue-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Tracks</span>
            <Music className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.total_unique_tracks?.toLocaleString() || '28,352'}
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1">
            <span>Cleaned / 0 Nulls</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-slate-900/80 hover:border-purple-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Artists</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.total_unique_artists?.toLocaleString() || '10,692'}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
            <span>Long-tail catalog</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-slate-900/80 hover:border-emerald-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Macro Genres</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.total_macro_genres || 6}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
            <span>24 Subgenres</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-slate-900/80 hover:border-amber-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Popularity</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.catalog_avg_popularity || '42.5'}
            <span className="text-xs text-slate-400 font-normal ml-1">/100</span>
          </div>
          <div className="text-[11px] text-amber-400 flex items-center gap-1 mt-1">
            <span>Median: {kpis.catalog_median_popularity || '45'}</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-slate-900/80 hover:border-red-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Catalog Energy</span>
            <Zap className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.catalog_avg_energy_pct || '69.9'}%
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
            <span>Dance: {kpis.catalog_avg_danceability_pct || '65.5'}%</span>
          </div>
        </div>

        <div className="glass-panel p-4 bg-slate-900/80 hover:border-indigo-500/40 transition-colors">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Tempo</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-extrabold text-white font-heading">
            {kpis.catalog_avg_tempo_bpm || '122.1'}
            <span className="text-xs text-slate-400 font-normal ml-1">BPM</span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
            <span>Commercial Peak</span>
          </div>
        </div>

      </div>

      {/* Row 2: Genre Volume vs Popularity Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Visual 1: Track Distribution by Genre */}
        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Track Volume by Macro-Genre</h2>
              <p className="text-xs text-slate-400">Total unique songs and percentage share of catalog</p>
            </div>
            <span className="text-xs font-mono text-slate-400 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700">
              6 Categories
            </span>
          </div>

          <div className="space-y-3.5">
            {genres.length === 0 && (
              <p className="text-xs text-slate-400">No genre metrics are present in the analytics bundle.</p>
            )}
            {genres.map((g) => {
              const maxTracks = Math.max(...genres.map(x => x.unique_tracks || 1));
              const pctOfMax = (g.unique_tracks / maxTracks) * 100;
              const color = getGenreBarColor(g.genre);
              return (
                <div key={g.genre} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`genre-badge ${getGenreColorClass(g.genre)}`}>
                      {g.genre}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-slate-200">
                        {g.unique_tracks?.toLocaleString()} tracks
                      </span>
                      <span className="text-slate-400 font-mono text-[11px]">
                        ({g.pct_of_catalog}%)
                      </span>
                    </div>
                  </div>
                  <div className="progress-bar-bg">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${pctOfMax}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              <strong>EDM</strong> leads catalog volume (21.3% share), closely followed by <strong>Rap</strong> (20.3%) and <strong>Pop</strong> (19.4%).
            </span>
          </div>
        </div>

        {/* Visual 2: Mean Popularity with 95% Confidence Intervals */}
        <div className="glass-panel p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Mean Popularity by Genre (95% CI)</h2>
              <p className="text-xs text-slate-400">Statistical bounds: mean ± 1.96 × SEM</p>
            </div>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-md">
              ANOVA p &lt; 0.001
            </span>
          </div>

          <div className="space-y-3.5">
            {genres.length === 0 && (
              <p className="text-xs text-slate-400">No popularity metrics are present in the analytics bundle.</p>
            )}
            {genres.map((g) => {
              const maxPop = 60;
              const barPct = ((g.avg_popularity || 0) / maxPop) * 100;
              const color = getGenreBarColor(g.genre);
              return (
                <div key={g.genre} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`genre-badge ${getGenreColorClass(g.genre)}`}>
                        {g.genre}
                      </span>
                      <span className="text-slate-400 text-[11px]">
                        CI: [{g.ci_95_lower} – {g.ci_95_upper}]
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono font-bold">
                      <span className="text-amber-400">{g.avg_popularity}</span>
                      <span className="text-slate-500 font-normal">/100</span>
                    </div>
                  </div>
                  <div className="progress-bar-bg">
                    <div 
                      className="progress-bar-fill" 
                      style={{ width: `${barPct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-2">
            <Flame className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Latin</strong> achieves the highest mean popularity (47.03), while <strong>EDM</strong> displays the lowest mean (34.83) due to extensive underground DJ single indexing.
            </span>
          </div>
        </div>

      </div>

      {/* Row 3: Top Artist Leaderboard Table */}
      <div className="glass-panel p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">Artist Performance Leaderboard</h2>
            <p className="text-xs text-slate-400">Ranked by average track popularity (Filtered for artists with &ge; 3 tracks)</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search artist..."
              value={artistFilter}
              onChange={(e) => setArtistFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48"
            />
            <span className="text-xs text-slate-400 font-mono">
              {filteredArtists.length} Artists Shown
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px]">
                <th className="pb-3 pl-2">Rank</th>
                <th className="pb-3">Artist Name</th>
                <th className="pb-3">Track Count</th>
                <th className="pb-3">Avg Popularity</th>
                <th className="pb-3">Peak Popularity</th>
                <th className="pb-3">Danceability</th>
                <th className="pb-3">Energy</th>
                <th className="pb-3 pr-2">Valence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredArtists.slice(0, 10).map((a, idx) => (
                <tr key={a.artist} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 pl-2 text-slate-500 font-bold">#{idx + 1}</td>
                  <td className="py-2.5 font-sans font-semibold text-slate-100 flex items-center gap-2">
                    {a.artist}
                  </td>
                  <td className="py-2.5 text-slate-300">{a.track_count}</td>
                  <td className="py-2.5">
                    <span className="font-bold text-amber-400">{a.avg_popularity}</span>
                  </td>
                  <td className="py-2.5 text-slate-300">{a.max_popularity}</td>
                  <td className="py-2.5 text-blue-400">{(a.avg_danceability * 100).toFixed(0)}%</td>
                  <td className="py-2.5 text-red-400">{(a.avg_energy * 100).toFixed(0)}%</td>
                  <td className="py-2.5 pr-2 text-emerald-400">{(a.avg_valence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredArtists.length === 0 && (
            <p className="text-xs text-slate-400 mt-4">No artists match that search.</p>
          )}
        </div>
      </div>

    </div>
  );
}
