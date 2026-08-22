import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Search,
  Plus,
  X,
  RotateCcw,
  Zap,
  Music,
  Info,
  Loader2,
  AlertCircle,
  UserCircle2,
  RefreshCw,
  CheckCircle2,
  Disc3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { recommendationsApi, ApiError } from '../utils/apiClient';
import { computeUserProfile, generateRecommendations as localRecommendations } from '../utils/recommenderClient';
import SectionHeader from './ui/SectionHeader';
import Pill from './ui/Pill';
import EmptyState from './ui/EmptyState';

const PRESET_PERSONAS = [
  {
    name: 'Pop & Dance',
    icon: '🎉',
    seeds: ['2bPG05tph4ZaUtV0RA6Gbt', '7qiZfU4dY1lWllzX7mPBI3', '6habFhsOp2NvshLv26DqMb'],
    desc: 'Upbeat commercial pop, high danceability and cheerful melodies',
  },
  {
    name: 'EDM Peak Time',
    icon: '⚡',
    seeds: ['60nZcImufyMA1MKQY3dcCH', '2dpaYNE24mtoDo7JHTI6ON', '1rfofaqEpACxVEHIZBJe6W'],
    desc: 'High-energy electronic festival anthems, aggressive drops and fast tempo',
  },
  {
    name: 'Indie Acoustic',
    icon: '🌿',
    seeds: ['2Fxmhks0bxGSBdJ92v4426', '7qEHsqek3amROFNfZL9i2R', '6Z8R6UsFuGXbCeEG7yM5XX'],
    desc: 'Introspective songwriting, stripped-down acoustics and warm emotional depth',
  },
  {
    name: 'Lyrical Rap',
    icon: '🎤',
    seeds: ['7KXjTSCq5nL1LoYtL7XAwS', '0e7ipKhUQyaJ09og7V0n2v', '2fXffr80x1g00xGZ5q388s'],
    desc: 'Fast vocal delivery, rhythmic trap beats and high speechiness',
  },
];

