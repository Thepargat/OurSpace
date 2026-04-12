import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday, 
  startOfWeek, 
  endOfWeek,
  addDays,
  parseISO,
  isWithinInterval,
  startOfDay,
  endOfDay
} from 'date-fns';
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  AlertCircle, 
  Calendar as CalendarIcon,
  Clock,
  Tag,
  FileText,
  Bell,
  Repeat,
  Check
} from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import PageTransition from '../ui/PageTransition';
import BottomSheet from '../ui/BottomSheet';
import AnimatedButton from '../ui/AnimatedButton';
import { syncGoogleCalendar, pushToGoogleCalendar, detectConflicts, CalendarEvent, syncEventToBothPartners } from '../../services/calendarSync';
import { notifyPartner } from '../../services/notificationService';
import { Share2, Globe, Lock, RefreshCw } from 'lucide-react';

const CATEGORIES = [
  { name: 'Work', color: '#8B9EB7' },
  { name: 'Personal', color: '#8FAF8B' },
  { name: 'Date Night', color: '#B8955A' },
  { name: 'Bills', color: '#C97B6A' },
  { name: 'Health', color: '#8FB5AF' }
];

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

export default function CalendarTab() {
  const { user, householdId, googleAccessToken, connectGoogleCalendar, userData, clearGoogleToken } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [direction, setDirection] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showConflictDetails, setShowConflictDetails] = useState(false);

  // Form state for new event
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState(format(new Date(), "HH:mm"));
  const [newEndTime, setNewEndTime] = useState(format(addDays(new Date(), 0), "HH:mm"));
  const [newCategory, setNewCategory] = useState('Personal');
  const [newNotes, setNewNotes] = useState("");
  const [newReminder, setNewReminder] = useState('None');
  const [newRepeat, setNewRepeat] = useState('None');
  const [isShared, setIsShared] = useState(true);
  const [syncToGoogle, setSyncToGoogle] = useState(true);

  // Real-time events listener
  useEffect(() => {
    if (!householdId) return;

    const eventsRef = collection(db, "households", householdId, "events");
    const q = query(eventsRef);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const evs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CalendarEvent));
      setEvents(evs);
    });

    const conflictsRef = collection(db, "households", householdId, "conflicts");
    const unsubscribeConflicts = onSnapshot(conflictsRef, (snapshot) => {
      setConflicts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubscribe();
      unsubscribeConflicts();
    };
  }, [householdId]);

  // Clear sync error when token is cleared
  useEffect(() => {
    if (!googleAccessToken) {
      setSyncError(null);
    }
  }, [googleAccessToken]);

  // Initial sync and periodic sync
  useEffect(() => {
    if (user && householdId && googleAccessToken) {
      const runSync = async () => {
        try {
          setIsSyncing(true);
          await syncGoogleCalendar(user.uid, householdId, googleAccessToken);
        } catch (error: any) {
          // Silent fail as requested
          console.error("Sync error:", error);
        } finally {
          setIsSyncing(false);
        }
      };

      runSync();
      const interval = setInterval(runSync, 15 * 60 * 1000); // 15 minutes
      return () => clearInterval(interval);
    }
  }, [user, householdId, googleAccessToken]);

  const nextMonth = () => {
    setDirection(1);
    setCurrentDate(addMonths(currentDate, 1));
  };

  const prevMonth = () => {
    setDirection(-1);
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleSaveEvent = async () => {
    if (!newTitle.trim() || !user || !householdId) {
      console.error("Missing required data for saving event:", { newTitle, user: !!user, householdId });
      return;
    }

    const start = new Date(selectedDate);
    const [startH, startM] = newStartTime.split(':');
    start.setHours(parseInt(startH), parseInt(startM));

    const end = new Date(selectedDate);
    const [endH, endM] = newEndTime.split(':');
    end.setHours(parseInt(endH), parseInt(endM));

    const eventData: CalendarEvent = {
      title: newTitle,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      notes: newNotes,
      category: newCategory as any,
      source: 'ourspace',
      createdBy: user.uid,
      householdId,
      isShared,
      updatedAt: new Date().toISOString()
    };

    try {
      setIsSyncing(true);
      const docRef = await addDoc(collection(db, "households", householdId, "events"), eventData);
      
      if (isShared) {
        // Sync to both partners' Google Calendars
        await syncEventToBothPartners(docRef.id, householdId);
      } else if (syncToGoogle && googleAccessToken) {
        // Sync only to owner's Google Calendar
        const gId = await pushToGoogleCalendar({ ...eventData, id: docRef.id }, googleAccessToken, user.uid);
        if (gId) {
          await updateDoc(docRef, { 
            googleEventId: gId,
            [`googleEventIds.${user.uid}`]: gId 
          });
        }
      }

      await detectConflicts(householdId);

      // Trigger Notification
      await notifyPartner(
        householdId,
        user.uid,
        "Calendar",
        `${user.displayName || 'Partner'} added ${newTitle} on ${format(selectedDate, 'MMM d')}`,
        "calendar"
      );
      
      setIsAddSheetOpen(false);
      setNewTitle("");
      setNewNotes("");
    } catch (error) {
      console.error("Error saving event:", error);
      alert("Failed to save event. Please try again.");
    }
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const getEventsForDay = (day: Date) => {
    return events.filter(e => isSameDay(parseISO(e.startTime), day));
  };

  const hasConflictOnDay = (day: Date) => {
    const dayEvents = getEventsForDay(day);
    return dayEvents.some(e => conflicts.some(c => c.eventA === e.id || c.eventB === e.id));
  };

  const variants = {
    enter: (direction: number) => ({ x: direction > 0 ? 100 : -100, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({ x: direction < 0 ? 100 : -100, opacity: 0 })
  };

  const selectedDayEvents = getEventsForDay(selectedDate);

  const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: 32, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { type: "spring" as const, stiffness: 280, damping: 22, delay }
  });

  return (
    <PageTransition>
      <div 
        style={{
          height: 'calc(100dvh - 80px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(100px + env(safe-area-inset-bottom))',
          background: '#F8F4EE'
        }}
        className="flex flex-col no-scrollbar"
      >
        {/* Header */}
        <div className="px-6 pt-16 pb-6">
          <motion.div {...fadeUp(0)} className="mb-8">
            <h1 className="font-serif text-[48px] font-light text-[#1A1A1A] leading-[1.1] flex items-center justify-between">
              <div>
                {format(currentDate, 'MMMM')}
                <br />
                {format(currentDate, 'yyyy')}
              </div>
              {isSyncing && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="mr-4 p-2 bg-[#EDE8DF] rounded-full border border-[#D4CEC4]"
                >
                  <RefreshCw size={16} className="text-[#B8955A]" />
                </motion.div>
              )}
            </h1>
          </motion.div>
          
          <motion.div {...fadeUp(0.08)} className="flex items-center justify-between mb-8">
            <div className="flex bg-[#EDE8DF] p-1 rounded-full border border-[#D4CEC4]">
              {['month', 'week', 'day'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode as any)}
                  className={`px-5 py-1.5 rounded-full text-[13px] font-outfit font-medium transition-all ${
                    viewMode === mode ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A]'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <motion.button whileTap={{ scale: 0.9 }} onClick={prevMonth} className="p-2 text-[#1A1A1A]">
                <ChevronLeft size={22} />
              </motion.button>
              <motion.button whileTap={{ scale: 0.9 }} onClick={nextMonth} className="p-2 text-[#1A1A1A]">
                <ChevronRight size={22} />
              </motion.button>
            </div>
          </motion.div>

          {/* Conflict Banner */}
          {conflicts.length > 0 && (
            <motion.div 
              {...fadeUp(0.16)}
              onClick={() => setShowConflictDetails(!showConflictDetails)}
              className="bg-[#F5E6E0] border border-[#C97B6A] rounded-2xl p-4 mb-8 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <AlertCircle className="text-[#C97B6A]" size={20} />
                <div>
                  <h4 className="font-serif text-base text-[#1A1A1A]">Schedule conflict detected</h4>
                  <p className="font-outfit text-[13px] text-[#6B6560]">Tap to see overlapping events</p>
                </div>
              </div>
              
              <AnimatePresence>
                {showConflictDetails && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden mt-4 pt-4 border-t border-[#C97B6A]/20"
                  >
                    {conflicts.map(c => {
                      const eventA = events.find(e => e.id === c.eventA);
                      const eventB = events.find(e => e.id === c.eventB);
                      if (!eventA || !eventB) return null;
                      return (
                        <div key={c.id} className="mb-4 last:mb-0">
                          <div className="text-[10px] font-outfit font-bold text-[#C97B6A] mb-2 uppercase tracking-wider">Overlap:</div>
                          <div className="flex flex-col gap-1">
                            <div className="text-sm text-[#1A1A1A] font-serif">{eventA.title}</div>
                            <div className="text-xs text-[#6B6560] font-outfit">{format(parseISO(eventA.startTime), 'h:mm a')} - {format(parseISO(eventA.endTime), 'h:mm a')}</div>
                            <div className="text-[10px] text-[#C97B6A] font-bold my-1 uppercase tracking-widest">VS</div>
                            <div className="text-sm text-[#1A1A1A] font-serif">{eventB.title}</div>
                            <div className="text-xs text-[#6B6560] font-outfit">{format(parseISO(eventB.startTime), 'h:mm a')} - {format(parseISO(eventB.endTime), 'h:mm a')}</div>
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Month Grid */}
          {viewMode === 'month' && (
            <motion.div {...fadeUp(0.24)} className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-4 shadow-sm">
              <div className="grid grid-cols-7 gap-y-4 text-center mb-6">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                  <div key={i} className="text-[11px] font-medium text-[#6B6560] uppercase tracking-wider font-outfit">
                    {day}
                  </div>
                ))}
              </div>

              <div className="relative min-h-[280px]">
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                  <motion.div
                    key={currentDate.toISOString()}
                    custom={direction}
                    variants={variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={spring}
                    className="grid grid-cols-7 gap-y-1 text-center"
                  >
                    {days.map((day, i) => {
                      const isSelected = isSameDay(day, selectedDate);
                      const isCurrMonth = isSameMonth(day, currentDate);
                      const dayEvents = getEventsForDay(day);
                      const hasConflict = hasConflictOnDay(day);
                      const myEvents = dayEvents.filter(e => e.createdBy === user?.uid);
                      const partnerEvents = dayEvents.filter(e => e.createdBy !== user?.uid);
                      const isPast = day < startOfDay(new Date());

                      return (
                        <div key={i} className="flex flex-col items-center py-1 min-h-[44px]">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => setSelectedDate(day)}
                            className={`
                              relative w-9 h-9 flex items-center justify-center rounded-full text-[15px] transition-all font-outfit
                              ${!isCurrMonth ? 'text-[#D4CEC4]' : 'text-[#1A1A1A]'}
                              ${isSelected ? 'bg-[#EDE8DF] border border-[#D4CEC4]' : ''}
                              ${isToday(day) ? 'bg-[#1A1A1A] !text-white' : ''}
                              ${isPast && !isToday(day) ? 'opacity-40' : ''}
                            `}
                          >
                            {format(day, 'd')}
                          </motion.button>
                          
                          {/* Event Dots */}
                          <div className="flex gap-1 mt-1 h-1.5 justify-center">
                            {hasConflict ? (
                              <div className="w-1.5 h-1.5 rounded-full bg-[#C97B6A]" />
                            ) : (
                              <>
                                {myEvents.length > 0 && <div className="w-1.5 h-1.5 rounded-full bg-[#B8955A]" />}
                                {partnerEvents.length > 0 && <div className="w-1.5 h-1.5 rounded-full bg-[#D4CEC4]" />}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Events List */}
          <div className="mt-12">
            <motion.label {...fadeUp(0.32)} className="font-outfit text-[12px] uppercase tracking-[0.1em] text-[#B8955A] mb-6 block font-medium">
              Events
            </motion.label>
            
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {selectedDayEvents.length > 0 ? (
                  selectedDayEvents.map((event, idx) => {
                    const category = CATEGORIES.find(c => c.name === event.category) || CATEGORIES[1];
                    const isConflict = conflicts.some(c => c.eventA === event.id || c.eventB === event.id);
                    const conflictWith = isConflict ? conflicts.find(c => c.eventA === event.id || c.eventB === event.id) : null;
                    const partnerEventId = conflictWith ? (conflictWith.eventA === event.id ? conflictWith.eventB : conflictWith.eventA) : null;
                    const partnerEvent = events.find(e => e.id === partnerEventId);

                    return (
                      <motion.div
                        key={event.id || idx}
                        {...fadeUp(0.4 + idx * 0.08)}
                        className={`bg-[#EDE8DF] border ${isConflict ? 'border-[#C97B6A]' : 'border-[#D4CEC4]'} rounded-[16px] p-4 px-5 relative overflow-hidden`}
                      >
                        <div 
                          className="absolute left-0 top-0 bottom-0 w-1" 
                          style={{ background: category.color }} 
                        />
                        
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-serif text-[18px] text-[#1A1A1A] mb-1 leading-tight">{event.title}</h4>
                            <div className="flex items-center gap-3 text-[#6B6560] font-outfit text-[13px]">
                              <span>{format(parseISO(event.startTime), 'h:mm a')} – {format(parseISO(event.endTime), 'h:mm a')}</span>
                              {event.isShared && (
                                <span className="flex items-center gap-1 text-[#B8955A] bg-[#B8955A]/10 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                                  <Globe size={10} /> Together
                                </span>
                              )}
                            </div>
                            {isConflict && partnerEvent && (
                              <div className="mt-2 text-[#C97B6A] font-outfit text-xs font-medium">
                                Conflicts with {partnerEvent.title}
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {event.googleEventIds && (
                              <div className="flex -space-x-2 mr-2">
                                {Object.keys(event.googleEventIds).map(uid => (
                                  <div key={uid} className="w-4 h-4 rounded-full bg-[#B8955A] border border-[#EDE8DF] flex items-center justify-center">
                                    <CalendarIcon size={8} className="text-white" />
                                  </div>
                                ))}
                              </div>
                            )}
                            {event.createdBy !== user?.uid && (
                              <div className="w-5 h-5 rounded-full bg-[#D4CEC4] border border-[#F8F4EE]" />
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                ) : (
                  <motion.div 
                    {...fadeUp(0.4)}
                    className="text-center py-12"
                  >
                    <p className="font-outfit text-[14px] italic text-[#D4CEC4]">Nothing planned</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Floating Add Button */}
        <motion.button
          whileTap={{ scale: 0.92, rotate: 45 }}
          onClick={() => setIsAddSheetOpen(true)}
          style={{
            position: 'fixed',
            bottom: '100px',
            right: '24px',
            zIndex: 90,
            width: '56px',
            height: '56px',
            borderRadius: '999px',
            background: '#1A1A1A',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(26,26,26,0.2)',
            border: 'none'
          }}
        >
          <Plus size={28} />
        </motion.button>

        {/* Add Event Bottom Sheet */}
        <BottomSheet 
          isOpen={isAddSheetOpen} 
          onClose={() => setIsAddSheetOpen(false)}
          footer={
            <button
              onClick={handleSaveEvent}
              className="w-full h-[52px] bg-[#1A1A1A] text-white rounded-full font-outfit font-medium shadow-lg flex items-center justify-center gap-2"
            >
              Add Event ✦
            </button>
          }
        >
          <div className="px-0 pt-2">
            <input
              autoFocus
              type="text"
              placeholder="What's happening?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-transparent border-none font-serif text-2xl text-[#1A1A1A] focus:outline-none mb-8 placeholder:text-[#D4CEC4]"
            />

            <div className="space-y-8">
              {/* Date Selection */}
              <div>
                <label className="font-outfit text-xs uppercase tracking-wider text-[#6B6560] mb-3 block">Date</label>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 no-scrollbar">
                  {Array.from({ length: 14 }).map((_, i) => {
                    const date = addDays(new Date(), i);
                    const isSel = isSameDay(date, selectedDate);
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedDate(date)}
                        className={`flex-shrink-0 px-4 py-2 rounded-full border transition-all ${
                          isSel ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-[#EDE8DF] text-[#1A1A1A] border-[#D4CEC4]'
                        }`}
                      >
                        <div className="text-[10px] uppercase font-outfit opacity-60">{format(date, 'EEE')}</div>
                        <div className="text-sm font-serif">{format(date, 'd')}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Time Selection */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="font-outfit text-xs uppercase tracking-wider text-[#6B6560] mb-3 block">Start</label>
                  <input 
                    type="time" 
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl p-3 font-outfit text-[#1A1A1A] focus:outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="font-outfit text-xs uppercase tracking-wider text-[#6B6560] mb-3 block">End</label>
                  <input 
                    type="time" 
                    value={newEndTime}
                    onChange={(e) => setNewEndTime(e.target.value)}
                    className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl p-3 font-outfit text-[#1A1A1A] focus:outline-none"
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="font-outfit text-xs uppercase tracking-wider text-[#6B6560] mb-3 block">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.name}
                      onClick={() => setNewCategory(cat.name)}
                      className={`px-4 py-2 rounded-full border transition-all text-sm font-outfit ${
                        newCategory === cat.name ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'bg-[#EDE8DF] text-[#1A1A1A] border-[#D4CEC4]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="font-outfit text-xs uppercase tracking-wider text-[#6B6560] mb-3 block">Notes</label>
                <textarea
                  placeholder="Add details..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl p-4 font-outfit text-sm text-[#1A1A1A] focus:outline-none min-h-[100px] resize-none"
                />
              </div>

              {/* Shared with Partner Toggle */}
              <div className="flex items-center justify-between bg-[#EDE8DF] p-4 rounded-2xl border border-[#D4CEC4]">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isShared ? 'bg-[#1A1A1A] text-white' : 'bg-[#D4CEC4] text-[#6B6560]'}`}>
                    {isShared ? <Globe size={18} /> : <Lock size={18} />}
                  </div>
                  <div>
                    <span className="font-outfit text-[15px] font-medium text-[#1A1A1A] block">Shared with Partner</span>
                    <span className="font-outfit text-[12px] text-[#6B6560]">Syncs to both Google Calendars</span>
                  </div>
                </div>
                <button 
                  onClick={() => setIsShared(!isShared)}
                  className={`w-12 h-6 rounded-full transition-all relative ${isShared ? 'bg-[#1A1A1A]' : 'bg-[#D4CEC4]'}`}
                >
                  <motion.div 
                    animate={{ x: isShared ? 24 : 4 }}
                    transition={spring}
                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                  />
                </button>
              </div>

              {/* Google Sync Toggle (Only if not shared, since shared always syncs to both) */}
              {!isShared && userData?.calendarConnected && (
                <div className="flex items-center justify-between bg-[#EDE8DF] p-4 rounded-xl border border-[#D4CEC4] opacity-80">
                  <div className="flex items-center gap-3">
                    <CalendarIcon size={20} className="text-[#B8955A]" />
                    <span className="font-outfit text-sm text-[#1A1A1A]">Also add to my Google Calendar</span>
                  </div>
                  <button 
                    onClick={() => setSyncToGoogle(!syncToGoogle)}
                    className={`w-12 h-6 rounded-full transition-all relative ${syncToGoogle ? 'bg-[#B8955A]' : 'bg-[#D4CEC4]'}`}
                  >
                    <motion.div 
                      animate={{ x: syncToGoogle ? 24 : 4 }}
                      className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
        </BottomSheet>
      </div>
    </PageTransition>
  );
}
