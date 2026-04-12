/**
 * OurSpace — Activity Feed Screen
 * Live, real-time log of everything both partners do across the app.
 * Each action writes to /households/{id}/activityFeed/
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Filter } from 'lucide-react';
import {
  collection, query, orderBy, limit, onSnapshot, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { format, isToday, isYesterday, formatDistanceToNow } from 'date-fns';
import AttributionPill from '../ui/AttributionPill';
import { staggerContainer, staggerItem, SPRING_DEFAULT } from '../../lib/motion';

// ============================================================
// TYPES
// ============================================================
export interface ActivityEvent {
  id: string;
  type:
    | 'grocery_added' | 'grocery_checked' | 'grocery_deleted'
    | 'chore_completed' | 'chore_added'
    | 'expense_added' | 'expense_scanned'
    | 'memory_added'
    | 'calendar_added'
    | 'note_added'
    | 'meal_planned'
    | 'bucket_added' | 'bucket_completed';
  title: string;
  description?: string;
  userId: string;
  userDisplayName?: string;
  userPhotoURL?: string;
  timestamp: Date;
  meta?: Record<string, any>;
}

// ============================================================
// WRITE TO FEED (called by other tabs)
// ============================================================
export const logActivity = async (
  householdId: string,
  event: Omit<ActivityEvent, 'id' | 'timestamp'>
) => {
  try {
    const { addDoc, serverTimestamp } = await import('firebase/firestore');
    await addDoc(collection(db, `households/${householdId}/activityFeed`), {
      ...event,
      timestamp: serverTimestamp(),
    });
  } catch (e) {
    // Non-critical — silent fail
  }
};

// ============================================================
// EMOJI + LABEL PER EVENT TYPE
// ============================================================
const EVENT_META: Record<ActivityEvent['type'], { emoji: string; color: string }> = {
  grocery_added:    { emoji: '🛒', color: '#4CAF50' },
  grocery_checked:  { emoji: '✅', color: '#4CAF50' },
  grocery_deleted:  { emoji: '🗑️', color: '#9E9E9E' },
  chore_completed:  { emoji: '🧹', color: '#B8955A' },
  chore_added:      { emoji: '📋', color: '#9C27B0' },
  expense_added:    { emoji: '🧾', color: '#FF9800' },
  expense_scanned:  { emoji: '📷', color: '#FF9800' },
  memory_added:     { emoji: '📸', color: '#C47B6A' },
  calendar_added:   { emoji: '📅', color: '#2196F3' },
  note_added:       { emoji: '📝', color: '#607D8B' },
  meal_planned:     { emoji: '🍽️', color: '#FF5722' },
  bucket_added:     { emoji: '🎯', color: '#9C27B0' },
  bucket_completed: { emoji: '🎉', color: '#4CAF50' },
};

// ============================================================
// GROUP BY DATE
// ============================================================
const getDateLabel = (date: Date): string => {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, d MMMM');
};

// ============================================================
// ACTIVITY FEED SCREEN
// ============================================================
interface Props {
  onBack: () => void;
}

export default function ActivityFeedScreen({ onBack }: Props) {
  const { householdId, user } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'grocery' | 'chores' | 'finance' | 'memories'>('all');

  useEffect(() => {
    if (!householdId) return;

    const q = query(
      collection(db, `households/${householdId}/activityFeed`),
      orderBy('timestamp', 'desc'),
      limit(200)
    );

    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id,
          ...raw,
          timestamp: raw.timestamp instanceof Timestamp
            ? raw.timestamp.toDate()
            : new Date(raw.timestamp),
        } as ActivityEvent;
      });
      setEvents(data);
      setLoading(false);
    });

    return unsub;
  }, [householdId]);

  const filtered = events.filter(e => {
    if (filter === 'grocery')  return e.type.startsWith('grocery');
    if (filter === 'chores')   return e.type.startsWith('chore');
    if (filter === 'finance')  return e.type.startsWith('expense');
    if (filter === 'memories') return e.type.startsWith('memory') || e.type.startsWith('bucket');
    return true;
  });

  // Group by date
  const grouped: Record<string, ActivityEvent[]> = {};
  for (const event of filtered) {
    const label = getDateLabel(event.timestamp);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(event);
  }

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={SPRING_DEFAULT}
      className="fixed inset-0 z-[150] bg-[#F8F4EE] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-[#D4CEC4] flex-shrink-0">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-[#1A1A1A]" />
        </button>
        <div>
          <h2 className="font-serif text-[22px] text-[#1A1A1A]">Activity</h2>
          <p className="font-outfit text-[12px] text-[#6B6560]">Everything happening in your home</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="px-5 py-3 flex gap-2 overflow-x-auto no-scrollbar flex-shrink-0 border-b border-[#D4CEC4]">
        {(['all', 'grocery', 'chores', 'finance', 'memories'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full font-outfit text-[12px] whitespace-nowrap transition-colors flex-shrink-0 ${
              filter === f
                ? 'bg-[#1A1A1A] text-white'
                : 'bg-[#EDE8DF] text-[#6B6560]'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center pt-20">
            <div className="w-8 h-8 border-2 border-[#B8955A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center pt-20 text-center">
            <div className="text-[48px] mb-4">📋</div>
            <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No activity yet</h3>
            <p className="font-outfit text-[13px] text-[#6B6560]">Start using the app to see activity here</p>
          </div>
        ) : (
          Object.entries(grouped).map(([dateLabel, dayEvents]) => (
            <div key={dateLabel} className="mb-6">
              {/* Date label */}
              <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">{dateLabel}</p>

              {/* Events */}
              <div className="space-y-3">
                {dayEvents.map(event => {
                  const meta = EVENT_META[event.type] || { emoji: '📌', color: '#9E9E9E' };
                  const isMe = event.userId === user?.uid;

                  return (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-start gap-3 p-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl"
                    >
                      {/* Event icon */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-[18px] flex-shrink-0"
                        style={{ background: meta.color + '22' }}
                      >
                        {meta.emoji}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="font-outfit text-[14px] text-[#1A1A1A] font-medium">
                          <span style={{ color: isMe ? '#B8955A' : '#7FAF7B' }}>
                            {isMe ? 'You' : (event.userDisplayName?.split(' ')[0] || 'Partner')}
                          </span>
                          {' '}{event.title}
                        </p>
                        {event.description && (
                          <p className="font-outfit text-[12px] text-[#6B6560] mt-0.5 truncate">
                            {event.description}
                          </p>
                        )}
                        <p className="font-outfit text-[11px] text-[#A8A29E] mt-1">
                          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                        </p>
                      </div>

                      {/* Avatar */}
                      <AttributionPill
                        userId={event.userId}
                        displayName={event.userDisplayName}
                        photoURL={event.userPhotoURL}
                        currentUserId={user?.uid}
                        size="sm"
                      />
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
