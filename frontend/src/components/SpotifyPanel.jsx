import React, { useState } from 'react';
import { Music2, Link2Off, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PrivacyPolicyModal from './PrivacyPolicyModal';

export default function SpotifyPanel() {
  const { spotifyConnected, spotifyDisplayName, disconnectSpotify, authError } = useAuth();
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleDisconnect() {
    setDisconnecting(true);
    await disconnectSpotify();
    setDisconnecting(false);
  }

  if (spotifyConnected) {
    return (
      <>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="max-w-[120px] truncate" title={spotifyDisplayName || 'Connected'}>
              {spotifyDisplayName || 'Spotify Connected'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 text-[#a1a1c2] hover:text-red-300 hover:border-red-500/30 text-xs font-semibold transition-colors disabled:opacity-50"
            aria-label="Disconnect Spotify"
          >
            {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2Off className="w-3.5 h-3.5" />}
            <span>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
          </button>
        </div>
        {authError && <p className="text-xs text-red-400 mt-1">{authError}</p>}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPrivacyModal(true)}
        className="flex items-center gap-2 px-3.5 py-1.5 bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold rounded-xl text-xs transition-all shadow-md shadow-[#1DB954]/20 active:scale-95"
      >
        <Music2 className="w-3.5 h-3.5 text-black" />
        <span>Connect Spotify</span>
      </button>

      {showPrivacyModal && (
        <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} />
      )}
    </>
  );
}
