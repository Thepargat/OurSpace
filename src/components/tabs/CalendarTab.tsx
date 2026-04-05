import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import PageTransition from '../ui/PageTransition';
import BottomSheet from '../ui/BottomSheet';
import AnimatedButton from '../ui/AnimatedButton';

const EVENTS = [
  { id: 1, date: new Date(), title: "Dinner with Sarah", time: "19:00" },
  { id: 2, date: new Date(), title: "Dentist Appointment", time: "10:30" },
];

export default function CalendarTab() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [direction, setDirection] = useState(0);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const startDate = monthStart; // We could pad this to start on Sunday, but let's keep it simple or pad it
  
  // Pad to start on Sunday
  const startDay = startDate.getDay();
  const paddedStartDate = new Date(startDate);
  paddedStartDate.setDate(startDate.getDate() - startDay);

  // Pad to end on Saturday
  const endDay = monthEnd.getDay();
  const paddedEndDate = new Date(monthEnd);
  paddedEndDate.setDate(monthEnd.getDate() + (6 - endDay));

  const days = eachDayOfInterval({ start: paddedStartDate, end: paddedEndDate });

  const nextMonth = () => {
    setDirection(1);
    setCurrentDate(addMonths(currentDate, 1));
  };

  const prevMonth = () => {
    setDirection(-1);
    setCurrentDate(subMonths(currentDate, 1));
  };

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
    setIsSheetOpen(true);
  };

  const [isError, setIsError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [title, setTitle] = useState("");

  const handleSaveEvent = () => {
    if (!title.trim()) {
      setIsError(true);
      setTimeout(() => setIsError(false), 400);
      return;
    }
    
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setIsAddSheetOpen(false);
      setTitle("");
    }, 600);
  };

  const selectedEvents = EVENTS.filter(e => isSameDay(e.date, selectedDate));

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0
    }),
    center: {
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0
    })
  };

  return (
    <PageTransition>
      <div className="flex h-full flex-col px-6 pt-16 pb-32 bg-texture-2">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-serif text-4xl font-light text-charcoal">Calendar</h1>
          <button 
            onClick={() => setIsAddSheetOpen(true)}
            className="w-10 h-10 rounded-full bg-brass text-white flex items-center justify-center shadow-md"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="bg-parchment rounded-3xl p-6 shadow-sm border border-stone">
          <div className="flex items-center justify-between mb-6">
            <button onClick={prevMonth} className="p-2 text-warm-grey hover:text-charcoal transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h2 className="font-serif text-xl text-charcoal">
              {format(currentDate, 'MMMM yyyy')}
            </h2>
            <button onClick={nextMonth} className="p-2 text-warm-grey hover:text-charcoal transition-colors">
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-y-4 text-center mb-4">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day} className="text-xs font-medium text-warm-grey uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          <div className="relative overflow-hidden" style={{ minHeight: '240px' }}>
            <AnimatePresence initial={false} custom={direction} mode="popLayout">
              <motion.div
                key={currentDate.toISOString()}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="grid grid-cols-7 gap-y-4 text-center absolute inset-0"
              >
                {days.map((day, i) => {
                  const isSelected = isSameDay(day, selectedDate);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const hasEvent = EVENTS.some(e => isSameDay(e.date, day));

                  return (
                    <div key={i} className="flex flex-col items-center justify-center">
                      <button
                        onClick={() => handleDayClick(day)}
                        className={`
                          relative w-8 h-8 flex items-center justify-center rounded-full text-sm transition-colors
                          ${!isCurrentMonth ? 'text-stone' : 'text-charcoal'}
                          ${isSelected ? 'font-bold text-charcoal' : ''}
                        `}
                      >
                        {format(day, 'd')}
                        {isSelected && (
                          <motion.div 
                            layoutId="selectedDay"
                            className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-brass"
                          />
                        )}
                        {!isSelected && hasEvent && (
                          <div className="absolute -bottom-1 w-1 h-1 rounded-full bg-warm-grey opacity-50" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Events Bottom Sheet */}
        <BottomSheet isOpen={isSheetOpen} onClose={() => setIsSheetOpen(false)}>
          <div className="pb-8 pt-2">
            <h2 className="font-serif text-2xl text-charcoal mb-6">
              {format(selectedDate, 'EEEE, MMMM do')}
            </h2>
            
            {selectedEvents.length > 0 ? (
              <div className="space-y-4">
                {selectedEvents.map(event => (
                  <div key={event.id} className="flex flex-col pl-4 border-l-[3px] border-brass py-1">
                    <span className="font-outfit text-xs text-warm-grey mb-1">{event.time}</span>
                    <span className="font-serif text-lg text-charcoal">{event.title}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-warm-grey font-outfit">No events for this day.</p>
            )}
          </div>
        </BottomSheet>

        {/* Add Event Bottom Sheet */}
        <BottomSheet isOpen={isAddSheetOpen} onClose={() => setIsAddSheetOpen(false)}>
          <div className="pb-8 pt-2">
            <h2 className="font-serif text-2xl text-charcoal mb-6">New Event</h2>
            <div className={`space-y-4 mb-8 ${isError ? 'animate-shake' : ''}`}>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Event Title" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent border-b border-stone py-2 font-serif text-xl text-charcoal focus:outline-none peer"
                  autoFocus
                />
                <div className="absolute bottom-0 left-0 h-[2px] bg-brass w-0 transition-all duration-300 peer-focus:w-full" />
              </div>
              <div className="flex gap-4">
                <div className="relative w-full">
                  <input 
                    type="time" 
                    className="w-full bg-transparent border-b border-stone py-2 font-outfit text-warm-grey focus:outline-none peer"
                  />
                  <div className="absolute bottom-0 left-0 h-[2px] bg-brass w-0 transition-all duration-300 peer-focus:w-full" />
                </div>
                <div className="relative w-full">
                  <input 
                    type="date" 
                    className="w-full bg-transparent border-b border-stone py-2 font-outfit text-warm-grey focus:outline-none peer"
                  />
                  <div className="absolute bottom-0 left-0 h-[2px] bg-brass w-0 transition-all duration-300 peer-focus:w-full" />
                </div>
              </div>
            </div>
            <AnimatedButton 
              onClick={handleSaveEvent}
              className={isSuccess ? 'animate-bounce-success bg-green-600' : ''}
            >
              {isSuccess ? 'Saved ✓' : 'Save Event'}
            </AnimatedButton>
          </div>
        </BottomSheet>
      </div>
    </PageTransition>
  );
}
