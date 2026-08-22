import React, { useState } from 'react';
import { Music2, LogIn, UserPlus, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function AuthForm() {
  const { register, login, authError, clearError } = useAuth();

  const [mode, setMode] = useState('login');
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
      if (mode === 'login') {
        await login(email.trim().toLowerCase(), password);
      } else {
        await register(email.trim().toLowerCase(), password);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center p-2">
      <div className="glass-panel p-6 sm:p-8 w-full max-w-md space-y-6 border-purple-500/20 shadow-2xl shadow-purple-950/40">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-signature-gradient flex items-center justify-center shadow-lg shadow-purple-600/30 mx-auto text-white">
            <Music2 className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white font-heading">
            {mode === 'login' ? 'Sign in to MusicLens' : 'Create your account'}
          </h2>
          <p className="text-xs text-[#a1a1c2]">
            {mode === 'login'
              ? 'Access your personal music taste profile & discoveries.'
              : 'Unlock personalized recommendations and blend.'}
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl bg-[#140e24] border border-white/10 p-1 gap-1">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeSwitch(m)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
                mode === m
                  ? 'bg-signature-gradient text-white shadow-sm'
                  : 'text-[#a1a1c2] hover:text-white'
              }`}
            >
              {m === 'login' ? <LogIn className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>{m === 'login' ? 'Sign In' : 'Register'}</span>
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="ml-email" className="text-xs font-semibold text-[#a1a1c2] uppercase tracking-wide">
              Email address
            </label>
            <input
              id="ml-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setLocalError(null);
                clearError();
                setEmail(e.target.value);
              }}
              disabled={submitting}
              placeholder="you@example.com"
              className="w-full bg-[#140e24] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-[#6b6b8f] focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ml-password" className="text-xs font-semibold text-[#a1a1c2] uppercase tracking-wide">
              Password {mode === 'register' && <span className="text-[#6b6b8f] normal-case">(min 8 chars)</span>}
            </label>
            <div className="relative">
              <input
                id="ml-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                value={password}
                onChange={(e) => {
                  setLocalError(null);
                  clearError();
                  setPassword(e.target.value);
                }}
                disabled={submitting}
                placeholder="••••••••"
                className="w-full bg-[#140e24] border border-white/10 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-white placeholder-[#6b6b8f] focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6b8f] hover:text-white"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-300 bg-red-950/20 border border-red-500/20 rounded-xl p-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-signature-gradient hover:opacity-95 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all shadow-lg shadow-purple-600/20 active:scale-95"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{mode === 'login' ? 'Signing in…' : 'Creating account…'}</span>
              </>
            ) : (
              <span>{mode === 'login' ? 'Sign In' : 'Create Account'}</span>
            )}
          </button>
        </form>

        <p className="text-center text-xs text-[#6b6b8f]">
          MusicLens explore features work without signing in.{' '}
          <span className="text-purple-300">Sign in to connect Spotify and personalize your discovery.</span>
        </p>
      </div>
    </div>
  );
}
