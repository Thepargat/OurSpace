import { useState, useEffect } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';
import { Plus } from 'lucide-react';
import PageTransition from '../ui/PageTransition';
import BottomSheet from '../ui/BottomSheet';
import AnimatedButton from '../ui/AnimatedButton';

function CountUp({ to, duration = 1.4 }: { to: number, duration?: number }) {
  const spring = useSpring(0, { duration: duration * 1000, bounce: 0 });
  const display = useTransform(spring, (current) => `$${Math.round(current).toLocaleString()}`);

  useEffect(() => {
    spring.set(to);
  }, [spring, to]);

  return <motion.span>{display}</motion.span>;
}

export default function FinancesTab() {
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const totalSpend = 4250;

  const categories = [
    { name: 'Housing', amount: 2000, color: '#B8955A' },
    { name: 'Food', amount: 800, color: '#6B6560' },
    { name: 'Transport', amount: 400, color: '#D4CEC4' },
    { name: 'Entertainment', amount: 1050, color: '#1A1A1A' },
  ];

  // Calculate SVG stroke dashes for donut
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  let currentOffset = 0;

  return (
    <PageTransition>
      <div className="flex h-full flex-col px-6 pt-16 pb-32 overflow-y-auto bg-texture-1">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-serif text-4xl font-light text-charcoal">Finances</h1>
          <button 
            onClick={() => setIsAddSheetOpen(true)}
            className="w-10 h-10 rounded-full bg-brass text-white flex items-center justify-center shadow-md"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Donut Chart */}
        <div className="relative flex justify-center items-center mb-12">
          <svg width="240" height="240" viewBox="0 0 200 200" className="transform -rotate-90">
            {categories.map((cat, i) => {
              const strokeLength = (cat.amount / totalSpend) * circumference;
              const offset = currentOffset;
              currentOffset += strokeLength;

              return (
                <motion.circle
                  key={cat.name}
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="transparent"
                  stroke={cat.color}
                  strokeWidth="20"
                  strokeDasharray={`${strokeLength} ${circumference}`}
                  strokeDashoffset={-offset}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.4, ease: "easeOut", delay: i * 0.1 }}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-warm-grey text-sm font-outfit uppercase tracking-widest mb-1">Total Spend</span>
            <span className="font-serif text-[42px] leading-none text-charcoal">
              <CountUp to={totalSpend} />
            </span>
          </div>
        </div>

        {/* Categories Horizontal Scroll */}
        <div className="flex overflow-x-auto gap-4 pb-4 -mx-6 px-6 snap-x hide-scrollbar">
          {categories.map((cat, i) => (
            <motion.div 
              key={cat.name}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.1 }}
              className="min-w-[140px] bg-parchment rounded-2xl p-4 border border-stone snap-start"
            >
              <div className="w-3 h-3 rounded-full mb-3" style={{ backgroundColor: cat.color }} />
              <h3 className="font-outfit text-warm-grey text-sm mb-1">{cat.name}</h3>
              <p className="font-serif text-xl text-charcoal">${cat.amount.toLocaleString()}</p>
            </motion.div>
          ))}
        </div>

        {/* Savings Goals */}
        <div className="mt-12">
          <h2 className="font-serif text-2xl text-charcoal mb-6">Savings Goals</h2>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-end mb-2">
                <h3 className="font-outfit text-lg text-charcoal">Japan Trip</h3>
                <span className="font-serif text-warm-grey"><CountUp to={4500} duration={2} /> / $8,000</span>
              </div>
              <div className="h-3 w-full bg-stone/30 rounded-full overflow-hidden relative">
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-brass rounded-full"
                  initial={{ width: 0 }}
                  whileInView={{ width: '56%' }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                >
                  <motion.div 
                    className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  />
                </motion.div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-end mb-2">
                <h3 className="font-outfit text-lg text-charcoal">Emergency Fund</h3>
                <span className="font-serif text-warm-grey"><CountUp to={12000} duration={2} /> / $20,000</span>
              </div>
              <div className="h-3 w-full bg-stone/30 rounded-full overflow-hidden relative">
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-charcoal rounded-full"
                  initial={{ width: 0 }}
                  whileInView={{ width: '60%' }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Monthly Summary */}
        <div className="mt-12">
          <h2 className="font-serif text-2xl text-charcoal mb-6">Monthly Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-parchment rounded-2xl p-4 border border-stone"
            >
              <h3 className="font-outfit text-warm-grey text-sm mb-2">Income</h3>
              <p className="font-serif text-2xl text-charcoal text-green-600">
                +<CountUp to={6200} duration={1.5} />
              </p>
            </motion.div>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-parchment rounded-2xl p-4 border border-stone"
            >
              <h3 className="font-outfit text-warm-grey text-sm mb-2">Expenses</h3>
              <p className="font-serif text-2xl text-charcoal">
                -<CountUp to={4250} duration={1.5} />
              </p>
            </motion.div>
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-parchment rounded-2xl p-4 border border-stone col-span-2 flex justify-between items-center"
            >
              <h3 className="font-outfit text-warm-grey text-sm">Net Savings</h3>
              <p className="font-serif text-2xl text-charcoal">
                $<CountUp to={1950} duration={1.5} />
              </p>
            </motion.div>
          </div>
        </div>

        {/* Add Expense Bottom Sheet */}
        <BottomSheet isOpen={isAddSheetOpen} onClose={() => setIsAddSheetOpen(false)}>
          <div className="pb-8 pt-2">
            <h2 className="font-serif text-2xl text-charcoal mb-6">Add Expense</h2>
            <div className="space-y-6 mb-8">
              <div className="relative">
                <input 
                  type="number" 
                  placeholder="Amount" 
                  className="w-full bg-transparent border-b border-stone py-2 font-serif text-3xl text-charcoal focus:outline-none peer"
                  autoFocus
                />
                <div className="absolute bottom-0 left-0 h-[2px] bg-brass w-0 transition-all duration-300 peer-focus:w-full" />
              </div>
              <div className="relative">
                <input 
                  type="text" 
                  placeholder="Category" 
                  className="w-full bg-transparent border-b border-stone py-2 font-outfit text-lg text-charcoal focus:outline-none peer"
                />
                <div className="absolute bottom-0 left-0 h-[2px] bg-brass w-0 transition-all duration-300 peer-focus:w-full" />
              </div>
            </div>
            <AnimatedButton onClick={() => setIsAddSheetOpen(false)}>
              Save Expense
            </AnimatedButton>
          </div>
        </BottomSheet>
      </div>
    </PageTransition>
  );
}
