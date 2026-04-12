import { motion } from "motion/react";

interface OnboardingStep1Props {
  onNext: () => void;
}

const spring = { type: "spring" as const, stiffness: 280, damping: 22 }
const springBouncy = { type: "spring" as const, stiffness: 400, damping: 18 }

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 48, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...spring, delay }
})

export default function OnboardingStep1({ onNext }: OnboardingStep1Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, x: -40 }}
      transition={spring}
      style={{
        minHeight: "100dvh",
        background: "#fcf9f4",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px 32px 60px",
      }}
    >
      {/* Top section — text content */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <motion.p
          {...fadeUp(0)}
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: "13px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "#B8955A",
            margin: "0 0 20px"
          }}
        >
          Welcome
        </motion.p>

        <motion.h1
          {...fadeUp(0.1)}
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: "52px",
            fontWeight: 300,
            lineHeight: 1.1,
            color: "#1A1A1A",
            margin: "0 0 24px",
            letterSpacing: "-1.5px"
          }}
        >
          Your private<br/>space together
        </motion.h1>

        <motion.p
          {...fadeUp(0.2)}
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: "16px",
            lineHeight: 1.6,
            color: "#6B6560",
            margin: 0,
            maxWidth: "280px"
          }}
        >
          Everything you need to run your life together — beautifully.
        </motion.p>
      </div>

      {/* Bottom section — progress dots + button */}
      <motion.div
        {...fadeUp(0.3)}
        style={{ display: "flex", flexDirection: "column", gap: "32px" }}
      >
        {/* Progress dots — 4 total, first one active */}
        <div style={{ display: "flex", gap: "8px" }}>
          {[0, 1, 2, 3].map((i) => (
            <motion.div
              key={i}
              animate={{
                width: i === 0 ? "24px" : "8px",
                background: i === 0 ? "#B8955A" : "#D4CEC4",
              }}
              style={{ height: "8px", borderRadius: "999px" }}
              transition={spring}
            />
          ))}
        </div>

        {/* Continue button */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={onNext}
          transition={springBouncy}
          style={{
            width: "100%",
            height: "56px",
            background: "#1A1A1A",
            border: "none",
            borderRadius: "999px",
            fontFamily: "'Outfit', sans-serif",
            fontSize: "16px",
            fontWeight: 500,
            color: "#FFFFFF",
            cursor: "pointer",
            boxShadow: "0 8px 32px rgba(26,26,26,0.15)",
          }}
        >
          Let's go →
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
