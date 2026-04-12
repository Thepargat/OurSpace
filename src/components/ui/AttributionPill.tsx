/**
 * OurSpace — Attribution Pill
 * Reusable "who did this" component shown across Grocery, Chores, Notes, Finance, Calendar, etc.
 */

import { useMemo } from 'react';

interface Props {
  userId: string;
  displayName?: string;
  photoURL?: string | null;
  timestamp?: Date | null;
  size?: 'sm' | 'md';
  currentUserId?: string;
}

// Generate initials from display name
const getInitials = (name?: string): string => {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2);
};

// Deterministic colour from userId
const getAvatarColor = (userId: string, isCurrentUser: boolean): string => {
  if (isCurrentUser) return 'linear-gradient(135deg, #B8955A, #D4A96A)'; // brass
  // Warm green for partner
  return 'linear-gradient(135deg, #7FAF7B, #5FAF6A)';
};

const relativeTime = (date: Date): string => {
  const diff = Date.now() - date.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function AttributionPill({
  userId,
  displayName,
  photoURL,
  timestamp,
  size = 'sm',
  currentUserId,
}: Props) {
  const isCurrentUser = userId === currentUserId;
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const avatarBg = getAvatarColor(userId, isCurrentUser);

  const avatarSize = size === 'sm' ? 20 : 32;
  const fontSize   = size === 'sm' ? '9px' : '12px';

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {/* Avatar */}
      <div
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: '50%',
          background: avatarBg,
          border: `1.5px solid white`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        {photoURL ? (
          <img
            src={photoURL}
            alt={displayName || 'User'}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span style={{ fontSize, color: 'white', fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}>
            {initials}
          </span>
        )}
      </div>

      {/* Name + time (md only) */}
      {size === 'md' && (
        <div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '12px', color: '#1A1A1A', fontWeight: 500, lineHeight: 1 }}>
            {isCurrentUser ? 'You' : (displayName?.split(' ')[0] || 'Partner')}
          </div>
          {timestamp && (
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: '10px', color: '#6B6560', lineHeight: 1, marginTop: 2 }}>
              {relativeTime(timestamp)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
