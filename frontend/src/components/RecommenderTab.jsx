import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles, Search, Plus, X, RotateCcw, Zap,
  Music, Info, Loader2, AlertCircle, UserCircle2,
  RefreshCw, CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { recommendationsApi, ApiError } from '../utils/apiClient';
// Legacy client-side engine — still used for the "manual seed" path
import { computeUserProfile, generateRecommendations as localRecommendations } from '../utils/recommenderClient';

// ── Helpers ────────────────────────────────────────────────────────────────
function getGenreClass(genre) {
  const map = { pop: 'genre-pop', rap: 'genre-rap', rock: 'genre-rock',
                latin: 'genre-latin', 'r&b': 'genre-rnb', edm: 'genre-edm' };
  return map[(genre || '').toLowerCase()] || 'genre-other';
}

// ── Preset personas (kept from original) ─────────────────────────────────
const PRESET_PERSONAS = [
  { name: 'Pop & Dance', icon: '🎉',
    seeds: ['2bPG05tph4ZaUtV0RA6Gbt', '7qiZfU4dY1lWllzX7mPBI3', '6habFhsOp2NvshLv26DqMb'],
    desc: 'Upbeat commercial pop, high danceability and cheerful melodies' },
  { name: 'EDM Peak Time', icon: '⚡',
    seeds: ['60nZcImufyMA1MKQY3dcCH', '2dpaYNE24mtoDo7JHTI6ON', '1rfofaqEpACxVEHIZBJe6W'],
    desc: 'High-energy electronic festival anthems, aggressive drops and fast tempo' },
  { name: 'Indie Acoustic', icon: '🌿',
    seeds: ['2Fxmhks0bxGSBdJ92v4426', '7qEHsqek3amROFNfZL9i2R', '6Z8R6UsFuGXbCeEG7yM5XX'],
    desc: 'Introspective songwriting, stripped-down acoustics and warm emotional depth' },
  { name: 'Lyrical Rap', icon: '🎤',
    seeds: ['7KXjTSCq5nL1LoYtL7XAwS', '0e7ipKhUQyaJ09og7V0n2v', '2fXffr80x1g00xGZ5q388s'],
    desc: 'Fast vocal delivery, rhythmic trap beats and high speechiness' },
];

// ── No-profile nudge ──────────────────────────────────────────────────────
function NoProfileNudge({ reason }) {
  return (
    <div className="p-6 text-center space-y-3 border border-dashed border-slate-700 rounded-xl">
      <UserCircle2 className="w-10 h-10 text-slate-600 mx-auto" />
      <p className="text-sm font-semibold text-slate-300">
        {reason || 'Connect Spotify and run your music analysis to get personalized recommendations.'}
      </p>
      <p className="text-xs text-slate-500">
        Or use the manual seed selector below to try the static catalog recommender.
      </p>
    </div>
  );
}

