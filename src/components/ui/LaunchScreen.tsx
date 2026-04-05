import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import Lottie from "lottie-react";

interface LaunchScreenProps {
  onComplete: () => void;
  isAnniversary?: boolean;
}

export default function LaunchScreen({ onComplete, isAnniversary = false }: LaunchScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    if (isAnniversary) {
      fetch("https://assets5.lottiefiles.com/packages/lf20_xwmj0hsk.json") // Using a nice floating polaroid/heart animation as placeholder
        .then(res => res.json())
        .then(data => setAnimationData(data))
        .catch(() => {});
    }
  }, [isAnniversary]);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.4,
          ease: "power2.inOut",
          onComplete
        });
      }
    });

    if (isAnniversary) {
      // Longer timeline for anniversary
      tl.fromTo(textRef.current, 
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }
      )
      .to({}, { duration: 2.5 }); // Hold for Lottie
    } else {
      tl.fromTo(textRef.current, 
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }
      )
      .fromTo(dotRef.current,
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(2)" },
        "-=0.3"
      )
      .to({}, { duration: 1.1 }); // Hold for 1.1s (Total ~2.5s)
    }

    return () => { tl.kill(); };
  }, [onComplete, isAnniversary]);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-linen">
      {isAnniversary && animationData && (
        <div className="mb-8 h-48 w-48">
          <Lottie animationData={animationData} loop={true} />
        </div>
      )}
      <h1 ref={textRef} className="flex items-baseline font-serif text-[48px] font-light text-charcoal">
        {isAnniversary ? "Happy Anniversary" : "OurSpace"}
        {!isAnniversary && (
          <span ref={dotRef} className="ml-1.5 inline-block h-3 w-3 rounded-full bg-brass" />
        )}
      </h1>
    </div>
  );
}
