import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { doc, setDoc, onSnapshot, getDocFromServer } from "firebase/firestore";
import { db, auth } from "./firebase";
import AuthWrapper, { useAuth } from "./components/AuthWrapper";
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
import LottieEmptyState from "./components/ui/LottieEmptyState";
import GroceryItem from "./components/ui/GroceryItem";
import { staggerContainer, staggerItem } from "./lib/motion";
import HomeTab from "./components/tabs/HomeTab";

import CalendarTab from "./components/tabs/CalendarTab";
import GroceryTab from "./components/tabs/GroceryTab";
import FinancesTab from "./components/tabs/FinancesTab";
import TogetherTab from "./components/tabs/TogetherTab";
import MoreTab from "./components/tabs/MoreTab";
import SubScreen from "./components/ui/SubScreen";
import OnboardingStep1 from "./components/onboarding/OnboardingStep1";
import OnboardingStep2 from "./components/onboarding/OnboardingStep2";
import OnboardingStep3 from "./components/onboarding/OnboardingStep3";
import OnboardingStep4 from "./components/onboarding/OnboardingStep4";

function MainApp() {
  const { hasHousehold } = useAuth();
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
        case 'meal-planner': return <SubScreen key="meal-planner" title="Meal Planner" onBack={() => setSubScreen(null)} />;
        case 'chores': return <SubScreen key="chores" title="Chores" onBack={() => setSubScreen(null)} />;
        case 'notes': return <SubScreen key="notes" title="Shared Notes" onBack={() => setSubScreen(null)} />;
        case 'savings': return <SubScreen key="savings" title="Savings Goals" onBack={() => setSubScreen(null)} />;
        case 'settings': return <SubScreen key="settings" title="Settings" onBack={() => setSubScreen(null)} />;
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
            // This will trigger AuthWrapper to re-fetch and set hasHousehold to true
            // if Step 3 set the householdId.
            // For now, we'll just force a reload or rely on the listener.
            window.location.reload();
          }} />
        )}
      </AnimatePresence>
    );
  }

  const isSubScreen = !!subScreen;

  return (
    <>
      {showLaunchScreen && <LaunchScreen onComplete={() => setShowLaunchScreen(false)} isAnniversary={isAnniversary} />}
      <NoiseOverlay />
      <OnlineParticles isAnniversary={isAnniversary} bothOnline={true} />
      <ProgressBar isLoading={isLoading} />
      <div className="relative h-full w-full bg-[#F8F4EE] overflow-hidden" {...(bind() as any)}>
        <AnimatePresence mode="wait">
          <motion.div
            key={subScreen || activeTab}
            initial={isSubScreen ? { x: "100%" } : { opacity: 0 }}
            animate={isSubScreen ? { x: 0 } : { opacity: 1 }}
            exit={isSubScreen ? { x: "100%" } : { opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute inset-0"
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