// ── Recommendation card ────────────────────────────────────────────────────
function RecCard({ rec, rank }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-4 bg-slate-900/60 border border-slate-800/80 hover:border-blue-500/40 rounded-xl transition-all space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-3">
          <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-400 flex items-center justify-center font-mono font-bold text-xs shrink-0 mt-0.5">
            #{rank}
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-100">{rec.track_name}</span>
              {rec.genre_name && (
                <span className={`genre-badge text-[9px] ${getGenreClass(rec.genre_name.split(', ')[0])}`}>
                  {rec.genre_name.split(', ')[0]}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400">
              by <span className="text-slate-300 font-medium">{rec.artist_name}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 font-mono">
          <div className="text-right">
            <span className="text-[10px] text-slate-500 block uppercase">Match</span>
            <span className="text-base font-extrabold text-emerald-400">{rec.similarity_pct}%</span>
          </div>
          <div className="border-l border-slate-800 pl-4 text-right">
            <span className="text-[10px] text-slate-500 block uppercase">Pop</span>
            <span className="text-sm font-bold text-amber-400">{rec.track_popularity}</span>
          </div>
        </div>
      </div>

      {/* Explanation pills */}
      {rec.explanation?.topMatchingFeatures && (
        <div className="flex flex-wrap gap-2 pt-1">
          {rec.explanation.topMatchingFeatures.map((m) => (
            <span key={m.feature}
              className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-800/80 text-slate-300 border border-slate-700 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span className="capitalize">{m.feature}</span>
              <span className="text-blue-400 font-bold">{m.proximityPct}%</span>
            </span>
          ))}
          {rec.explanation.sharesGenre && (
            <span className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-purple-950/60 text-purple-300 border border-purple-800">
              ★ Genre match
            </span>
          )}
        </div>
      )}

      {/* Narrative */}
      {rec.explanation?.narrative && (
        <div className="text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/50 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <span>{rec.explanation.narrative}</span>
        </div>
      )}

      {/* Expandable feature detail */}
      {rec.explanation?.featureDetails && (
        <button type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          {expanded ? '▲ Hide details' : '▼ Feature comparison'}
        </button>
      )}
      {expanded && rec.explanation?.featureDetails && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 pt-1">
          {rec.explanation.featureDetails.map((f) => (
            <div key={f.feature} className="bg-slate-900 rounded-lg p-1.5 text-center">
              <p className="text-[9px] text-slate-500 uppercase">{f.feature}</p>
              <p className="text-[10px] text-slate-300 font-mono">You: {f.userValue}</p>
              <p className="text-[10px] text-slate-300 font-mono">Track: {f.trackValue}</p>
              <p className={`text-[10px] font-bold font-mono ${f.proximityPct >= 80 ? 'text-emerald-400' : f.proximityPct >= 60 ? 'text-amber-400' : 'text-slate-500'}`}>
                {f.proximityPct}% match
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function RecommenderTab({ searchCatalog }) {
  const { user } = useAuth();

  // ── Dynamic (server) recommendation state ──────────────────────────────
  const [serverRecs, setServerRecs]         = useState(null);   // null = not yet fetched
  const [serverLoading, setServerLoading]   = useState(false);
  const [serverError, setServerError]       = useState(null);
  const [noProfileReason, setNoProfileReason] = useState(null);
  const [serverGenre, setServerGenre]       = useState('');
  const [serverMinPop, setServerMinPop]     = useState(0);
  const [serverLimit, setServerLimit]       = useState(20);
  const [savedBanner, setSavedBanner]       = useState(false);

  // ── Legacy (manual seed) state ──────────────────────────────────────────
  const [searchQuery, setSearchQuery]       = useState('');
  const [selectedSongs, setSelectedSongs]   = useState([]);
  const [genreFilter, setGenreFilter]       = useState('all');
  const [minPopularity, setMinPopularity]   = useState(0);
  const [topN, setTopN]                     = useState(10);
  const [activePersona, setActivePersona]   = useState(null);
  const [showLegacy, setShowLegacy]         = useState(false);

  // ── Fetch server recommendations ───────────────────────────────────────
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
        if (save) { setSavedBanner(true); setTimeout(() => setSavedBanner(false), 3000); }
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

  // Auto-fetch on mount if user is logged in
  useEffect(() => {
    if (user && serverRecs === null) fetchServerRecs(false);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legacy persona / seed logic (unchanged) ────────────────────────────
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

      {/* ── Banner ─────────────────────────────────────────────────────── */}
      <div className="glass-panel p-6 bg-gradient-to-r from-emerald-950/40 via-slate-900/60 to-blue-950/40 border border-emerald-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
          <Sparkles className="w-4 h-4" />
          Personalized Recommendations &amp; Explainable Matching
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
          Your MusicLens Recommendations
        </h1>
        <p className="text-sm text-slate-300 max-w-3xl mt-1">
          Powered by your Spotify-derived MusicLens profile. Server-side cosine similarity
          across the full 28K catalog — scaled to your actual taste.
        </p>
      </div>

      {/* ── Personalized (server-side) section ───────────────────────── */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">For You</h2>
              {serverRecs !== null && !noProfileReason && (
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                  {serverRecs.length} results
                </span>
              )}
              {savedBanner && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved to history
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">Based on your MusicLens profile + liked tracks</p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select value={serverGenre} onChange={(e) => setServerGenre(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500">
              <option value="">All Genres</option>
              <option value="pop">Pop</option>
              <option value="rap">Rap</option>
              <option value="rock">Rock</option>
              <option value="latin">Latin</option>
              <option value="r&b">R&amp;B</option>
              <option value="edm">EDM</option>
            </select>

            <div className="flex items-center gap-1">
              <span className="text-slate-400">Min pop:</span>
              <input type="number" min="0" max="90" value={serverMinPop}
                onChange={(e) => setServerMinPop(Math.min(90, Math.max(0, Number(e.target.value) || 0)))}
                className="w-14 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 text-center focus:outline-none focus:border-blue-500 font-mono" />
            </div>

            <select value={serverLimit} onChange={(e) => setServerLimit(Number(e.target.value))}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 font-mono">
              <option value="10">Top 10</option>
              <option value="20">Top 20</option>
              <option value="30">Top 30</option>
              <option value="50">Top 50</option>
            </select>

            <button type="button" onClick={() => fetchServerRecs(false)} disabled={serverLoading || !user}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 hover:text-white disabled:opacity-40 transition-colors">
              {serverLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh
            </button>

            <button type="button" onClick={() => fetchServerRecs(true)} disabled={serverLoading || !user}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-xs font-semibold disabled:opacity-40 transition-colors">
              <Zap className="w-3.5 h-3.5" /> Generate &amp; Save
            </button>
          </div>
        </div>

        {/* Results area */}
        {!user ? (
          <NoProfileNudge reason="Sign in to get personalized recommendations based on your Spotify profile." />
        ) : serverLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center space-y-3">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-400">Calculating your recommendations across 28K tracks…</p>
            </div>
          </div>
        ) : serverError ? (
          <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-500/30 rounded-xl text-sm text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{serverError}</span>
            <button type="button" onClick={() => fetchServerRecs(false)} className="text-xs text-red-400 hover:text-red-200">Retry</button>
          </div>
        ) : noProfileReason ? (
          <NoProfileNudge reason={noProfileReason} />
        ) : serverRecs?.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No recommendations match the current filters. Try relaxing the genre or popularity constraints.
          </div>
        ) : (
          <div className="space-y-3">
            {serverRecs?.map((rec) => (
              <RecCard key={rec.track_id} rec={rec} rank={rec.rank} />
            ))}
          </div>
        )}
      </div>

      {/* ── Manual seed section (legacy, preserved) ────────────────── */}
      <div className="glass-panel p-4 border border-slate-800">
        <button type="button"
          onClick={() => setShowLegacy((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-slate-300 hover:text-white transition-colors">
          <span className="flex items-center gap-2">
            <Music className="w-4 h-4 text-slate-500" />
            Manual Seed Explorer (Static Catalog)
          </span>
          <span className="text-xs text-slate-500">{showLegacy ? '▲ Hide' : '▼ Show'}</span>
        </button>

        {showLegacy && (
          <div className="mt-4 space-y-6">
            <p className="text-xs text-slate-500">
              This section uses the client-side 2,500-track catalog and the original JS recommender.
              It works without an account and doesn't call the server.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Personas */}
              <div className="glass-panel p-4 space-y-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Explore Personas</span>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_PERSONAS.map((p) => {
                    const isActive = activePersona === p.name;
                    return (
                      <button key={p.name} onClick={() => applyPersona(p)}
                        className={`p-3 rounded-xl text-left transition-all border ${
                          isActive ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/80'}`}>
                        <div className="text-lg mb-1">{p.icon}</div>
                        <div className="text-xs font-bold">{p.name}</div>
                      </button>
                    );
                  })}
                </div>

                {/* Search */}
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Search &amp; Add</label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input type="text" placeholder="Song or artist…" value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors" />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 glass-panel p-1.5 border-slate-700 max-h-48 overflow-y-auto space-y-1">
                      {searchResults.map((song) => (
                        <button key={song.track_id} onClick={() => { setSelectedSongs((p) => [...p, song]); setSearchQuery(''); setActivePersona(null); }}
                          className="w-full flex items-center justify-between p-2 rounded-lg text-left text-xs hover:bg-slate-800 transition-colors group">
                          <div className="truncate pr-2">
                            <span className="font-semibold text-slate-100 block truncate">{song.track_name}</span>
                            <span className="text-[11px] text-slate-400">{song.track_artist}</span>
                          </div>
                          <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Selected songs */}
              <div className="lg:col-span-2 glass-panel p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Seeds <span className="font-mono text-xs text-blue-400">({selectedSongs.length})</span></h3>
                  {selectedSongs.length > 0 && (
                    <button onClick={() => { setSelectedSongs([]); setActivePersona(null); }}
                      className="text-xs text-slate-400 hover:text-red-400 flex items-center gap-1">
                      <RotateCcw className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
                {selectedSongs.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-800 rounded-xl">
                    <p className="text-xs text-slate-500">Pick a persona or search above.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {selectedSongs.map((song) => (
                      <div key={song.track_id} className="flex items-center justify-between p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
                        <div className="truncate pr-2">
                          <div className="text-xs font-semibold text-slate-200 truncate">{song.track_name}</div>
                          <div className="text-[11px] text-slate-400">{song.track_artist}</div>
                        </div>
                        <button onClick={() => setSelectedSongs((p) => p.filter((s) => s.track_id !== song.track_id))}
                          className="text-slate-500 hover:text-red-400 p-1">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* User profile card (legacy) */}
            {userProfile && selectedSongs.length > 0 && (
              <div className="glass-panel p-5 bg-gradient-to-r from-blue-950/30 to-indigo-950/30 border border-blue-500/20 space-y-3">
                <div>
                  <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Archetype (from seeds)</span>
                  <h3 className="text-xl font-bold text-white font-heading mt-1">{userProfile.archetype}</h3>
                  <p className="text-xs text-slate-300 italic">{userProfile.tagline}</p>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 font-mono">
                  {[
                    { label: 'Energy',       val: userProfile.audioProfile?.energyPct,       color: 'text-red-400' },
                    { label: 'Dance',        val: userProfile.audioProfile?.danceabilityPct, color: 'text-pink-400' },
                    { label: 'Valence',      val: userProfile.audioProfile?.valencePct,      color: 'text-yellow-400' },
                    { label: 'Acoustic',     val: userProfile.audioProfile?.acousticnessPct, color: 'text-emerald-400' },
                    { label: 'Speech',       val: userProfile.audioProfile?.speechinessPct,  color: 'text-blue-400' },
                    { label: 'Tempo',        val: userProfile.audioProfile?.avgTempoBpm,     color: 'text-indigo-400', unit: 'BPM' },
                    { label: 'Pop',          val: userProfile.audioProfile?.avgPopularity,   color: 'text-amber-400' },
                  ].map(({ label, val, color, unit }) => (
                    <div key={label} className="p-2 bg-slate-900/60 border border-slate-800 rounded-xl text-center">
                      <span className={`text-[10px] uppercase font-semibold block ${color}`}>{label}</span>
                      <span className="text-sm font-bold text-white">{val ?? '—'}{unit ? ` ${unit}` : val != null ? '%' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legacy rec controls + results */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-blue-500">
                  <option value="all">All Genres</option>
                  <option value="pop">Pop</option><option value="rap">Rap</option>
                  <option value="rock">Rock</option><option value="latin">Latin</option>
                  <option value="r&b">R&amp;B</option><option value="edm">EDM</option>
                </select>
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">Min pop:</span>
                  <input type="number" min="0" max="90" value={minPopularity}
                    onChange={(e) => setMinPopularity(Math.min(90, Math.max(0, Number(e.target.value) || 0)))}
                    className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-center focus:outline-none focus:border-blue-500 font-mono" />
                </div>
                <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-blue-500 font-mono">
                  <option value="5">Top 5</option><option value="10">Top 10</option>
                  <option value="15">Top 15</option><option value="20">Top 20</option>
                </select>
              </div>

              {selectedSongs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">Select seed tracks above to generate recommendations.</p>
              ) : legacyRecs.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No results for current filters.</p>
              ) : (
                <div className="space-y-2">
                  {legacyRecs.map((rec) => (
                    <div key={rec.track_id} className="p-3.5 bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-xl transition-all">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="text-xs font-mono text-slate-500 w-5">#{rec.rank}</span>
                          <div className="truncate">
                            <span className="font-semibold text-xs text-slate-100">{rec.track_name}</span>
                            <span className="text-[11px] text-slate-400 block">{rec.track_artist}</span>
                          </div>
                        </div>
                        <span className="font-bold text-sm text-emerald-400 font-mono flex-shrink-0">
                          {rec.similarityPercentage}%
                        </span>
                      </div>
                      {rec.explanation?.topMatchingFeatures?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {rec.explanation.topMatchingFeatures.map((m) => (
                            <span key={m.feature} className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-md font-mono">
                              {m.feature} {m.similarityPct}%
                            </span>
                          ))}
                        </div>
                      )}
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
