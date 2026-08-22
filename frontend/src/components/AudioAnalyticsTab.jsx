import React, { useState } from 'react';
import {
  Zap,
  Activity,
  Heart,
  Radio,
  Sliders,
  Sparkles,
  Compass,
} from 'lucide-react';
import SectionHeader from './ui/SectionHeader';
import StatBar from './ui/StatBar';
import InsightCard from './ui/InsightCard';
import Pill from './ui/Pill';

export default function AudioAnalyticsTab({ data }) {
  const [activeGenre, setActiveGenre] = useState('pop');
  const genres = data?.genres || [];
  const activeGenreData =
    genres.find((g) => g.genre.toLowerCase() === activeGenre.toLowerCase()) ||
    genres[0] ||
    {};

  const features = [
    { key: 'avg_energy', label: 'Energy', icon: Zap, color: '#a855f7', desc: 'Intensity, volume & drive' },
    { key: 'avg_danceability', label: 'Danceability', icon: Activity, color: '#6366f1', desc: 'Rhythm regularity & beat presence' },
    { key: 'avg_valence', label: 'Valence (Mood)', icon: Heart, color: '#ec4899', desc: 'Musical optimism & positive energy' },
    { key: 'avg_acousticness', label: 'Acousticness', icon: Radio, color: '#14b8a6', desc: 'Organic acoustic instrumentation' },
    { key: 'avg_speechiness', label: 'Speechiness', icon: Sliders, color: '#f59e0b', desc: 'Spoken phrasing & vocal cadence' },
  ];

  const insights = [
    {
      title: 'Danceability by Style',
      takeaway: 'Rhythm and beat strength differentiate genres the most, driven by modern drum phrasing.',
      leader: 'Rap (72%) & Latin (71%) leading',
      mathDetails: { anovaF: '154.8', pVal: '< 0.001', etaSq: '0.187', effect: 'Large' },
    },
    {
      title: 'Energy & Peak Intensity',
      takeaway: 'Festival anthems and rock productions show highest perceptual loudness and tempo.',
      leader: 'EDM (80%) & Rock (73%) leading',
      mathDetails: { anovaF: '188.4', pVal: '< 0.001', etaSq: '0.142', effect: 'Large' },
    },
    {
      title: 'Vocal Phrasing & Cadence',
      takeaway: 'Spoken-word density creates distinct separation between urban rhythmic tracks and guitar-led genres.',
      leader: 'Rap (22%) vs Rock (5%)',
      mathDetails: { anovaF: '124.6', pVal: '< 0.001', etaSq: '0.115', effect: 'Medium' },
    },
    {
      title: 'Emotional Mood & Valence',
      takeaway: 'Latin tracks exhibit highest positive keys and joyful melody contours.',
      leader: 'Latin (61%) vs EDM (40%)',
      mathDetails: { anovaF: '94.2', pVal: '< 0.001', etaSq: '0.078', effect: 'Medium' },
    },
    {
      title: 'Acoustic Warmth',
      takeaway: 'Natural acoustic instrumentation is most prominent in traditional R&B and ballad arrangements.',
      leader: 'R&B (22%) & Pop (18%)',
      mathDetails: { anovaF: '76.1', pVal: '< 0.001', etaSq: '0.065', effect: 'Medium' },
    },
  ];

  const moodSource = data?.mood_distribution || {};
  const moodPct = (label, fallback) => {
    const entry = moodSource[label];
    const value = entry?.percentage ?? fallback;
    return `${value}%`;
  };

  const moodQuadrants = [
    {
      title: 'Upbeat / Euphoric',
      range: 'High Energy • High Valence',
      pct: moodPct('Upbeat / Euphoric', 46.64),
      color: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
      desc: 'Dominant in Latin rhythms & commercial Pop anthems',
    },
    {
      title: 'Intense / Aggressive',
      range: 'High Energy • Low Valence',
      pct: moodPct('Intense / Aggressive', 38.13),
      color: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
      desc: 'Dominant in EDM drops, dark trap & hard rock',
    },
    {
      title: 'Melancholic / Sad',
      range: 'Low Energy • Low Valence',
      pct: moodPct('Melancholic / Sad', 9.97),
      color: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
      desc: 'Dominant in introspective R&B & indie ballads',
    },
    {
      title: 'Chill / Peaceful',
      range: 'Low Energy • High Valence',
      pct: moodPct('Chill / Peaceful', 5.27),
      color: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      desc: 'Dominant in relaxed lounge & ambient pop',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <SectionHeader
        eyebrow="What makes a genre sound like a genre"
        title="Audio Analytics"
        description="Explore audio feature signatures across genres, mood classifications, and distinct sonic profiles."
      />

      {/* Row 1: Interactive Audio Profile Explorer by Genre */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Genre Selector Column */}
        <div className="glass-panel p-6 space-y-4">
          <div>
            <h2 className="text-base font-bold text-white font-heading">
              Pick a Genre Profile
            </h2>
            <p className="text-xs text-[#a1a1c2]">
              Select a category to view its acoustic profile
            </p>
          </div>

          <div className="space-y-2">
            {genres.length === 0 && (
              <p className="text-xs text-[#6b6b8f]">No genre audio profiles available in bundle.</p>
            )}
            {genres.map((g) => {
              const isActive = activeGenre.toLowerCase() === g.genre.toLowerCase();
              return (
                <button
                  key={g.genre}
                  type="button"
                  onClick={() => setActiveGenre(g.genre)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-signature-gradient text-white shadow-lg shadow-purple-950/40 border border-purple-400/40'
                      : 'bg-[#1e1533]/60 border border-white/5 text-[#a1a1c2] hover:text-white hover:bg-[#2a1f45]'
                  }`}
                >
                  <span className="capitalize text-sm font-heading">{g.genre}</span>
                  <div className="flex items-center gap-3 font-mono">
                    <span className="text-[11px] opacity-80">{g.unique_tracks} tracks</span>
                    <span className="text-amber-300 font-bold">{g.avg_popularity} pop</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature Bars Breakdown for Selected Genre */}
        <div className="lg:col-span-2 glass-panel p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold capitalize text-white font-heading">
                  {activeGenreData.genre}
                </span>
                <Pill label={activeGenreData.genre} genre={activeGenreData.genre} size="sm" />
              </div>
              <p className="text-xs text-[#a1a1c2]">
                Average audio characteristics across {activeGenreData.unique_tracks?.toLocaleString()} songs
              </p>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-[#6b6b8f] uppercase tracking-wider block">Avg Tempo</span>
              <span className="text-base font-bold font-mono text-purple-300">
                {activeGenreData.avg_tempo} BPM
              </span>
            </div>
          </div>

          <div className="space-y-4">
            {features.map((f) => {
              const val = activeGenreData[f.key] || 0;
              const pct = val * 100;
              const Icon = f.icon;
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 text-purple-400" />
                      <span className="font-semibold text-white">{f.label}</span>
                      <span className="text-[11px] text-[#6b6b8f] hidden sm:inline">— {f.desc}</span>
                    </div>
                    <span className="font-mono font-bold text-white">{pct.toFixed(1)}%</span>
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-white/5">
            <div className="p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-center">
              <span className="text-[10px] uppercase text-[#6b6b8f] font-semibold block">Loudness</span>
              <span className="text-sm font-bold font-mono text-white">{activeGenreData.avg_loudness} dB</span>
            </div>
            <div className="p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-center">
              <span className="text-[10px] uppercase text-[#6b6b8f] font-semibold block">Instrumental</span>
              <span className="text-sm font-bold font-mono text-white">
                {((activeGenreData.avg_instrumentalness || 0) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-center">
              <span className="text-[10px] uppercase text-[#6b6b8f] font-semibold block">Liveness</span>
              <span className="text-sm font-bold font-mono text-white">
                {((activeGenreData.avg_liveness || 0) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl text-center">
              <span className="text-[10px] uppercase text-[#6b6b8f] font-semibold block">Popularity</span>
              <span className="text-sm font-bold font-mono text-amber-300">{activeGenreData.avg_popularity}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Mood Quadrants */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white font-heading">
              Mood Quadrant Distribution
            </h2>
            <p className="text-xs text-[#a1a1c2]">
              Energy vs Valence mood categorization across the entire catalog
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {moodQuadrants.map((m) => (
            <div key={m.title} className={`p-4 rounded-xl border ${m.color} space-y-2`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">{m.title}</span>
                <span className="text-lg font-extrabold font-mono text-white">{m.pct}</span>
              </div>
              <span className="text-[11px] text-[#a1a1c2] block font-mono">{m.range}</span>
              <p className="text-xs text-[#f5f3ff]/80 leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Row 3: Key Acoustic Takeaways */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-white font-heading">
            Key Sonic Differences
          </h2>
          <p className="text-xs text-[#a1a1c2]">
            Data-backed findings explaining how genre sounds differ across features
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {insights.map((item) => (
            <InsightCard
              key={item.title}
              title={item.title}
              takeaway={item.takeaway}
              leader={item.leader}
              mathDetails={item.mathDetails}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