function RecCard({ rec, rank }) {
  const [expanded, setExpanded] = useState(false);
  const primaryGenre = (rec.genre_name || '').split(', ')[0];

  return (
    <div className="glass-card-interactive p-4 sm:p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
            <Disc3 className="w-5 h-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-purple-400">#{rank}</span>
              <h3 className="font-bold text-sm text-white truncate max-w-xs sm:max-w-md">
                {rec.track_name}
              </h3>
              {primaryGenre && <Pill label={primaryGenre} genre={primaryGenre} size="sm" />}
            </div>
            <p className="text-xs text-[#a1a1c2] truncate">
              {rec.artist_name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 font-mono self-end sm:self-center">
          <div className="text-right">
            <span className="text-[10px] text-[#6b6b8f] block uppercase tracking-wider">Match</span>
            <span className="text-sm font-extrabold text-purple-300">
              {(Number(rec.similarity_score || 0) * 100).toFixed(1)}%
            </span>
          </div>
          {rec.track_popularity != null && (
            <div className="border-l border-white/5 pl-4 text-right">
              <span className="text-[10px] text-[#6b6b8f] block uppercase tracking-wider">Popularity</span>
              <span className="text-sm font-bold text-amber-300">{rec.track_popularity}</span>
            </div>
          )}
        </div>
      </div>

      {/* Explanation tags */}
      {rec.explanation?.strongest_feature_alignments && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {rec.explanation.strongest_feature_alignments.map((m) => (
            <span
              key={m.feature}
              className="px-2.5 py-0.5 rounded-full text-[11px] bg-[#1e1533] text-purple-200 border border-purple-500/20 flex items-center gap-1.5"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="capitalize">{m.feature} match</span>
            </span>
          ))}
          {rec.explanation.genre_contribution?.matched_genres?.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              ★ Genre match
            </span>
          )}
        </div>
      )}

      {/* Narrative sentence */}
      {rec.explanation?.narrative && (
        <p className="text-xs text-[#a1a1c2] bg-[#140e24] p-2.5 rounded-xl border border-white/5 leading-relaxed">
          {rec.explanation.narrative}
        </p>
      )}

      {/* Expand feature comparisons */}
      {rec.explanation?.strongest_feature_alignments && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
          >
            <span>{expanded ? 'Hide feature breakdown' : 'View feature comparison'}</span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {expanded && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 mt-1 border-t border-white/5 font-mono text-[10px]">
              {rec.explanation.strongest_feature_alignments.map((f) => (
                <div key={f.feature} className="p-2 bg-[#140e24] rounded-lg border border-white/5 text-center">
                  <span className="text-[#6b6b8f] uppercase block mb-0.5">{f.feature}</span>
                  <span className="text-white block font-bold">Track: {f.track_value}</span>
                  <span className="text-[#a1a1c2] block">You: {f.user_value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecommenderTab({ searchCatalog }) {
  const { user } = useAuth();

  const [serverRecs, setServerRecs] = useState(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [noProfileReason, setNoProfileReason] = useState(null);
  const [serverGenre, setServerGenre] = useState('');
  const [serverMinPop, setServerMinPop] = useState(0);
  const [serverLimit, setServerLimit] = useState(20);
  const [savedBanner, setSavedBanner] = useState(false);

  // Legacy manual seed state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSongs, setSelectedSongs] = useState([]);
  const [genreFilter, setGenreFilter] = useState('all');
  const [minPopularity, setMinPopularity] = useState(0);
  const [topN, setTopN] = useState(10);
  const [activePersona, setActivePersona] = useState(null);
  const [showLegacy, setShowLegacy] = useState(false);

  const fetchServerRecs = useCallback(async (save = false) => {
    if (!user) return;
    setServerLoading(true);
    setServerError(null);
    setNoProfileReason(null);
    try {
      const data = await recommendationsApi.get({
        limit: serverLimit,
        genre: serverGenre || undefined,
        minPopularity: serverMinPop || undefined,
        save,
      });
      if (data.noProfileReason) {
        setNoProfileReason(data.noProfileReason);
        setServerRecs([]);
      } else {
        setServerRecs(data.recommendations || []);
        if (save) {
          setSavedBanner(true);
          setTimeout(() => setSavedBanner(false), 3000);
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setNoProfileReason('Sign in to get personalized recommendations.');
      } else {
        setServerError(err.message || 'Could not load recommendations.');
      }
    } finally {
      setServerLoading(false);
    }
  }, [user, serverLimit, serverGenre, serverMinPop]);

  useEffect(() => {
    if (user && serverRecs === null) fetchServerRecs(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPersona(persona) {
    setActivePersona(persona.name);
    if (!searchCatalog?.length) return;
    const matched = searchCatalog.filter((s) => persona.seeds.includes(s.track_id));
    if (matched.length >= 2) {
      setSelectedSongs(matched);
    } else {
      const g = persona.name.toLowerCase().includes('edm') ? 'edm'
              : persona.name.toLowerCase().includes('rap') ? 'rap' : 'pop';
      setSelectedSongs(searchCatalog.filter((s) => (s.genre || '').toLowerCase() === g).slice(0, 3));
    }
  }

  useEffect(() => {
    if (selectedSongs.length === 0 && searchCatalog?.length > 0 && !user) {
      applyPersona(PRESET_PERSONAS[0]);
    }
  }, [searchCatalog]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !searchCatalog) return [];
    const q = searchQuery.toLowerCase().trim();
    const sel = new Set(selectedSongs.map((s) => s.track_id));
    return searchCatalog
      .filter((s) => !sel.has(s.track_id))
      .filter((s) => (s.track_name || '').toLowerCase().includes(q) || (s.track_artist || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, searchCatalog, selectedSongs]);

  const userProfile = useMemo(() => computeUserProfile(selectedSongs), [selectedSongs]);

  const legacyRecs = useMemo(() => {
    if (!searchCatalog || selectedSongs.length === 0) return [];
    return localRecommendations(searchCatalog, selectedSongs, { topN, genreFilter, minPopularity });
  }, [searchCatalog, selectedSongs, topN, genreFilter, minPopularity]);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <SectionHeader
        eyebrow="Made for you"
        title="Recommended for you"
        description="Discover songs tailored to your taste profile, complete with clear reasons why each track was chosen."
      />

      {/* Personalized Section */}
      <div className="glass-panel p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white font-heading">Personalized Picks</h2>
              {serverRecs !== null && !noProfileReason && (
                <span className="text-xs font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded-full border border-purple-500/20">
                  {serverRecs.length} songs
                </span>
              )}
              {savedBanner && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
            </div>
            <p className="text-xs text-[#a1a1c2]">Generated from your Spotify listening history</p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={serverGenre}
              onChange={(e) => setServerGenre(e.target.value)}
              className="bg-[#1e1533] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
            >
              <option value="">All Genres</option>
              <option value="pop">Pop</option>
              <option value="rap">Rap</option>
              <option value="rock">Rock</option>
              <option value="latin">Latin</option>
              <option value="r&b">R&amp;B</option>
              <option value="edm">EDM</option>
            </select>

            <div className="flex items-center gap-1.5">
              <span className="text-[#a1a1c2]">Min pop:</span>
              <input
                type="number"
                min="0"
                max="90"
                value={serverMinPop}
                onChange={(e) => setServerMinPop(Math.min(90, Math.max(0, Number(e.target.value) || 0)))}
                className="w-14 bg-[#1e1533] border border-white/10 rounded-xl px-2 py-1.5 text-white text-center focus:outline-none focus:border-purple-500 font-mono"
              />
            </div>

            <select
              value={serverLimit}
              onChange={(e) => setServerLimit(Number(e.target.value))}
              className="bg-[#1e1533] border border-white/10 rounded-xl px-3 py-1.5 text-white focus:outline-none focus:border-purple-500 font-mono"
            >
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
              <option value="30">Top 30</option>
              <option value="50">Top 50</option>
            </select>

            <button
              type="button"
              onClick={() => fetchServerRecs(false)}
              disabled={serverLoading || !user}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1e1533] hover:bg-[#2a1f45] border border-white/10 rounded-xl text-[#a1a1c2] hover:text-white disabled:opacity-40 transition-colors"
            >
              {serverLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => fetchServerRecs(true)}
              disabled={serverLoading || !user}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-signature-gradient hover:opacity-95 rounded-xl text-white text-xs font-semibold disabled:opacity-40 transition-all shadow-md shadow-purple-600/20 active:scale-95"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Save Discovery</span>
            </button>
          </div>
        </div>

        {/* Results Area */}
        {!user ? (
          <EmptyState
            icon={UserCircle2}
            title="Personalized Recommendations"
            message="Sign in and connect your Spotify account to discover songs matched precisely to your taste profile."
          />
        ) : serverLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
              <p className="text-xs text-[#a1a1c2]">Finding matching songs across the catalog…</p>
            </div>
          </div>
        ) : serverError ? (
          <div className="flex items-center gap-3 p-4 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{serverError}</span>
            <button
              type="button"
              onClick={() => fetchServerRecs(false)}
              className="font-bold text-red-400 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : noProfileReason ? (
          <EmptyState
            icon={Sparkles}
            title="Set Up Your Taste Profile"
            message={noProfileReason}
          />
        ) : serverRecs?.length === 0 ? (
          <div className="p-8 text-center text-[#6b6b8f] text-xs">
            No recommendations match your current filters. Try relaxing the genre or popularity constraints.
          </div>
        ) : (
          <div className="space-y-3">
            {serverRecs?.map((rec) => (
              <RecCard key={rec.track_id} rec={rec} rank={rec.rank} />
            ))}
          </div>
        )}
      </div>

      {/* Manual Seed Explorer (Preserved & Restyled) */}
      <div className="glass-panel p-5 space-y-4">
        <button
          type="button"
          onClick={() => setShowLegacy(!showLegacy)}
          className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#a1a1c2] hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <Music className="w-4 h-4 text-purple-400" />
            Manual Seed Explorer (Curated Catalog)
          </span>
          <span className="font-mono text-purple-400">{showLegacy ? '▲ Hide' : '▼ Expand'}</span>
        </button>

        {showLegacy && (
          <div className="pt-3 border-t border-white/5 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Personas */}
              <div className="glass-card-interactive p-4 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-[#a1a1c2] block">
                  Quick Personas
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_PERSONAS.map((p) => {
                    const isActive = activePersona === p.name;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => applyPersona(p)}
                        className={`p-3 rounded-xl text-left transition-all border ${
                          isActive
                            ? 'bg-signature-gradient text-white border-transparent shadow-md shadow-purple-600/20'
                            : 'bg-[#140e24] border-white/5 text-[#a1a1c2] hover:bg-[#1e1533]'
                        }`}
                      >
                        <div className="text-base mb-1">{p.icon}</div>
                        <div className="text-xs font-bold">{p.name}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Search */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#a1a1c2] block">
                    Search &amp; Add Seed
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#6b6b8f] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Song or artist…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#140e24] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#6b6b8f] focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>

                  {searchResults.length > 0 && (
                    <div className="glass-panel p-1.5 max-h-48 overflow-y-auto space-y-1">
                      {searchResults.map((song) => (
                        <button
                          key={song.track_id}
                          type="button"
                          onClick={() => {
                            setSelectedSongs((p) => [...p, song]);
                            setSearchQuery('');
                            setActivePersona(null);
                          }}
                          className="w-full flex items-center justify-between p-2 rounded-lg text-left text-xs hover:bg-[#1e1533] transition-colors group"
                        >
                          <div className="truncate pr-2">
                            <span className="font-semibold text-white block truncate">{song.track_name}</span>
                            <span className="text-[11px] text-[#6b6b8f]">{song.track_artist}</span>
                          </div>
                          <Plus className="w-3.5 h-3.5 text-[#a1a1c2] group-hover:text-purple-300" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Seeds */}
              <div className="lg:col-span-2 glass-card-interactive p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#a1a1c2]">
                    Selected Seeds ({selectedSongs.length})
                  </h3>
                  {selectedSongs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSongs([]);
                        setActivePersona(null);
                      }}
                      className="text-xs text-[#6b6b8f] hover:text-red-400 flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                {selectedSongs.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-white/5 rounded-xl">
                    <p className="text-xs text-[#6b6b8f]">Pick a persona or search songs above to test recommendations.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {selectedSongs.map((song) => (
                      <div
                        key={song.track_id}
                        className="flex items-center justify-between p-2.5 bg-[#140e24] border border-white/5 rounded-xl"
                      >
                        <div className="truncate pr-2">
                          <div className="text-xs font-semibold text-white truncate">{song.track_name}</div>
                          <div className="text-[11px] text-[#6b6b8f]">{song.track_artist}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedSongs((p) => p.filter((s) => s.track_id !== song.track_id))}
                          className="text-[#6b6b8f] hover:text-red-400 p-1"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Profile archetype card */}
            {userProfile && selectedSongs.length > 0 && (
              <div className="glass-panel p-5 bg-gradient-to-r from-[#1e1533] to-[#140e24] border border-purple-500/20 space-y-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                    Seed Archetype
                  </span>
                  <h3 className="text-lg font-bold text-white font-heading mt-0.5">
                    {userProfile.archetype}
                  </h3>
                  <p className="text-xs text-[#a1a1c2] italic">{userProfile.tagline}</p>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 font-mono text-center">
                  {[
                    { label: 'Energy', val: userProfile.audioProfile?.energyPct },
                    { label: 'Dance', val: userProfile.audioProfile?.danceabilityPct },
                    { label: 'Mood', val: userProfile.audioProfile?.valencePct },
                    { label: 'Acoustic', val: userProfile.audioProfile?.acousticnessPct },
                    { label: 'Speech', val: userProfile.audioProfile?.speechinessPct },
                    { label: 'Tempo', val: userProfile.audioProfile?.avgTempoBpm, unit: 'BPM' },
                  ].map(({ label, val, unit }) => (
                    <div key={label} className="p-2 bg-[#140e24] border border-white/5 rounded-xl">
                      <span className="text-[9px] uppercase text-[#6b6b8f] font-semibold block">{label}</span>
                      <span className="text-xs font-bold text-white">
                        {val ?? '—'}{unit ? ` ${unit}` : val != null ? '%' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Manual results */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <select
                  value={genreFilter}
                  onChange={(e) => setGenreFilter(e.target.value)}
                  className="bg-[#1e1533] border border-white/10 rounded-xl px-3 py-1 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="all">All Genres</option>
                  <option value="pop">Pop</option>
                  <option value="rap">Rap</option>
                  <option value="rock">Rock</option>
                  <option value="latin">Latin</option>
                  <option value="r&b">R&amp;B</option>
                  <option value="edm">EDM</option>
                </select>

                <div className="flex items-center gap-1.5">
                  <span className="text-[#a1a1c2]">Min pop:</span>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    value={minPopularity}
                    onChange={(e) => setMinPopularity(Math.min(90, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-14 bg-[#1e1533] border border-white/10 rounded-xl px-2 py-1 text-white text-center focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>

                <select
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  className="bg-[#1e1533] border border-white/10 rounded-xl px-3 py-1 text-white focus:outline-none focus:border-purple-500 font-mono"
                >
                  <option value="5">Top 5</option>
                  <option value="10">Top 10</option>
                  <option value="15">Top 15</option>
                  <option value="20">Top 20</option>
                </select>
              </div>

              {selectedSongs.length > 0 && legacyRecs.length > 0 && (
                <div className="space-y-2">
                  {legacyRecs.map((rec) => (
                    <div
                      key={rec.track_id}
                      className="p-3 bg-[#140e24] border border-white/5 hover:border-purple-500/30 rounded-xl transition-all flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <span className="text-xs font-mono font-bold text-[#6b6b8f] w-5">#{rec.rank}</span>
                        <div className="truncate">
                          <span className="font-semibold text-xs text-white block truncate">{rec.track_name}</span>
                          <span className="text-[11px] text-[#6b6b8f]">{rec.track_artist}</span>
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <span className="text-[9px] text-[#6b6b8f] uppercase block">Match</span>
                        <span className="font-bold text-xs text-purple-300">
                          {(Number(rec.similarityScore || 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
