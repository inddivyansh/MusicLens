/**
 * frontend/src/components/SpotifyPanel.jsx
 * Spotify connection management panel shown in the user account area.
 *
 * States:
 *  - Not connected: shows "Connect Spotify" button → opens PrivacyPolicyModal
 *  - Connected: shows Spotify display name + "Disconnect" button
 *  - Loading: spinner while disconnect is in progress
 *
 * Tokens are never stored in React state — all token logic is server-side.
 */

import React, { useState } from 'react';
import { Music2, Link2, Link2Off, Loader2, CheckCircle2 } from 'lucide-react';
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
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="max-w-[120px] truncate" title={spotifyDisplayName || 'Connected'}>
              {spotifyDisplayName || 'Spotify connected'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-red-400 hover:border-red-500/40 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Disconnect Spotify"
          >
            {disconnecting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Link2Off className="w-3.5 h-3.5" />
            }
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
        {authError && (
          <p className="text-xs text-red-400 mt-1">{authError}</p>
        )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowPrivacyModal(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold text-white transition-colors shadow-md shadow-emerald-500/20"
      >
        <Music2 className="w-3.5 h-3.5" />
        Connect Spotify
      </button>

      {showPrivacyModal && (
        <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} />
      )}
    </>
  );
}
