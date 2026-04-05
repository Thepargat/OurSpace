import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  doc, 
  setDoc, 
  getDoc,
  onSnapshot, 
  collection, 
  query, 
  where, 
  getDocs, 
  updateDoc, 
  arrayUnion,
  serverTimestamp,
  deleteDoc
} from "firebase/firestore";
import { db, auth } from "../../firebase";
import { useAuth } from "../AuthWrapper";

interface OnboardingStep3Props {
  onNext: () => void;
}

const spring = { type: "spring" as const, stiffness: 280, damping: 22 };

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 48, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...spring, delay }
});

export default function OnboardingStep3({ onNext }: OnboardingStep3Props) {
  const { user } = useAuth();
  const [selectedMode, setSelectedMode] = useState<"create" | "join" | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Generate code and setup household for CREATE mode
  useEffect(() => {
    if (selectedMode === "create" && !inviteCode && user) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setInviteCode(code);

      const setupHousehold = async () => {
        const householdId = `h_${user.uid}_${Date.now()}`;
        
        // 1. Create household
        await setDoc(doc(db, "households", householdId), {
          id: householdId,
          memberIds: [user.uid],
          createdAt: serverTimestamp(),
          createdBy: user.uid
        });

        // 2. Create invite code mapping
        await setDoc(doc(db, "inviteCodes", code), {
          code,
          householdId,
          createdBy: user.uid,
          createdAt: serverTimestamp()
        });

        // 3. Update current user's householdId
        await updateDoc(doc(db, "users", user.uid), {
          householdId: householdId
        });
      };

      setupHousehold();
    }
  }, [selectedMode, user, inviteCode]);

  // Listen for partner joining in CREATE mode
  useEffect(() => {
    if (selectedMode === "create" && inviteCode && user) {
      // Let's find the householdId we just created
      const findAndListen = async () => {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const householdId = userDoc.data()?.householdId;
          
          if (householdId) {
            return onSnapshot(doc(db, "households", householdId), (snapshot) => {
              const data = snapshot.data();
              if (data && data.memberIds.length > 1) {
                // Partner joined!
                onNext();
              }
            }, (err) => {
              console.error("Error listening to household:", err);
            });
          }
        } catch (err) {
          console.error("Error in findAndListen:", err);
        }
      };

      let unsubscribe: any;
      findAndListen().then(unsub => unsubscribe = unsub);
      return () => unsubscribe?.();
    }
  }, [selectedMode, inviteCode, user, onNext]);

  const handleJoinCodeChange = (index: number, value: string) => {
    if (value.length > 1) value = value[0];
    if (!/^\d*$/.test(value)) return;

    const newCode = [...joinCode];
    newCode[index] = value;
    setJoinCode(newCode);
    setError("");

    // Auto-focus next
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !joinCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleJoin = async () => {
    const code = joinCode.join("");
    if (code.length !== 6 || !user) return;

    setIsJoining(true);
    setError("");

    try {
      const codeDoc = await getDoc(doc(db, "inviteCodes", code));
      
      if (!codeDoc.exists()) {
        throw new Error("Invalid invite code");
      }

      const inviteData = codeDoc.data();
      const householdId = inviteData.householdId;

      // Add user to household
      await updateDoc(doc(db, "households", householdId), {
        memberIds: arrayUnion(user.uid)
      });

      // Update user's householdId
      await updateDoc(doc(db, "users", user.uid), {
        householdId: householdId
      });

      // Delete invite code (one-time use)
      await deleteDoc(doc(db, "inviteCodes", code));

      onNext();
    } catch (err: any) {
      setError(err.message || "Something went wrong");
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    } finally {
      setIsJoining(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode);
  };

  const shareWhatsApp = () => {
    const text = `Join me on OurSpace! Use my invite code: ${inviteCode}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleSkip = async () => {
    if (!user) return;
    const householdId = `test_h_${user.uid}`;
    try {
      await setDoc(doc(db, "households", householdId), {
        id: householdId,
        memberIds: [user.uid],
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        isTest: true
      });
      await updateDoc(doc(db, "users", user.uid), {
        householdId: householdId
      });
      onNext();
    } catch (err) {
      console.error("Error skipping:", err);
      onNext(); // Proceed anyway
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
        padding: "80px 32px 60px"
      }}
    >
      <div>
        <motion.p {...fadeUp(0)} style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: "13px",
          letterSpacing: "2px",
          textTransform: "uppercase",
          color: "#B8955A",
          margin: "0 0 20px"
        }}>
          Step 3 of 4
        </motion.p>

        <motion.h1 {...fadeUp(0.1)} style={{
          fontFamily: "'Fraunces', serif",
          fontSize: "clamp(36px, 10vw, 52px)",
          fontWeight: 300,
          lineHeight: 1.1,
          color: "#1A1A1A",
          margin: "0 0 16px",
          letterSpacing: "-1.5px"
        }}>
          Link your<br/>partner
        </motion.h1>

        <motion.p {...fadeUp(0.2)} style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: "16px",
          color: "#6B6560",
          margin: "0 0 40px",
          lineHeight: 1.6
        }}>
          Choose how you want to connect
        </motion.p>

        {/* Option cards */}
        <motion.div {...fadeUp(0.3)} style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}>
          {/* Card 1 — Create household */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setSelectedMode("create")}
            style={{
              background: selectedMode === "create" ? "#1A1A1A" : "#EDE8DF",
              border: "1px solid #D4CEC4",
              borderRadius: "20px",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              transition: "background 0.3s ease"
            }}
          >
            <p style={{
              fontFamily: "'Fraunces', serif",
              fontSize: "20px",
              fontWeight: 400,
              color: selectedMode === "create" ? "#FFFFFF" : "#1A1A1A",
              margin: "0 0 6px"
            }}>
              Invite my partner
            </p>
            <p style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: "14px",
              color: selectedMode === "create" ? "#D4CEC4" : "#6B6560",
              margin: 0
            }}>
              Generate a code and share it
            </p>
          </motion.button>

          {/* Card 2 — Join household */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setSelectedMode("join")}
            style={{
              background: selectedMode === "join" ? "#1A1A1A" : "#EDE8DF",
              border: "1px solid #D4CEC4",
              borderRadius: "20px",
              padding: "24px",
              textAlign: "left",
              cursor: "pointer",
              transition: "background 0.3s ease"
            }}
          >
            <p style={{
              fontFamily: "'Fraunces', serif",
              fontSize: "20px",
              fontWeight: 400,
              color: selectedMode === "join" ? "#FFFFFF" : "#1A1A1A",
              margin: "0 0 6px"
            }}>
              I have a code
            </p>
            <p style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: "14px",
              color: selectedMode === "join" ? "#D4CEC4" : "#6B6560",
              margin: 0
            }}>
              Enter a code from your partner
            </p>
          </motion.button>
        </motion.div>

        {/* Skip for now option */}
        <motion.div {...fadeUp(0.35)} style={{ marginTop: "24px", textAlign: "center" }}>
          <button
            onClick={handleSkip}
            style={{
              background: "none",
              border: "none",
              fontFamily: "'Outfit', sans-serif",
              fontSize: "14px",
              color: "#B8955A",
              textDecoration: "underline",
              cursor: "pointer",
              opacity: 0.8
            }}
          >
            Skip for now (Testing)
          </button>
        </motion.div>

        <AnimatePresence mode="wait">
          {selectedMode === "create" && (
            <motion.div
              key="create-ui"
              initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -16 }}
              transition={spring}
              style={{
                marginTop: "24px",
                background: "#EDE8DF",
                border: "1px solid #D4CEC4",
                borderRadius: "20px",
                padding: "24px",
                textAlign: "center"
              }}
            >
              <p style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: "13px",
                letterSpacing: "2px",
                textTransform: "uppercase",
                color: "#B8955A",
                margin: "0 0 12px"
              }}>
                Your invite code
              </p>
              <p style={{
                fontFamily: "'Fraunces', serif",
                fontSize: "48px",
                fontWeight: 400,
                color: "#1A1A1A",
                letterSpacing: "8px",
                margin: "0 0 16px"
              }}>
                {inviteCode}
              </p>
              <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={copyCode}
                  style={{
                    background: "#1A1A1A",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "999px",
                    padding: "12px 28px",
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: "14px",
                    cursor: "pointer"
                  }}
                >
                  Copy code
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={shareWhatsApp}
                  style={{
                    background: "#25D366",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "999px",
                    padding: "12px 28px",
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: "14px",
                    cursor: "pointer"
                  }}
                >
                  Share on WhatsApp
                </motion.button>
              </div>
            </motion.div>
          )}

          {selectedMode === "join" && (
            <motion.div
              key="join-ui"
              initial={{ opacity: 0, y: 24, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -16 }}
              transition={spring}
              style={{ marginTop: "24px" }}
            >
              <p style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: "14px",
                color: "#6B6560",
                margin: "0 0 16px"
              }}>
                Enter the 6-digit code
              </p>
              <motion.div 
                animate={isShaking ? { x: [0, -8, 8, -6, 6, 0] } : {}}
                transition={{ duration: 0.4 }}
                style={{ display: "flex", gap: "10px", justifyContent: "center" }}
              >
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el; }}
                    maxLength={1}
                    inputMode="numeric"
                    value={joinCode[i]}
                    onChange={e => handleJoinCodeChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    style={{
                      width: "44px",
                      height: "56px",
                      textAlign: "center",
                      fontFamily: "'Fraunces', serif",
                      fontSize: "24px",
                      color: "#1A1A1A",
                      background: "#EDE8DF",
                      border: "1px solid #D4CEC4",
                      borderRadius: "12px",
                      outline: "none",
                      caretColor: "#B8955A"
                    }}
                  />
                ))}
              </motion.div>
              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    color: "#C97B6A",
                    fontSize: "14px",
                    fontFamily: "'Outfit', sans-serif",
                    textAlign: "center",
                    marginTop: "16px"
                  }}
                >
                  {error}
                </motion.p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom section — progress dots + button */}
      <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
        {/* Progress dots — 4 total, third one active */}
        <div style={{ display: "flex", gap: "8px" }}>
          {[0, 1, 2, 3].map(i => (
            <motion.div
              key={i}
              animate={{
                width: i === 2 ? "24px" : "8px",
                background: i === 2 ? "#B8955A" : "#D4CEC4"
              }}
              style={{ height: "8px", borderRadius: "999px" }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
            />
          ))}
        </div>

        {/* Continue button */}
        <AnimatePresence>
          {selectedMode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              {selectedMode === "create" ? (
                <motion.button
                  disabled
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
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
                    cursor: "default"
                  }}
                >
                  Waiting for partner...
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  whileHover={joinCode.every(d => d !== "") ? { scale: 1.02 } : {}}
                  onClick={handleJoin}
                  disabled={isJoining || !joinCode.every(d => d !== "")}
                  style={{
                    width: "100%",
                    height: "56px",
                    background: joinCode.every(d => d !== "") ? "#1A1A1A" : "#D4CEC4",
                    border: "none",
                    borderRadius: "999px",
                    fontFamily: "'Outfit', sans-serif",
                    fontSize: "16px",
                    fontWeight: 500,
                    color: "#FFFFFF",
                    cursor: joinCode.every(d => d !== "") ? "pointer" : "default",
                    boxShadow: "0 8px 32px rgba(26,26,26,0.15)"
                  }}
                >
                  {isJoining ? "Joining..." : "Join household"}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
