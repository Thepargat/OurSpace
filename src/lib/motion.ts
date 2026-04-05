import { type AnimationGeneratorType, type Easing } from "motion/react";

export const springs = {
  snappy: { type: "spring" as AnimationGeneratorType, stiffness: 300, damping: 24 },
  soft: { type: "spring" as AnimationGeneratorType, stiffness: 180, damping: 20 },
  bouncy: { type: "spring" as AnimationGeneratorType, stiffness: 400, damping: 18 },
};

export const pageVariants = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1, 
    transition: springs.soft 
  },
  exit: { 
    opacity: 0, 
    y: -16, 
    scale: 0.98, 
    transition: { duration: 0.22, ease: "easeOut" as Easing } 
  },
};

export const staggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 32 },
  show: { 
    opacity: 1, 
    y: 0, 
    transition: springs.soft 
  },
};
