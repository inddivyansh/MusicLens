import React, { useState, useEffect, useMemo } from 'react';
import { 
  Sparkles, 
  Search, 
  Plus, 
  X, 
  SlidersHorizontal, 
  Zap, 
  Music, 
  User, 
  Activity, 
  Check, 
  RotateCcw,
  Flame,
  Info,
  Sliders,
  Heart,
  Radio,
  Clock
} from 'lucide-react';
import { computeUserProfile, generateRecommendations } from '../utils/recommenderClient';

export default function RecommenderTab({ searchCatalog }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSongs, setSelectedSongs] = useState([]);
  const [genreFilter, setGenreFilter] = useState('all');
  const [minPopularity, setMinPopularity] = useState(0);
  const [topN, setTopN] = useState(10);
  const [activePersona, setActivePersona] = useState(null);

  // Preset Personas for quick one-click exploration
  const PRESET_PERSONAS = [
    {
      name: 'Pop & Dance',
      icon: '🎉',
      seeds: ['2bPG05tph4ZaUtV0RA6Gbt', '7qiZfU4dY1lWllzX7mPBI3', '6habFhsOp2NvshLv26DqMb'],
      desc: 'Upbeat commercial pop, high danceability and cheerful melodies'
    },
    {
      name: 'EDM Peak Time',
      icon: '⚡',
      seeds: ['60nZcImufyMA1MKQY3dcCH', '2dpaYNE24mtoDo7JHTI6ON', '1rfofaqEpACxVEHIZBJe6W'],
      desc: 'High-energy electronic festival anthems, aggressive drops and fast tempo'
    },
    {
      name: 'Indie Acoustic',
      icon: '🌿',
      seeds: ['2Fxmhks0bxGSBdJ92v4426', '7qEHsqek3amROFNfZL9i2R', '6Z8R6UsFuGXbCeEG7yM5XX'],
      desc: 'Introspective songwriting, stripped-down acoustics and warm emotional depth'
    },
    {
      name: 'Lyrical Rap',
      icon: '🎤',
      seeds: ['7KXjTSCq5nL1LoYtL7XAwS', '0e7ipKhUQyaJ09og7V0n2v', '2fXffr80x1g00xGZ5q388s'],
      desc: 'Fast vocal delivery, rhythmic trap beats and high speechiness'
    }
  ];

  // Initialize with the first persona on mount if empty
  useEffect(() => {
    if (selectedSongs.length === 0 && searchCatalog && searchCatalog.length > 0) {
      applyPersona(PRESET_PERSONAS[0]);
    }
  }, [searchCatalog]);

  const applyPersona = (persona) => {
    setActivePersona(persona.name);
    if (!searchCatalog || searchCatalog.length === 0) return;
    
    // Find matching songs from catalog or fallback to genre slice
    const matched = searchCatalog.filter(s => 
      persona.seeds.includes(s.track_id)
    );

    if (matched.length >= 2) {
      setSelectedSongs(matched);
    } else {
      // Fallback: pick 3 top songs from persona genre
      const g = persona.name.toLowerCase().includes('edm') ? 'edm' : 
                persona.name.toLowerCase().includes('rap') ? 'rap' : 
                persona.name.toLowerCase().includes('acoustic') ? 'pop' : 'pop';
      const fallback = searchCatalog.filter(s => (s.genre || '').toLowerCase() === g).slice(0, 3);
      setSelectedSongs(fallback);
    }
  };

  // Search auto-complete filter
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !searchCatalog) return [];
    const q = searchQuery.toLowerCase().trim();
    const selectedIds = new Set(selectedSongs.map(s => s.track_id));
    return searchCatalog
      .filter(s => !selectedIds.has(s.track_id))
      .filter(s => 
        (s.track_name || '').toLowerCase().includes(q) || 
        (s.track_artist || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [searchQuery, searchCatalog, selectedSongs]);

  const handleAddSong = (song) => {
    setSelectedSongs(prev => [...prev, song]);
    setSearchQuery('');
    setActivePersona(null);
  };

  const handleRemoveSong = (trackId) => {
    setSelectedSongs(prev => prev.filter(s => s.track_id !== trackId));
    setActivePersona(null);
  };

  const handleClear = () => {
    setSelectedSongs([]);
    setActivePersona(null);
  };

  // Compute User Music Profile in real-time
  const userProfile = useMemo(() => {
    return computeUserProfile(selectedSongs);
  }, [selectedSongs]);

  // Generate Recommendations in real-time
  const recommendations = useMemo(() => {
    if (!searchCatalog || selectedSongs.length === 0) return [];
    return generateRecommendations(searchCatalog, selectedSongs, {
      topN,
      genreFilter,
      minPopularity
    });
  }, [searchCatalog, selectedSongs, topN, genreFilter, minPopularity]);

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

  return (
    <div className="space-y-6">
      
      {/* Top Banner */}
      <div className="glass-panel p-6 bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-blue-950/40 border border-emerald-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
          <Sparkles className="w-4 h-4" />
          Interactive Recommender &amp; User Music Profile • Page 3 of 3
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
          Personalized Music Intelligence &amp; Explainable Recommendations
        </h1>
        <p className="text-sm text-slate-300 max-w-3xl mt-1">
          Select songs you like to generate your continuous acoustic profile and discover new music via 
          <strong> Standardized Cosine Similarity</strong>. Every recommended track includes feature proximity attribution.
        </p>
      </div>

      {/* Row 1: Preset Personas & Song Search */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Col: Persona Quick-Select */}
        <div className="glass-panel p-5 space-y-3.5">
          <div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Explore Personas</span>
            <p className="text-xs text-slate-400">One-click seed taste profiles</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {PRESET_PERSONAS.map(p => {
              const isSelected = activePersona === p.name;
              return (
                <button
                  key={p.name}
                  onClick={() => applyPersona(p)}
                  className={`p-3 rounded-xl text-left transition-all border ${
                    isSelected 
                      ? 'bg-blue-600/30 border-blue-500 text-white shadow-md shadow-blue-500/20' 
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="text-lg mb-1">{p.icon}</div>
                  <div className="text-xs font-bold font-sans">{p.name}</div>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="pt-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Search &amp; Add Songs
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Type song or artist name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Auto-Complete Dropdown */}
            {searchQuery.trim() && searchResults.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-2">
                No matching tracks in the curated search catalog. Try another title or artist.
              </p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 glass-panel p-1.5 border-slate-700 max-h-56 overflow-y-auto space-y-1 z-30 relative shadow-2xl">
                {searchResults.map(song => (
                  <button
                    key={song.track_id}
                    onClick={() => handleAddSong(song)}
                    className="w-full flex items-center justify-between p-2 rounded-lg text-left text-xs hover:bg-slate-800 transition-colors group"
                  >
                    <div className="truncate pr-2">
                      <span className="font-semibold text-slate-100 block truncate">{song.track_name}</span>
                      <span className="text-[11px] text-slate-400 truncate">{song.track_artist}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`genre-badge text-[10px] ${getGenreColorClass(song.genre)}`}>
                        {song.genre}
                      </span>
                      <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Selected Seed Songs Chips */}
        <div className="lg:col-span-2 glass-panel p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Selected Seed Songs</h2>
              <span className="text-xs font-mono text-blue-400 bg-blue-950/80 px-2 py-0.5 rounded border border-blue-800">
                {selectedSongs.length} Active
              </span>
            </div>
            {selectedSongs.length > 0 && (
              <button
                onClick={handleClear}
                className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> Clear All
              </button>
            )}
          </div>

          {selectedSongs.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-800 rounded-xl space-y-2">
              <Music className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">No songs selected yet.</p>
              <p className="text-[11px] text-slate-500">Pick a preset persona on the left or search to add songs.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {selectedSongs.map(song => (
                <div 
                  key={song.track_id}
                  className="flex items-center justify-between p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl group hover:border-slate-700 transition-colors"
                >
                  <div className="truncate pr-2">
                    <div className="font-semibold text-xs text-slate-200 truncate">{song.track_name}</div>
                    <div className="text-[11px] text-slate-400 truncate">{song.track_artist}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`genre-badge text-[9px] ${getGenreColorClass(song.genre)}`}>
                      {song.genre}
                    </span>
                    <button
                      onClick={() => handleRemoveSong(song.track_id)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Row 2: Computed User Profile Card */}
      {userProfile && (
        <div className="glass-panel p-6 bg-gradient-to-r from-blue-950/40 via-slate-900/80 to-indigo-950/40 border border-blue-500/30">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-5 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  Archetype Identified
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  Derived from {userProfile.seedCount} tracks
                </span>
              </div>
              <h2 className="text-2xl font-extrabold text-white font-heading">
                {userProfile.archetype}
              </h2>
              <p className="text-xs text-slate-300 mt-0.5 italic">
                "{userProfile.tagline}" — {userProfile.description}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {userProfile.dominantGenres.map(g => (
                <div key={g.genre} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-center">
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold">{g.genre}</span>
                  <span className="font-bold text-slate-200 font-mono">{g.percentage}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Audio Profile Gauges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 font-mono">
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-red-400 font-semibold block">Energy</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.energyPct}%</span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-blue-400 font-semibold block">Danceability</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.danceabilityPct}%</span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-emerald-400 font-semibold block">Valence</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.valencePct}%</span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-amber-400 font-semibold block">Acousticness</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.acousticnessPct}%</span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-purple-400 font-semibold block">Speechiness</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.speechinessPct}%</span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-indigo-400 font-semibold block">Tempo</span>
              <span className="text-base font-bold text-white">{userProfile.audioProfile.avgTempoBpm} <span className="text-[10px] text-slate-400">BPM</span></span>
            </div>
            <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
              <span className="text-[10px] uppercase text-pink-400 font-semibold block">Avg Popularity</span>
              <span className="text-base font-bold text-amber-400">{userProfile.audioProfile.avgPopularity}</span>
            </div>
          </div>
        </div>
      )}

      {/* Row 3: Recommendations Controls & Table */}
      <div className="glass-panel p-6 space-y-4">
        
        {/* Header & Filter Controls */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Recommended Songs</h2>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                {recommendations.length} Results
              </span>
            </div>
            <p className="text-xs text-slate-400">Ranked by Cosine Similarity in Z-score standardized acoustic space</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Genre Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Genre:</span>
              <select
                value={genreFilter}
                onChange={(e) => setGenreFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-blue-500"
              >
                <option value="all">All Genres</option>
                <option value="pop">Pop</option>
                <option value="rap">Rap</option>
                <option value="rock">Rock</option>
                <option value="latin">Latin</option>
                <option value="r&b">R&B</option>
                <option value="edm">EDM</option>
              </select>
            </div>

            {/* Min Popularity */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Min Pop:</span>
              <input
                type="number"
                min="0"
                max="90"
                value={minPopularity}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isNaN(next)) {
                    setMinPopularity(0);
                    return;
                  }
                  setMinPopularity(Math.min(90, Math.max(0, next)));
                }}
                className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-center focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            {/* Top N */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Show:</span>
              <select
                value={topN}
                onChange={(e) => setTopN(Number(e.target.value))}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              >
                <option value="5">Top 5</option>
                <option value="10">Top 10</option>
                <option value="15">Top 15</option>
                <option value="20">Top 20</option>
              </select>
            </div>
          </div>
        </div>

        {/* Recommendation Cards */}
        {selectedSongs.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            Select at least one seed track (or a persona) to generate recommendations.
          </div>
        ) : recommendations.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No recommendations match the current filters. Try relaxing the genre or popularity constraints.
          </div>
        ) : (
          <div className="space-y-3">
            {recommendations.map(rec => (
              <div 
                key={rec.track_id}
                className="p-4 bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 rounded-xl transition-all space-y-2.5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-400 flex items-center justify-center font-mono font-bold text-xs shrink-0 mt-0.5">
                      #{rec.rank}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-100 font-sans">{rec.track_name}</span>
                        <span className={`genre-badge text-[9px] ${getGenreColorClass(rec.genre)}`}>
                          {rec.genre}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        by <span className="text-slate-300 font-medium">{rec.track_artist}</span> • <span className="text-slate-500">{rec.track_album_name}</span> ({rec.release_year})
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 sm:text-right font-mono">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase">Match Score</span>
                      <span className="text-base font-extrabold text-emerald-400">
                        {rec.similarityPercentage}%
                      </span>
                    </div>
                    <div className="border-l border-slate-800 pl-4">
                      <span className="text-[10px] text-slate-500 block uppercase">Popularity</span>
                      <span className="text-sm font-bold text-amber-400">
                        {rec.track_popularity}/100
                      </span>
                    </div>
                  </div>
                </div>

                {/* Explainability Breakdown Pill Badges */}
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  {rec.explanation?.topMatchingFeatures?.map(m => (
                    <span 
                      key={m.feature}
                      className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-800/80 text-slate-300 border border-slate-700 flex items-center gap-1.5"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                      <span className="capitalize">{m.feature}</span>
                      <span className="text-blue-400 font-bold">{m.similarityPct}%</span>
                    </span>
                  ))}
                  {rec.explanation?.sharesGenre && (
                    <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800">
                      ★ Shared Genre ({rec.genre})
                    </span>
                  )}
                </div>

                {/* Natural Language Narrative Text */}
                <div className="text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/50 flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                  <span>{rec.explanation?.narrative}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

    </div>
  );
}
