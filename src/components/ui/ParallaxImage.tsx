import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion, AnimatePresence } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

interface ParallaxImageProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
}

export default function ParallaxImage({ src, alt, className = "", containerClassName = "" }: ParallaxImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !imageRef.current) return;

    // Parallax at 0.72x scroll speed
    gsap.to(imageRef.current, {
      yPercent: 28,
      ease: "none",
      scrollTrigger: {
        trigger: containerRef.current,
        start: "top bottom", 
        end: "bottom top",
        scrub: true,
      },
    });

    return () => {
      ScrollTrigger.getAll().forEach(t => t.kill());
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${containerClassName}`}>
      <motion.img 
        ref={imageRef}
        src={src} 
        alt={alt} 
        onLoad={() => setIsLoaded(true)}
        initial={{ filter: 'blur(20px)', scale: 1.1 }}
        animate={{ 
          filter: isLoaded ? 'blur(0px)' : 'blur(20px)',
          scale: isLoaded ? 1 : 1.1
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={`h-[128%] w-full object-cover -translate-y-[14%] ${className} ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
        referrerPolicy="no-referrer"
      />
      <AnimatePresence>
        {!isLoaded && (
          <motion.div
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-stone/20 animate-pulse"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
