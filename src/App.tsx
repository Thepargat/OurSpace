import { useState, useEffect } from "react";
import Lenis from 'lenis';
import { AnimatePresence, motion } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { X } from "lucide-react";
import { doc, setDoc, onSnapshot, getDocs, updateDoc, collection, query, where, Timestamp } from "firebase/firestore";
import { db, auth } from "./firebase";
import AuthWrapper, { useAuth } from "./components/AuthWrapper";
import { requestNotificationPermission, onForegroundMessage, notifyPartner, updateFCMToken } from "./services/notificationService";
import { format, addMinutes, isBefore, isAfter, parseISO } from "date-fns";
import NoiseOverlay from "./components/NoiseOverlay";
import BottomNav from "./components/BottomNav";
import Toast from "./components/ui/Toast";
import PageTransition from "./components/ui/PageTransition";
import ProgressBar from "./components/ui/ProgressBar";
import ReorderableList, { ReorderItemData } from "./components/ui/ReorderableList";
import SwipeableItem from "./components/ui/SwipeableItem";
import BottomSheet from "./components/ui/BottomSheet";
import AnimatedButton from "./components/ui/AnimatedButton";
import LaunchScreen from "./components/ui/LaunchScreen";
import OnlineParticles from "./components/3d/OnlineParticles";
import GroceryItem from "./components/ui/GroceryItem";
import { staggerContainer, staggerItem } from "./lib/motion";
import HomeTab from "./components/tabs/HomeTab";

import CalendarTab from "./components/tabs/CalendarTab";
import GroceryTab from "./components/tabs/GroceryTab";
import FinancesTab from "./components/tabs/FinancesTab";
import TogetherTab from "./components/tabs/TogetherTab";
import MoreTab from "./components/tabs/MoreTab";
import SharedNotesTab from "./components/tabs/SharedNotesTab";
import MealPlannerTab from "./components/tabs/MealPlannerTab";
import ChoresTab from "./components/tabs/ChoresTab";
import SettingsTab from "./components/tabs/SettingsTab";
import MoodHistoryTab from "./components/tabs/MoodHistoryTab";
import SubScreen from "./components/ui/SubScreen";
import OnboardingStep1 from "./components/onboarding/OnboardingStep1";
import OnboardingStep2 from "./components/onboarding/OnboardingStep2";
import OnboardingStep3 from "./components/onboarding/OnboardingStep3";
import OnboardingStep4 from "./components/onboarding/OnboardingStep4";

