import { useEffect, useRef } from "react";
import gsap from "gsap";

interface LaunchScreenProps {
  onComplete: () => void;
  isAnniversary?: boolean;
}

export default function LaunchScreen({ onComplete, isAnniversary = false }: LaunchScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const bylineRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.5,
          ease: "power2.inOut",
          onComplete
        });
      }
    });

    if (isAnniversary) {
      tl.fromTo(textRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }
      )
      .fromTo(bylineRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" },
        "-=0.3"
      )
      .to({}, { duration: 2.5 }); // Hold
    } else {
      tl.fromTo(textRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }
      )
      .fromTo(dotRef.current,
        { opacity: 0, scale: 0 },
        { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(2.5)" },
        "-=0.3"
      )
      .fromTo(bylineRef.current,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" },
        "-=0.1"
      )
      .to({}, { duration: 1.2 }); // Hold for ~2.5s total
    }

    return () => { tl.kill(); };
  }, [onComplete, isAnniversary]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#fcf9f4]"
    >
      {isAnniversary && (
        <div className="mb-8 h-48 w-48 flex items-center justify-center">
          <span
            className="material-symbols-outlined text-[120px]"
            style={{ color: "#B8955A", fontVariationSettings: "'FILL' 1" }}
          >
            favorite
          </span>
        </div>
      )}
      <div className="flex flex-col items-center">
        <h1
          ref={textRef}
          className="flex items-baseline font-serif text-[52px] font-light text-[#1A1A1A] opacity-0"
        >
          {isAnniversary ? "Happy Anniversary" : "OurSpace"}
          {!isAnniversary && (
            <span
              ref={dotRef}
              className="ml-2 inline-block h-3 w-3 rounded-full opacity-0"
              style={{ background: "#B8955A" }}
            />
          )}
        </h1>
        <p
          ref={bylineRef}
          className="font-serif italic text-[13px] text-[#B8955A]/60 tracking-wider mt-2 opacity-0"
        >
          by pargat
        </p>
      </div>
    </div>
  );
}
