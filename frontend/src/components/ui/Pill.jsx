import React from 'react';

/**
 * Pill — Standardized category, genre, and status tag.
 *
 * @param {string} label
 * @param {string} [genre] - 'pop' | 'rap' | 'rock' | 'latin' | 'r&b' | 'edm'
 * @param {string} [type='default'] - 'genre' | 'status' | 'badge'
 * @param {'sm' | 'md'} [size='sm']
 */
export default function Pill({ label, genre, type = 'default', size = 'sm' }) {
  const g = (genre || label || '').toLowerCase().trim();

  const genreMap = {
    pop:   'genre-pop',
    rap:   'genre-rap',
    rock:  'genre-rock',
    latin: 'genre-latin',
    'r&b': 'genre-rnb',
    rnb:   'genre-rnb',
    edm:   'genre-edm',
  };

  const cls = genreMap[g] || 'genre-other';

  return (
    <span className={`genre-badge ${cls} ${size === 'md' ? 'text-xs px-3 py-1' : ''}`}>
      {label}
    </span>
  );
}