function MainApp() {
  const { hasHousehold, householdId, user } = useAuth();
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [activeTab, setActiveTab] = useState("home");
  const [subScreen, setSubScreen] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showLaunchScreen, setShowLaunchScreen] = useState(true);
  const [isAnniversary, setIsAnniversary] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<'online' | 'offline'>('offline');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [isFirstLoadOffline, setIsFirstLoadOffline] = useState(!navigator.onLine && !localStorage.getItem('ourspace_cached'));
  const [showNotificationCard, setShowNotificationCard] = useState(false);
  const [inAppNotification, setInAppNotification] = useState<{ title: string, body: string, data?: any } | null>(null);
  const [showIOSInstall, setShowIOSInstall] = useState(false);

  // Session Tracking
  useEffect(() => {
    const sessions = parseInt(localStorage.getItem('ourspace_sessions') || '0');
    const newSessions = sessions + 1;
    localStorage.setItem('ourspace_sessions', newSessions.toString());
    
    if (user) {
      updateFCMToken(user.uid);
    }
  }, [user]);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 2.0,
      infinite: false,
    })
    const raf = (time: number) => {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)
    return () => lenis.destroy()
  }, [])

  // Handle PWA Install Prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      
      const sessions = parseInt(localStorage.getItem('ourspace_sessions') || '0');
      const isDismissed = localStorage.getItem('ourspace_install_dismissed');
      
      // Show banner after 3 sessions if not dismissed
      if (!isDismissed && sessions >= 3) {
        setShowInstallBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    // iOS Detection
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone === true;
    const isIOSDismissed = localStorage.getItem('ourspace_ios_install_dismissed');
    const sessions = parseInt(localStorage.getItem('ourspace_sessions') || '0');

    if (isIOS && !isStandalone && !isIOSDismissed && sessions >= 3) {
      setShowIOSInstall(true);
    }

    window.addEventListener('appinstalled', () => {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
      localStorage.setItem('ourspace_install_dismissed', 'true');
    });

    const handleTriggerInstall = () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult: any) => {
          if (choiceResult.outcome === 'accepted') {
            // User accepted
          }
          setDeferredPrompt(null);
        });
      } else {
        setToastMsg("App is already installed or not supported on this browser.");
        setToastType('online');
        setShowToast(true);
      }
    };

    window.addEventListener('trigger-pwa-install', handleTriggerInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('trigger-pwa-install', handleTriggerInstall);
    };
  }, []);

  // Handle Notification Permission Card
  useEffect(() => {
    if (!hasHousehold) return;
    
    const sessions = parseInt(localStorage.getItem('ourspace_sessions') || '0');
    const isDismissed = localStorage.getItem('ourspace_notifications_dismissed');
    
    // Ask after onboarding AND at least 1 session
    if (isDismissed || Notification.permission === 'granted' || sessions < 2) return;

    const timer = setTimeout(() => {
      setShowNotificationCard(true);
    }, 60000); // 60 seconds

    return () => clearTimeout(timer);
  }, [hasHousehold]);

  // Handle Foreground Notifications
  useEffect(() => {
    onForegroundMessage((payload) => {
      if (payload.notification) {
        setInAppNotification({
          title: payload.notification.title || "",
          body: payload.notification.body || "",
          data: payload.data
        });
        setTimeout(() => setInAppNotification(null), 4000);
      }
    });
  }, []);

  // Event Reminder Checker
  useEffect(() => {
    if (!hasHousehold || !householdId || !user) return;

    const interval = setInterval(async () => {
      const now = new Date();
      const fifteenMinsFromNow = addMinutes(now, 15);
      
      const q = query(
        collection(db, "households", householdId, "events"),
        where("startTime", ">=", now.toISOString()),
        where("startTime", "<=", fifteenMinsFromNow.toISOString())
      );

      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(async (d) => {
        const event = d.data();
        if (!event.reminderSent) {
          await updateDoc(doc(db, "households", householdId, "events", d.id), {
            reminderSent: true
          });

          notifyPartner(
            householdId,
            user.uid,
            "Event Reminder",
            `${event.title} is starting in 15 minutes`,
            "calendar"
          );
        }
      }));
    }, 60000); // Check every minute

    // Chore Overdue Checker
    const choreInterval = setInterval(async () => {
      const now = new Date();
      
      const q = query(
        collection(db, "households", householdId, "chores"),
        where("completed", "==", false),
        where("dueDate", "<", Timestamp.fromDate(now))
      );

      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(async (d) => {
        const chore = d.data();
        if (!chore.overdueNotified) {
          await updateDoc(doc(db, "households", householdId, "chores", d.id), {
            overdueNotified: true
          });

          notifyPartner(
            householdId,
            user.uid,
            "Chores",
            `${chore.title} is overdue`,
            "chores"
          );
        }
      }));
    }, 3600000); // Check every hour

    return () => {
      clearInterval(interval);
      clearInterval(choreInterval);
    };
  }, [hasHousehold, householdId, user]);

  // Check for anniversary (e.g., April 5th)
  useEffect(() => {
    const today = new Date();
    if (today.getMonth() === 3 && today.getDate() === 5) { // 0-indexed month
      setIsAnniversary(true);
    }
    
    const handleOnline = () => {
      setIsOffline(false);
      setToastMsg("Back online ✓");
      setToastType('online');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    };
    
    const handleOffline = () => {
      setIsOffline(true);
      setToastMsg("You're offline — showing saved data");
      setToastType('offline');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Mark as cached once loaded
    if (navigator.onLine) {
      localStorage.setItem('ourspace_cached', 'true');
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isFirstLoadOffline]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
    }
  };

  const dismissInstall = () => {
    setShowInstallBanner(false);
    localStorage.setItem('ourspace_install_dismissed', 'true');
  };

  const dismissIOSInstall = () => {
    setShowIOSInstall(false);
    localStorage.setItem('ourspace_ios_install_dismissed', 'true');
  };

  const handleEnableNotifications = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    
    const token = await requestNotificationPermission(currentUser.uid);
    if (token) {
      setShowNotificationCard(false);
    } else if (Notification.permission === 'denied') {
      setShowNotificationCard(false);
      localStorage.setItem('ourspace_notifications_dismissed', 'true');
    }
  };

  const dismissNotifications = () => {
    setShowNotificationCard(false);
    localStorage.setItem('ourspace_notifications_dismissed', 'true');
  };

  // iOS-style swipe-right-from-edge to navigate back
  const bind = useDrag(({ active, movement: [mx], direction: [dx], cancel }) => {
    if (active && mx > 100 && dx > 0 && activeTab !== 'home') {
      setActiveTab('home');
      cancel();
    }
  }, {
    axis: 'x',
    bounds: { left: 0 },
    from: () => [0, 0],
    filterTaps: true,
  });

  // Simulate loading on tab change
  useEffect(() => {
    if (showLaunchScreen) return;
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, [activeTab, showLaunchScreen]);

  useEffect(() => {
    const themeColor = activeTab === 'home' ? '#F8F4EE' : '#F8F4EE'; // Could vary by tab
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }, [activeTab]);

  const renderContent = () => {
    if (subScreen) {
      switch (subScreen) {
        case 'grocery': return <GroceryTab key="grocery" onBack={() => setSubScreen(null)} />;
        case 'meal-planner': return <MealPlannerTab key="meal-planner" onBack={() => setSubScreen(null)} />;
        case 'chores': return <ChoresTab key="chores" onBack={() => setSubScreen(null)} />;
        case 'notes': return <SharedNotesTab key="notes" onBack={() => setSubScreen(null)} />;
        case 'savings': return <SubScreen key="savings" title="Savings Goals" onBack={() => setSubScreen(null)} />;
        case 'mood-history': return <MoodHistoryTab key="mood-history" onBack={() => setSubScreen(null)} />;
        case 'settings': return <SettingsTab key="settings" onBack={() => setSubScreen(null)} />;
        default: return null;
      }
    }

    switch (activeTab) {
      case "home": return <HomeTab key="home" isAnniversary={isAnniversary} onNavigate={setActiveTab} />;
      case "calendar": return <CalendarTab key="calendar" />;
      case "finances": return <FinancesTab key="finances" />;
      case "together": return <TogetherTab key="together" />;
      case "more": return <MoreTab key="more" onNavigate={setSubScreen} />;
      default: return <HomeTab key="home" isAnniversary={isAnniversary} onNavigate={setActiveTab} />;
    }
  };

  if (!hasHousehold) {
    return (
      <AnimatePresence mode="wait">
        {onboardingStep === 1 && (
          <OnboardingStep1 key="step1" onNext={() => setOnboardingStep(2)} />
        )}
        {onboardingStep === 2 && (
          <OnboardingStep2 key="step2" onNext={() => setOnboardingStep(3)} />
        )}
        {onboardingStep === 3 && (
          <OnboardingStep3 key="step3" onNext={() => setOnboardingStep(4)} />
        )}
        {onboardingStep === 4 && (
          <OnboardingStep4 key="step4" onComplete={() => {
            // AuthWrapper listener will pick up the householdId change
            // and hasHousehold will become true automatically.
          }} />
        )}
      </AnimatePresence>
    );
  }

  const isSubScreen = !!subScreen;

  return (
    <>
      {isFirstLoadOffline && (
        <div className="fixed inset-0 z-[20000] bg-[#F8F4EE] flex flex-col items-center justify-center text-center px-8">
          <div className="w-20 h-20 bg-[#B8955A] rounded-[24px] flex items-center justify-center mb-8 shadow-xl">
            <span className="font-serif text-white text-3xl font-bold">OS</span>
          </div>
          <h1 className="font-serif text-[28px] text-[#1A1A1A] mb-2">You're offline</h1>
          <p className="font-outfit text-[14px] text-[#6B6560] mb-8">Your data will sync when you reconnect</p>
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-2 h-2 bg-[#B8955A] rounded-full"
          />
        </div>
      )}

      {/* Android/Chrome Install Banner */}
      {showInstallBanner && (
        <motion.div
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="fixed top-4 left-4 right-4 z-[10000] bg-[#1A1A1A] rounded-[16px] p-4 flex items-center justify-between shadow-2xl border border-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#B8955A] rounded-[10px] flex items-center justify-center flex-shrink-0">
              <span className="font-serif text-white text-lg font-bold">OS</span>
            </div>
            <div className="flex flex-col">
              <p className="font-outfit text-[14px] text-white font-semibold">Add OurSpace to your home screen</p>
              <p className="font-outfit text-[12px] text-white/50">Tap for the full app experience</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleInstall}
              className="bg-[#B8955A] text-white px-4 py-2 rounded-full font-outfit text-[13px] font-medium"
            >
              Install
            </button>
            <button onClick={dismissInstall} className="text-white/40 p-1">
              <X size={18} />
            </button>
          </div>
        </motion.div>
      )}

      {/* iOS Install Instructions */}
      {showIOSInstall && (
        <motion.div
          initial={{ y: -100 }}
          animate={{ y: 0 }}
          className="fixed top-4 left-4 right-4 z-[10000] bg-[#1A1A1A] rounded-[16px] p-4 flex items-center justify-between shadow-2xl border border-white/5"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#B8955A] rounded-[10px] flex items-center justify-center flex-shrink-0">
              <span className="font-serif text-white text-lg font-bold">OS</span>
            </div>
            <div className="flex flex-col">
              <p className="font-outfit text-[14px] text-white font-semibold">Install OurSpace</p>
              <div className="flex items-center gap-1.5 text-[12px] text-white/50 font-outfit">
                <span>Tap Share</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/70"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>then 'Add to Home Screen'</span>
              </div>
            </div>
          </div>
          <button onClick={dismissIOSInstall} className="text-white/40 p-1">
            <X size={18} />
          </button>
        </motion.div>
      )}
      
      {/* In-app Notification Toast */}
      <AnimatePresence>
        {inAppNotification && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.y < -20) setInAppNotification(null);
            }}
            onClick={() => {
              if (inAppNotification.data?.click_action) {
                const action = inAppNotification.data.click_action;
                if (action.includes('/grocery')) setActiveTab('groceries');
                else if (action.includes('/calendar')) setActiveTab('calendar');
                else if (action.includes('/notes')) {
                  setActiveTab('more');
                  setSubScreen('notes');
                }
                else if (action.includes('/together')) setActiveTab('together');
                else if (action.includes('/dashboard')) setActiveTab('home');
              }
              setInAppNotification(null);
            }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed top-4 left-4 right-4 z-[20000] bg-[#1A1A1A] text-white rounded-[16px] p-4 flex items-center gap-4 shadow-2xl cursor-pointer"
          >
            <div className="w-10 h-10 bg-[#B8955A] rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xl">✨</span>
            </div>
            <div className="flex-1">
              <p className="font-outfit font-bold text-[14px] text-white">{inAppNotification.title}</p>
              <p className="font-outfit text-[12px] text-white/60">{inAppNotification.body}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification Permission Card */}
      <AnimatePresence>
        {showNotificationCard && (
          <div className="fixed inset-0 z-[15000] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#1A1A1A]/40 backdrop-blur-sm"
              onClick={dismissNotifications}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full bg-[#EDE8DF] rounded-t-[32px] p-8 shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-charcoal/10 rounded-full mx-auto mb-8" />
              <h3 className="font-serif text-[24px] text-[#1A1A1A] mb-3">Stay connected 🔔</h3>
              <p className="font-outfit text-[14px] text-[#6B6560] leading-[1.5] mb-8">
                Get notified when your partner adds to your lists, upcoming events, and relationship insights
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleEnableNotifications}
                  className="w-full h-14 bg-[#1A1A1A] text-white rounded-[14px] font-outfit font-semibold"
                >
                  Enable Notifications
                </button>
                <button
                  onClick={dismissNotifications}
                  className="w-full h-12 bg-transparent text-[#6B6560] font-outfit font-medium"
                >
                  Maybe later
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showLaunchScreen && <LaunchScreen onComplete={() => setShowLaunchScreen(false)} isAnniversary={isAnniversary} />}
      <NoiseOverlay />
      <OnlineParticles isAnniversary={isAnniversary} bothOnline={true} />
      <ProgressBar isLoading={isLoading} />
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#F8F4EE' }} className="relative w-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={subScreen || activeTab}
            initial={isSubScreen ? { x: "100%" } : { opacity: 0 }}
            animate={isSubScreen ? { x: 0 } : { opacity: 1 }}
            exit={isSubScreen ? { x: "100%" } : { opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex-1 relative"
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
        {!showLaunchScreen && !isSubScreen && (
          <BottomNav activeTab={activeTab} onChange={(tab) => {
            setSubScreen(null);
            setActiveTab(tab);
          }} />
        )}
      </div>
      <Toast 
        isVisible={showToast} 
        message={toastMsg} 
        type={toastType} 
      />
    </>
  );
}

export default function App() {
  return (
    <AuthWrapper>
      <MainApp />
    </AuthWrapper>
  );
}
