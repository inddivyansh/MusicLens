import React from 'react';

/**
 * LoadingState — Skeleton placeholder blocks matching target layout.
 *
 * @param {'dashboard' | 'cards' | 'list'} [variant='dashboard']
 * @param {string} [message='Loading your insights…']
 */
export default function LoadingState({ variant = 'dashboard', message = 'Loading your insights…' }) {
  return (
    <div className="space-y-6 animate-pulse py-4 w-full">
      {/* Header skeleton */}
      <div className="glass-panel p-6 lg:p-8 rounded-2xl border-white/5 space-y-3">
        <div className="h-3 w-32 bg-purple-900/30 rounded" />
        <div className="h-7 w-64 bg-purple-800/40 rounded-lg" />
        <div className="h-4 w-96 max-w-full bg-purple-900/20 rounded" />
      </div>

      {/* KPI Cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="glass-panel p-4 h-28 flex flex-col justify-between border-white/5">
            <div className="h-3 w-20 bg-purple-900/30 rounded" />
            <div className="h-6 w-16 bg-purple-800/40 rounded" />
            <div className="h-2.5 w-24 bg-purple-900/20 rounded" />
          </div>
        ))}
      </div>

      {/* Content grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 h-64 rounded-2xl border-white/5 space-y-4">
          <div className="h-4 w-40 bg-purple-900/30 rounded" />
          <div className="space-y-3 pt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between">
                  <div className="h-3 w-24 bg-purple-900/20 rounded" />
                  <div className="h-3 w-10 bg-purple-900/20 rounded" />
                </div>
                <div className="h-2 w-full bg-white/5 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel p-6 h-64 rounded-2xl border-white/5 space-y-4">
          <div className="h-4 w-40 bg-purple-900/30 rounded" />
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-3 bg-[#1e1533]/50 rounded-xl space-y-2 border border-white/5">
                <div className="h-3 w-20 bg-purple-900/30 rounded" />
                <div className="h-2.5 w-28 bg-purple-900/20 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-center pt-2">
        <p className="text-xs font-medium text-purple-400/80">{message}</p>
      </div>
    </div>
  );
}
