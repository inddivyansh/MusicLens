import React, { useState } from 'react';
import {
  Music,
  Users,
  Layers,
  TrendingUp,
  Zap,
  Clock,
  Search,
  Sparkles,
  Flame,
} from 'lucide-react';
import SectionHeader from './ui/SectionHeader';
import KpiStat from './ui/KpiStat';
import StatBar from './ui/StatBar';
import Pill from './ui/Pill';

export default function OverviewTab({ data }) {
  const [artistFilter, setArtistFilter] = useState('');

  const kpis = data?.kpis || {
    total_unique_tracks: 28352,
    total_unique_artists: 10692,
    total_macro_genres: 6,
    total_subgenres: 24,
    catalog_avg_popularity: 42.5,
    catalog_avg_energy_pct: 69.9,
    catalog_avg_danceability_pct: 65.5,
    catalog_avg_tempo_bpm: 122.1,
  };

  const genres = data?.genres || [];
  const topArtists = data?.top_artists || [];
  const decades = data?.decade_evolution || [];

  const filteredArtists = topArtists.filter((a) =>
    a.artist.toLowerCase().includes(artistFilter.toLowerCase())
  );

  const getGenreColorHex = (genre) => {
    switch ((genre || '').toLowerCase()) {
      case 'pop': return '#6366f1';
      case 'rap': return '#f59e0b';
      case 'rock': return '#ef4444';
      case 'latin': return '#14b8a6';
      case 'r&b': return '#ec4899';
      case 'edm': return '#22d3ee';
      default: return '#a1a1c2';
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <SectionHeader
        eyebrow="Your catalog, at a glance"
        title="Discover what's in the sound"
        description="A snapshot of what's in the catalog — genres, artists, and the sound that defines each one."
      />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <KpiStat
          label="Total Tracks"
          value={kpis.total_unique_tracks?.toLocaleString() || '28,352'}
          sub="Catalog volume"
          icon={Music}
          accent="purple"
          highlight={true}
        />
        <KpiStat
          label="Active Artists"
          value={kpis.total_unique_artists?.toLocaleString() || '10,692'}
          sub="Distinct artists"
          icon={Users}
          accent="indigo"
        />
        <KpiStat
          label="Macro Genres"
          value={kpis.total_macro_genres || 6}
          sub="24 Subgenres"
          icon={Layers}
          accent="cyan"
        />
        <KpiStat
          label="Avg Popularity"
          value={`${kpis.catalog_avg_popularity || '42.5'}`}
          sub="Scale of 0–100"
          icon={TrendingUp}
          accent="amber"
        />
        <KpiStat
          label="Catalog Energy"
          value={`${kpis.catalog_avg_energy_pct || '69.9'}%`}
          sub={`Dance: ${kpis.catalog_avg_danceability_pct || '65.5'}%`}
          icon={Zap}
          accent="purple"
        />
        <KpiStat
          label="Avg Tempo"
          value={`${kpis.catalog_avg_tempo_bpm || '122.1'}`}
          sub="BPM average"
          icon={Clock}
          accent="indigo"
        />
      </div>

      {/* Row 2: Genre Volume & Popularity Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Genre Volume Share */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white font-heading">
                Catalog Share by Genre
              </h2>
              <p className="text-xs text-[#a1a1c2]">
                Volume breakdown across the 6 major sound categories
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {genres.length === 0 && (
              <p className="text-xs text-[#6b6b8f]">No genre metrics available in this view.</p>
            )}
            {genres.map((g) => {
              const color = getGenreColorHex(g.genre);
              return (
                <div key={g.genre} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Pill label={g.genre} genre={g.genre} size="sm" />
                      <span className="text-[#a1a1c2] text-[11px]">
                        {g.unique_tracks?.toLocaleString()} songs
                      </span>
                    </div>
                    <span className="font-mono font-bold text-white">
                      {g.pct_of_catalog}%
                    </span>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${g.pct_of_catalog * 4}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-xs text-[#a1a1c2] flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
            <span>
              <strong>EDM</strong> and <strong>Rap</strong> represent the largest shares of the catalog, followed closely by <strong>Pop</strong> anthems.
            </span>
          </div>
        </div>

        {/* Popularity by Genre */}
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white font-heading">
                Average Popularity by Genre
              </h2>
              <p className="text-xs text-[#a1a1c2]">
                Stream-driven listener popularity across styles
              </p>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {genres.length === 0 && (
              <p className="text-xs text-[#6b6b8f]">No popularity metrics available in this view.</p>
            )}
            {genres.map((g) => {
              const maxPop = 60;
              const barPct = ((g.avg_popularity || 0) / maxPop) * 100;
              const color = getGenreColorHex(g.genre);
              return (
                <div key={g.genre} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <Pill label={g.genre} genre={g.genre} size="sm" />
                    <div className="flex items-center gap-1.5 font-mono">
                      <span className="text-amber-300 font-bold">{g.avg_popularity}</span>
                      <span className="text-[#6b6b8f] text-[10px]">/ 100</span>
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

          <div className="mt-4 p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-xs text-[#a1a1c2] flex items-start gap-2.5">
            <Flame className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Latin</strong> achieves the highest average popularity rating, driven by massive crossover hits and global radio rotation.
            </span>
          </div>
        </div>
      </div>

      {/* Row 3: Top Artist Leaderboard */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-white font-heading">
              Top Catalog Artists
            </h2>
            <p className="text-xs text-[#a1a1c2]">
              Artists with highest average track engagement
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#6b6b8f] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search artist..."
              value={artistFilter}
              onChange={(e) => setArtistFilter(e.target.value)}
              className="w-full bg-[#1e1533]/80 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#6b6b8f] focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[#6b6b8f] uppercase tracking-wider text-[10px]">
                <th className="pb-3 pl-2">#</th>
                <th className="pb-3">Artist</th>
                <th className="pb-3">Tracks</th>
                <th className="pb-3">Avg Popularity</th>
                <th className="pb-3">Peak</th>
                <th className="pb-3">Danceability</th>
                <th className="pb-3">Energy</th>
                <th className="pb-3 pr-2">Mood</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {filteredArtists.slice(0, 10).map((a, idx) => (
                <tr key={a.artist} className="hover:bg-white/[0.03] transition-colors">
                  <td className="py-3 pl-2 text-[#6b6b8f] font-bold">#{idx + 1}</td>
                  <td className="py-3 font-sans font-semibold text-white">
                    {a.artist}
                  </td>
                  <td className="py-3 text-[#a1a1c2]">{a.track_count}</td>
                  <td className="py-3">
                    <span className="font-bold text-amber-300">{a.avg_popularity}</span>
                  </td>
                  <td className="py-3 text-[#a1a1c2]">{a.max_popularity}</td>
                  <td className="py-3 text-indigo-300">{(a.avg_danceability * 100).toFixed(0)}%</td>
                  <td className="py-3 text-purple-300">{(a.avg_energy * 100).toFixed(0)}%</td>
                  <td className="py-3 pr-2 text-teal-300">{(a.avg_valence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredArtists.length === 0 && (
            <p className="text-xs text-[#6b6b8f] text-center py-6">No artists found matching that search.</p>
          )}
        </div>
      </div>
    </div>
  );
}
