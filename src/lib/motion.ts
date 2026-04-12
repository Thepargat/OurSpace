/**
 * OurSpace — Animation Constants + Hooks
 * Global motion system. Import from here everywhere.
 */

import { useEffect, useRef, useState } from 'react';

// ============================================================
// SPRING CONFIGS
// ============================================================
export const SPRING_DEFAULT = { type: 'spring' as const, stiffness: 280, damping: 22 };
export const SPRING_BOUNCY  = { type: 'spring' as const, stiffness: 400, damping: 20 };
export const SPRING_GENTLE  = { type: 'spring' as const, stiffness: 180, damping: 24 };
export const SPRING_SNAPPY  = { type: 'spring' as const, stiffness: 500, damping: 28 };

export const EASE_OUT    = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.42, 0, 0.58, 1] as const;

// ============================================================
// STANDARD REVEAL (single element)
// ============================================================
export const fadeReveal = (delay = 0) => ({
  initial: { opacity: 0, y: 24, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: 0.65, ease: [...EASE_OUT], delay },
});

// ============================================================
// STAGGER CONTAINER + ITEM (for lists)
// ============================================================
export const staggerContainer = (stagger = 0.07, delayChildren = 0) => ({
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: stagger, delayChildren },
  },
});

export const staggerItem = {
  hidden: { opacity: 0, y: 20, filter: 'blur(4px)' },
  show:   { opacity: 1, y: 0,  filter: 'blur(0px)',
    transition: { duration: 0.55, ease: [...EASE_OUT] } },
};

// ============================================================
// PAGE TRANSITION (wrap every screen's root div)
// ============================================================
export const pageEnter = {
  initial:   { opacity: 0, scale: 1.02, filter: 'blur(6px)' },
  animate:   { opacity: 1, scale: 1,    filter: 'blur(0px)' },
  exit:      { opacity: 0, scale: 0.97, filter: 'blur(8px)' },
  transition: { duration: 0.42, ease: [...EASE_OUT] },
};

// ============================================================
// CARD HOVER / TAP INTERACTIONS
// ============================================================
export const cardTap = {
  whileTap: { scale: 0.97 },
  transition: SPRING_BOUNCY,
};

// ============================================================
// BOTTOM SHEET
// ============================================================
export const sheetVariants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: SPRING_DEFAULT },
  exit: { y: '100%', transition: { duration: 0.25, ease: [...EASE_IN_OUT] } },
};

// ============================================================
// FAB BUTTON
// ============================================================
export const fabVariants = {
  hidden:  { scale: 0, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { ...SPRING_BOUNCY, delay: 0.4 } },
};

// ============================================================
// useCountUp HOOK
// ============================================================
export function useCountUp(
  target: number,
  options: {
    duration?: number;
    delay?: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    enabled?: boolean;
  } = {}
): string {
  const { duration = 1800, delay = 0, prefix = '', suffix = '', decimals = 2, enabled = true } = options;
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled || target === 0) {
      const waitTick = setTimeout(() => setValue(target), 0);
      return () => clearTimeout(waitTick);
    }

    // Check reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp;
        const elapsed = timestamp - startTime.current;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(target * eased);

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          setValue(target);
        }
      };
      startTime.current = null;
      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, delay, enabled]);

  const formatted = value.toFixed(decimals);
  return `${prefix}${formatted}${suffix}`;
}

// ============================================================
// useCurrencyCountUp — convenience for AUD
// ============================================================
export function useCurrencyCountUp(
  target: number,
  delay = 0,
  enabled = true
): string {
  const raw = useCountUp(target, { duration: 1400, delay, decimals: 2, enabled });
  // Format as AUD
  const num = parseFloat(raw);
  return isNaN(num) ? '$0.00' : num.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

// ============================================================
// CELEBRATION — confetti burst
// ============================================================
export const fireCelebration = async (
  origin: { x: number; y: number } = { x: 0.5, y: 0.5 }
) => {
  // Check reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const confetti = (await import('canvas-confetti')).default;
  confetti({
    particleCount: 120,
    spread: 80,
    origin,
    colors: ['#B8955A', '#F0E4CC', '#C47B6A', '#EDE8DF', '#1A1A1A'],
    gravity: 1.1,
    scalar: 0.85,
    ticks: 200,
  });
};

// ============================================================
// BACKWARD-COMPAT EXPORTS (used by existing UI components)
// ============================================================
export const springs = {
  default: SPRING_DEFAULT,
  bouncy:  SPRING_BOUNCY,
  gentle:  SPRING_GENTLE,
  snappy:  SPRING_SNAPPY,
  soft:    SPRING_GENTLE, // alias
};

export const pageVariants = {
  initial: { opacity: 0, scale: 1.02, filter: 'blur(6px)' },
  animate: { opacity: 1, scale: 1,    filter: 'blur(0px)' },
  exit:    { opacity: 0, scale: 0.97, filter: 'blur(8px)' },
};

// ============================================================
// HAPTIC FEEDBACK
// ============================================================
export const haptic = {
  light:   () => { try { navigator.vibrate?.(10); } catch { /* noop */ } },
  success: () => { try { navigator.vibrate?.([10, 5, 20]); } catch { /* noop */ } },
  error:   () => { try { navigator.vibrate?.([30, 10, 30]); } catch { /* noop */ } },
  heavy:   () => { try { navigator.vibrate?.(50); } catch { /* noop */ } },
};
