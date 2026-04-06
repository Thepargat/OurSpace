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
import { syncGoogleCalendar, pushToGoogleCalendar, detectConflicts, CalendarEvent } from '../../services/calendarSync';

const CATEGORIES = [
  { name: 'Work', color: '#8B9EB7' },
  { name: 'Personal', color: '#8FAF8B' },
  { name: 'Date Night', color: '#B8955A' },
  { name: 'Bills', color: '#C97B6A' },
  { name: 'Health', color: '#8FB5AF' }
];

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };

export default function CalendarTab() {
  const { user, householdId, googleAccessToken, connectGoogleCalendar, userData } = useAuth();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [direction, setDirection] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConflictDetails, setShowConflictDetails] = useState(false);

  // Form state for new event
  const [newTitle, setNewTitle] = useState("");
  const [newStartTime, setNewStartTime] = useState(format(new Date(), "HH:mm"));
  const [newEndTime, setNewEndTime] = useState(format(addDays(new Date(), 0), "HH:mm"));
  const [newCategory, setNewCategory] = useState('Personal');
  const [newNotes, setNewNotes] = useState("");
  const [newReminder, setNewReminder] = useState('None');
  const [newRepeat, setNewRepeat] = useState('None');
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

  // Initial sync and periodic sync
  useEffect(() => {
    if (user && householdId && googleAccessToken) {
      const runSync = async () => {
        setIsSyncing(true);
        await syncGoogleCalendar(user.uid, householdId, googleAccessToken);
        setIsSyncing(false);
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
    if (!newTitle.trim() || !user || !householdId) return;

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
      syncedBy: user.uid,
      householdId,
      updatedAt: new Date().toISOString()
    };

    try {
      if (syncToGoogle && googleAccessToken) {
        const gId = await pushToGoogleCalendar(eventData, googleAccessToken);
        if (gId) eventData.googleEventId = gId;
      }

      await addDoc(collection(db, "households", householdId, "events"), eventData);
      await detectConflicts(householdId);
      
      setIsAddSheetOpen(false);
      setNewTitle("");
      setNewNotes("");
    } catch (error) {
      console.error("Error saving event:", error);
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

  return (
    <PageTransition>
      <div className="flex h-full flex-col bg-[#F8F4EE] overflow-y-auto pb-[calc(120px+env(safe-area-inset-bottom))]">
        {/* Header */}
        <div className="px-6 pt-16 pb-6">
          <div className="flex items-center justify-between mb-8">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-serif text-[32px] font-light text-[#1A1A1A]"
            >
              {format(currentDate, 'MMMM yyyy')}
            </motion.h1>
            
            <div className="flex items-center gap-2">
              <div className="flex bg-[#EDE8DF] p-1 rounded-full border border-[#D4CEC4]">
                {['month', 'week', 'day'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode as any)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                      viewMode === mode ? 'bg-[#1A1A1A] text-white' : 'text-[#1A1A1A]'
                    }`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <motion.button whileTap={{ scale: 0.9 }} onClick={prevMonth} className="p-2 text-[#6B6560]">
                  <ChevronLeft size={24} />
                </motion.button>
                <motion.button whileTap={{ scale: 0.9 }} onClick={nextMonth} className="p-2 text-[#6B6560]">
                  <ChevronRight size={24} />
                </motion.button>
              </div>
            </div>
          </div>

          {/* Google Calendar Connect Card */}
          {!userData?.calendarConnected && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-6 mb-8"
            >
              <h3 className="font-serif text-xl text-[#1A1A1A] mb-2">Sync with Google Calendar</h3>
              <p className="font-outfit text-sm text-[#6B6560] mb-6">See all your events in one place and avoid conflicts</p>
              <button 
                onClick={connectGoogleCalendar}
                className="w-full h-12 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium"
              >
                Connect Google Calendar
              </button>
            </motion.div>
          )}

          {/* Conflict Banner */}
          {conflicts.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
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
                          <div className="text-xs font-bold text-[#C97B6A] mb-2">OVERLAP:</div>
                          <div className="flex flex-col gap-1">
                            <div className="text-sm text-[#1A1A1A] font-serif">{eventA.title}</div>
                            <div className="text-xs text-[#6B6560] font-outfit">{format(parseISO(eventA.startTime), 'h:mm a')} - {format(parseISO(eventA.endTime), 'h:mm a')}</div>
                            <div className="text-xs text-[#C97B6A] font-bold my-1">VS</div>
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
            <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-3xl p-6 shadow-sm">
              <div className="grid grid-cols-7 gap-y-4 text-center mb-6">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="text-[11px] font-medium text-[#6B6560] uppercase tracking-wider font-outfit">
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
                    className="grid grid-cols-7 gap-y-2 text-center"
                  >
                    {days.map((day, i) => {
                      const isSelected = isSameDay(day, selectedDate);
                      const isCurrMonth = isSameMonth(day, currentDate);
                      const dayEvents = getEventsForDay(day);
                      const hasConflict = hasConflictOnDay(day);
                      const myEvents = dayEvents.filter(e => e.syncedBy === user?.uid);
                      const partnerEvents = dayEvents.filter(e => e.syncedBy !== user?.uid);

                      return (
                        <div key={i} className="flex flex-col items-center py-1">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => setSelectedDate(day)}
                            className={`
                              relative w-11 h-11 flex items-center justify-center rounded-full text-sm transition-all font-serif
                              ${!isCurrMonth ? 'text-[#D4CEC4]' : 'text-[#1A1A1A]'}
                              ${isSelected ? 'bg-[#EDE8DF] border border-[#D4CEC4] font-bold' : ''}
                              ${isToday(day) ? 'bg-[#1A1A1A] !text-white' : ''}
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
            </div>
          )}

          {/* Selected Day Events */}
          <div className="mt-8 space-y-4">
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
                      initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ ...spring, delay: idx * 0.05 }}
                      className={`bg-[#EDE8DF] border ${isConflict ? 'border-[#C97B6A]' : 'border-[#D4CEC4]'} rounded-2xl p-4 pl-5 relative overflow-hidden`}
                    >
                      <div 
                        className="absolute left-0 top-0 bottom-0 w-1" 
                        style={{ background: category.color }} 
                      />
                      
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-serif text-lg text-[#1A1A1A] mb-1">{event.title}</h4>
                          <div className="flex items-center gap-2 text-[#6B6560] font-outfit text-[13px]">
                            <Clock size={14} />
                            <span>{format(parseISO(event.startTime), 'h:mm a')} – {format(parseISO(event.endTime), 'h:mm a')}</span>
                          </div>
                          {isConflict && partnerEvent && (
                            <div className="mt-2 text-[#C97B6A] font-outfit text-xs font-medium">
                              Conflicts with {partnerEvent.title}
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {event.source === 'google' && (
                            <div title="Synced from Google Calendar">
                              <CalendarIcon size={16} className="text-[#6B6560]" />
                            </div>
                          )}
                          {event.syncedBy !== user?.uid && (
                            <div className="w-5 h-5 rounded-full bg-[#D4CEC4] border border-[#F8F4EE]" />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              ) : (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-12"
                >
                  <p className="font-outfit text-[#6B6560]">No events scheduled for today.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Floating Add Button */}
        <motion.button
          whileTap={{ scale: 0.92, rotate: 45 }}
          onClick={() => setIsAddSheetOpen(true)}
          className="fixed bottom-24 right-6 w-14 h-14 bg-[#B8955A] text-white rounded-full flex items-center justify-center shadow-lg z-50"
        >
          <Plus size={28} />
        </motion.button>

        {/* Add Event Bottom Sheet */}
        <BottomSheet isOpen={isAddSheetOpen} onClose={() => setIsAddSheetOpen(false)}>
          <div className="px-6 pb-12 pt-2">
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

              {/* Google Sync Toggle */}
              {userData?.calendarConnected && (
                <div className="flex items-center justify-between bg-[#EDE8DF] p-4 rounded-xl border border-[#D4CEC4]">
                  <div className="flex items-center gap-3">
                    <CalendarIcon size={20} className="text-[#B8955A]" />
                    <span className="font-outfit text-sm text-[#1A1A1A]">Also add to Google Calendar</span>
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

              {/* Save Button */}
              <button
                onClick={handleSaveEvent}
                className="w-full h-[52px] bg-[#1A1A1A] text-white rounded-full font-outfit font-medium shadow-lg flex items-center justify-center gap-2"
              >
                Add Event ✦
              </button>
            </div>
          </div>
        </BottomSheet>
      </div>
    </PageTransition>
  );
}
