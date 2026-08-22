/**
 * frontend/src/components/AuthForm.jsx
 * Login / Register form shown when the user has no active session.
 * Renders as a centered glass-panel card, fully within the existing design system.
 * No tokens are stored in JS — the httpOnly cookie is set by the server.
 */

import React, { useState } from 'react';
import { Music2, LogIn, UserPlus, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthForm() {
  const { register, login, authError, clearError } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const error = localError || authError;

  function handleModeSwitch(newMode) {
    clearError();
    setLocalError(null);
    setEmail('');
    setPassword('');
    setMode(newMode);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLocalError(null);
    clearError();

    // Client-side basic validation
    if (!email.trim()) {
      setLocalError('Email is required.');
      return;
    }
    if (!password) {
      setLocalError('Password is required.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      setLocalError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const ok = mode === 'login'
        ? await login(email.trim().toLowerCase(), password)
        : await register(email.trim().toLowerCase(), password);

      if (!ok) {
        // authError is set by the context
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="glass-panel p-8 w-full max-w-md space-y-6">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 mx-auto">
            <Music2 className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white font-heading">
            {mode === 'login' ? 'Sign in to MusicLens' : 'Create your account'}
          </h2>
          <p className="text-sm text-slate-400">
            {mode === 'login'
              ? 'Access your personal music intelligence platform.'
              : 'Start exploring your music identity.'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-1 gap-1">
          {(['login', 'register']).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeSwitch(m)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-all ${
                mode === m
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'login' ? <LogIn className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Email */}
          <div className="space-y-1.5">
            <label htmlFor="ml-email" className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Email address
            </label>
            <input
              id="ml-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setLocalError(null); clearError(); setEmail(e.target.value); }}
              disabled={submitting}
              placeholder="you@example.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="ml-password" className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Password {mode === 'register' && <span className="text-slate-500 font-normal normal-case">(min 8 characters)</span>}
            </label>
            <div className="relative">
              <input
                id="ml-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => { setLocalError(null); clearError(); setPassword(e.target.value); }}
                disabled={submitting}
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors shadow-md shadow-blue-500/20"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> {mode === 'login' ? 'Signing in…' : 'Creating account…'}</>
              : mode === 'login' ? 'Sign In' : 'Create Account'
            }
          </button>
        </form>

        <p className="text-center text-xs text-slate-500">
          Your analytics experience works without an account.{' '}
          <span className="text-blue-400">Sign in to connect Spotify and unlock personalized features.</span>
        </p>
      </div>
    </div>
  );
}
