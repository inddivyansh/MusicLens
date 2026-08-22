import React from 'react';

/**
 * Avatar — Compact profile avatar with user initial and brand gradient ring.
 *
 * @param {string} [email]
 * @param {string} [displayName]
 * @param {'sm' | 'md' | 'lg'} [size='sm']
 */
export default function Avatar({ email, displayName, size = 'sm' }) {
  const name = displayName || email || '?';
  const initial = name.charAt(0).toUpperCase();

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
  };

  return (
    <div
      className={`rounded-full bg-signature-gradient p-[1.5px] shadow-sm shadow-purple-500/20 shrink-0 inline-flex`}
    >
      <div
        className={`${sizeClasses[size] || sizeClasses.sm} rounded-full bg-[#140e24] flex items-center justify-center font-bold text-purple-200 font-heading select-none`}
      >
        {initial}
      </div>
    </div>
  );
}
