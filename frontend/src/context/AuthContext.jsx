/**
 * frontend/src/context/AuthContext.jsx
 * Provides authentication and Spotify connection state to the entire app.
 *
 * State:
 *   user               — { id, email } or null when logged out
 *   spotifyConnected   — boolean (derived from /api/auth/me + /api/spotify/status)
 *   spotifyDisplayName — string or null (Spotify display_name)
 *   loading            — true while the initial /api/auth/me check is in flight
 *   authError          — string or null (last auth/spotify error message)
 *
 * Actions exposed:
 *   register(email, password)
 *   login(email, password)
 *   logout()
 *   refreshSpotifyStatus()   — re-fetches /api/spotify/status
 *   disconnectSpotify()
 *   clearError()
 *
 * Tokens are NEVER stored here — the httpOnly cookie is managed by the browser.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, spotifyApi, ApiError } from '../utils/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyDisplayName, setSpotifyDisplayName] = useState(null);
  const [loading, setLoading] = useState(true);   // initial session check
  const [authError, setAuthError] = useState(null);

  // ── Initial session hydration ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const me = await authApi.me();
        if (cancelled) return;
        setUser({ id: me.id, email: me.email });
        setSpotifyConnected(me.spotifyConnected);
        // If connected, fetch the display name separately
        if (me.spotifyConnected) {
          try {
            const st = await spotifyApi.status();
            if (!cancelled) setSpotifyDisplayName(st.displayName);
          } catch {
            // Non-fatal — status fetch failure doesn't break auth
          }
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Not logged in — normal state
          setUser(null);
        }
        // Other errors: leave user null, will show login form
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    hydrate();
    return () => { cancelled = true; };
  }, []);

  // ── Register ─────────────────────────────────────────────────────────
  const register = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const data = await authApi.register(email, password);
      setUser({ id: data.id, email: data.email });
      setSpotifyConnected(false);
      setSpotifyDisplayName(null);
      return true;
    } catch (err) {
      setAuthError(err.message || 'Registration failed.');
      return false;
    }
  }, []);

  // ── Login ─────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    setAuthError(null);
    try {
      const data = await authApi.login(email, password);
      setUser({ id: data.id, email: data.email });
      // Refresh spotify status post-login
      try {
        const me = await authApi.me();
        setSpotifyConnected(me.spotifyConnected);
        if (me.spotifyConnected) {
          const st = await spotifyApi.status();
          setSpotifyDisplayName(st.displayName);
        }
      } catch {
        // Non-fatal
      }
      return true;
    } catch (err) {
      setAuthError(err.message || 'Login failed.');
      return false;
    }
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    setAuthError(null);
    try {
      await authApi.logout();
    } catch {
      // Even if the server errors, clear local state
    }
    setUser(null);
    setSpotifyConnected(false);
    setSpotifyDisplayName(null);
  }, []);

  // ── Refresh Spotify status ────────────────────────────────────────────
  const refreshSpotifyStatus = useCallback(async () => {
    if (!user) return;
    try {
      const st = await spotifyApi.status();
      setSpotifyConnected(st.connected);
      setSpotifyDisplayName(st.connected ? st.displayName : null);
    } catch {
      // Non-fatal
    }
  }, [user]);

  // ── Disconnect Spotify ────────────────────────────────────────────────
  const disconnectSpotify = useCallback(async () => {
    setAuthError(null);
    try {
      await spotifyApi.disconnect();
      setSpotifyConnected(false);
      setSpotifyDisplayName(null);
      return true;
    } catch (err) {
      setAuthError(err.message || 'Could not disconnect Spotify.');
      return false;
    }
  }, []);

  const clearError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      spotifyConnected,
      spotifyDisplayName,
      loading,
      authError,
      register,
      login,
      logout,
      refreshSpotifyStatus,
      disconnectSpotify,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Convenience hook — throws if used outside AuthProvider. */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
