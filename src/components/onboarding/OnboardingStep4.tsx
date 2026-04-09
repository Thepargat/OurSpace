import { useEffect, useState } from "react";
import { motion } from "motion/react";
import confetti from "canvas-confetti";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { useAuth } from "../AuthWrapper";

interface OnboardingStep4Props {
  onComplete: () => void;
}

const spring = { type: "spring" as const, stiffness: 280, damping: 22 };

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 48, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...spring, delay }
});

export default function OnboardingStep4({ onComplete }: OnboardingStep4Props) {
  const { user } = useAuth();
  const [partnerUser, setPartnerUser] = useState<{ photoURL: string; displayName: string } | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<{ photoURL: string; displayName: string } | null>(null);

  useEffect(() => {
    // Fetch user profiles
    const fetchProfiles = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setCurrentUserProfile({
            photoURL: userData.photoURL || user.photoURL || `https://ui-avatars.com/api/?name=${userData.displayName || 'Me'}&background=B8955A&color=fff`,
            displayName: userData.displayName || "Me"
          });

          const householdId = userData.householdId;
          if (householdId) {
            const q = query(
              collection(db, "users"),
              where("householdId", "==", householdId),
              where("uid", "!=", user.uid)
            );
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
              const pData = querySnapshot.docs[0].data();
              setPartnerUser({
                photoURL: pData.photoURL || `https://ui-avatars.com/api/?name=${pData.displayName || 'Partner'}&background=D4CEC4&color=1A1A1A`,
                displayName: pData.displayName || "Partner"
              });
            }
          }
        }
      } catch (err) {
        console.error("Error fetching profiles:", err);
      }
    };

    fetchProfiles();

    // Fire confetti burst after 400ms
    const timer = setTimeout(() => {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.5 },
        colors: ["#B8955A", "#F0E4CC", "#1A1A1A", "#EDE8DF"],
        gravity: 0.8,
        scalar: 0.9
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [user]);

  const goToDashboard = () => {
    // Clear onboarding flow from history and navigate
    onComplete();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: "100%" }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      style={{
        minHeight: "100dvh",
        background: "#F8F4EE",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 32px",
        textAlign: "center"
      }}
    >
      {/* Celebration icon instead of Lottie */}
      <motion.div {...fadeUp(0)} style={{ width: "200px", height: "100px", margin: "0 auto 32px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "64px" }}>
        ✨
      </motion.div>

      {/* Text content */}
      <motion.p {...fadeUp(0.1)} style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: "13px",
        letterSpacing: "2px",
        textTransform: "uppercase",
        color: "#B8955A",
        margin: "0 0 16px"
      }}>
        You're all set
      </motion.p>

      <motion.h1 {...fadeUp(0.2)} style={{
        fontFamily: "'Fraunces', serif",
        fontSize: "clamp(36px, 10vw, 52px)",
        fontWeight: 300,
        lineHeight: 1.1,
        color: "#1A1A1A",
        margin: "0 0 16px",
        letterSpacing: "-1.5px"
      }}>
        Your space<br/>is ready
      </motion.h1>

      <motion.p {...fadeUp(0.3)} style={{
        fontFamily: "'Outfit', sans-serif",
        fontSize: "16px",
        color: "#6B6560",
        margin: "0 0 56px",
        lineHeight: 1.6,
        maxWidth: "260px"
      }}>
        Everything is set up and waiting for you both.
      </motion.p>

      {/* Two partner avatars side by side */}
      <motion.div
        {...fadeUp(0.35)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0px",
          margin: "0 auto 48px",
          position: "relative",
          width: "fit-content"
        }}
      >
        {/* Your avatar */}
        <img
          src={currentUserProfile?.photoURL || user?.photoURL || ""}
          referrerPolicy="no-referrer"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: "3px solid #F8F4EE",
            position: "relative",
            zIndex: 2,
            objectFit: "cover"
          }}
        />
        {/* Brass link dot between avatars */}
        <div style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          background: "#B8955A",
          margin: "0 -2px",
          zIndex: 3,
          position: "relative"
        }} />
        {/* Partner avatar */}
        <img
          src={partnerUser?.photoURL || `https://ui-avatars.com/api/?name=Partner&background=D4CEC4&color=1A1A1A`}
          referrerPolicy="no-referrer"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            border: "3px solid #F8F4EE",
            position: "relative",
            zIndex: 2,
            objectFit: "cover"
          }}
        />
      </motion.div>

      {/* Open OurSpace button */}
      <motion.button
        {...fadeUp(0.45)}
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={goToDashboard}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        style={{
          width: "100%",
          maxWidth: "320px",
          height: "56px",
          background: "#1A1A1A",
          border: "none",
          borderRadius: "999px",
          fontFamily: "'Outfit', sans-serif",
          fontSize: "16px",
          fontWeight: 500,
          color: "#FFFFFF",
          cursor: "pointer",
          boxShadow: "0 8px 32px rgba(26,26,26,0.15)"
        }}
      >
        Open OurSpace ✦
      </motion.button>

      {/* Progress dots — all 4 active in brass */}
      <motion.div {...fadeUp(0.5)} style={{ display: "flex", gap: "8px", marginTop: "40px" }}>
        {[0, 1, 2, 3].map(i => (
          <motion.div
            key={i}
            initial={{ width: "8px", background: "#D4CEC4" }}
            animate={{ width: "24px", background: "#B8955A" }}
            transition={{ ...spring, delay: 0.5 + i * 0.08 }}
            style={{ height: "8px", borderRadius: "999px" }}
          />
        ))}
      </motion.div>
    </motion.div>
  );
}
