import { useEffect, useState } from "react";
import { motion } from "motion/react";

export default function AnniversaryParticles() {
  const [particles, setParticles] = useState<{ id: number; x: number; delay: number; duration: number }[]>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 20 }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 5,
      duration: 10 + Math.random() * 10
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: "100vh", x: `${p.x}vw` }}
          animate={{ opacity: [0, 0.6, 0], y: "-10vh" }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute h-2 w-2 rounded-full bg-brass blur-[1px]"
        />
      ))}
    </div>
  );
}
