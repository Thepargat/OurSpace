import { useState } from "react";
import { motion } from "motion/react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../../firebase";

interface OnboardingStep2Props {
  onNext: () => void;
}

const spring = { type: "spring" as const, stiffness: 280, damping: 22 }
const springBouncy = { type: "spring" as const, stiffness: 400, damping: 18 }

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 48, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...spring, delay }
})

export default function OnboardingStep2({ onNext }: OnboardingStep2Props) {
  const [name, setName] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleContinue = async () => {
    if (!name.trim() || !auth.currentUser) return;
    
    setIsSaving(true);
    try {
      // Use setDoc with merge: true to create the document if it doesn't exist
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        displayName: name.trim(),
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      onNext();
    } catch (error) {
      console.error("Error saving name:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: "100%" }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: "-40px" }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      style={{
        minHeight: "100dvh",
        background: "#F8F4EE",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px 32px 60px",
      }}
    >
      <div>
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
          Step 2 of 4
        </motion.p>

        <motion.h1
          {...fadeUp(0.1)}
          style={{
            fontFamily: "'Fraunces', serif",
            fontSize: "52px",
            fontWeight: 300,
            lineHeight: 1.1,
            color: "#1A1A1A",
            margin: "0 0 40px",
            letterSpacing: "-1.5px"
          }}
        >
          What's your<br/>name?
        </motion.h1>

        {/* Name input */}
        <motion.div
          {...fadeUp(0.2)}
          style={{ position: "relative" }}
        >
          <style>{`
            input::placeholder { color: #D4CEC4; opacity: 1; }
          `}</style>
          <input
            autoFocus
            type="text"
            placeholder="Your first name"
            value={name}
            onChange={e => setName(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              borderBottom: "2px solid #D4CEC4",
              outline: "none",
              fontFamily: "'Fraunces', serif",
              fontSize: "32px",
              fontWeight: 300,
              color: "#1A1A1A",
              padding: "8px 0 16px",
              caretColor: "#B8955A",
            }}
          />
          {/* Brass underline animates in on focus */}
          <motion.div
            animate={{ scaleX: isFocused ? 1 : 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{
              height: "2px",
              background: "#B8955A",
              transformOrigin: "left",
              marginTop: "-2px"
            }}
          />
        </motion.div>
      </div>

      {/* Bottom section — progress dots + button */}
      <motion.div
        {...fadeUp(0.3)}
        style={{ display: "flex", flexDirection: "column", gap: "32px" }}
      >
        {/* Progress dots — 4 total, second one active */}
        <div style={{ display: "flex", gap: "8px" }}>
          {[0, 1, 2, 3].map((i) => (
            <motion.div
              key={i}
              animate={{
                width: i === 1 ? "24px" : "8px",
                background: i === 1 ? "#B8955A" : "#D4CEC4",
              }}
              style={{ height: "8px", borderRadius: "999px" }}
              transition={spring}
            />
          ))}
        </div>

        {/* Continue button */}
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={name.trim().length > 0 ? { scale: 1.02 } : {}}
          onClick={handleContinue}
          disabled={isSaving || name.trim().length === 0}
          transition={springBouncy}
          style={{
            width: "100%",
            height: "56px",
            background: name.trim().length > 0 ? "#1A1A1A" : "#D4CEC4",
            border: "none",
            borderRadius: "999px",
            fontFamily: "'Outfit', sans-serif",
            fontSize: "16px",
            fontWeight: 500,
            color: name.trim().length > 0 ? "#FFFFFF" : "#6B6560",
            cursor: name.trim().length > 0 ? "pointer" : "default",
            boxShadow: "0 8px 32px rgba(26,26,26,0.15)",
            pointerEvents: name.trim().length > 0 ? "auto" : "none",
          }}
        >
          {isSaving ? "Saving..." : "Continue →"}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
