import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface BlurImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function BlurImage({ src, alt, className }: BlurImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <motion.img
        src={src}
        alt={alt}
        onLoad={() => setIsLoaded(true)}
        initial={{ filter: 'blur(20px)', scale: 1.1 }}
        animate={{ 
          filter: isLoaded ? 'blur(0px)' : 'blur(20px)',
          scale: isLoaded ? 1 : 1.1,
          opacity: isLoaded ? 1 : 0.5
        }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="w-full h-full object-cover"
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
