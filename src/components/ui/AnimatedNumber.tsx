import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

interface AnimatedNumberProps {
  value: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export default function AnimatedNumber({ value, prefix = "", suffix = "", className = "" }: AnimatedNumberProps) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (!nodeRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          
          const obj = { val: 0 };
          gsap.to(obj, {
            val: value,
            duration: 1.8,
            ease: "power3.out",
            onUpdate: () => {
              if (nodeRef.current) {
                // Format with commas
                const formatted = Math.floor(obj.val).toLocaleString('en-US');
                nodeRef.current.innerText = `${prefix}${formatted}${suffix}`;
              }
            }
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(nodeRef.current);

    return () => {
      observer.disconnect();
    };
  }, [value, prefix, suffix, hasAnimated]);

  return <span ref={nodeRef} className={className}>{prefix}0{suffix}</span>;
}
