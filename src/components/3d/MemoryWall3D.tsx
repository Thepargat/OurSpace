import { useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture, shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { extend } from '@react-three/fiber';
import { motion, AnimatePresence } from 'motion/react';
import BlurImage from '../ui/BlurImage';

const LiquidDisplacementMaterial = shaderMaterial(
  {
    uTime: 0,
    uProgress: 0,
    uTexture1: new THREE.Texture(),
    uTexture2: new THREE.Texture(),
  },
  `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    uniform float uTime;
    uniform float uProgress;
    uniform sampler2D uTexture1;
    uniform sampler2D uTexture2;
    varying vec2 vUv;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      float noise = snoise(vUv * 4.0 + uTime * 0.5);
      vec2 distortedUv1 = vUv + noise * uProgress * 0.2;
      vec2 distortedUv2 = vUv - noise * (1.0 - uProgress) * 0.2;
      vec4 color1 = texture2D(uTexture1, distortedUv1);
      vec4 color2 = texture2D(uTexture2, distortedUv2);
      gl_FragColor = mix(color1, color2, uProgress);
    }
  `
);

extend({ LiquidDisplacementMaterial });

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      liquidDisplacementMaterial: any;
    }
  }
}

const PHOTOS = [
  "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?q=80&w=1000&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?q=80&w=1000&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=1000&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1510798831971-661eb04b3739?q=80&w=1000&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1530789253388-582c481c54b0?q=80&w=1000&auto=format&fit=crop",
];

function LightboxScene({ startIndex, onClose }: { startIndex: number, onClose: () => void }) {
  const textures = useTexture(PHOTOS);
  const { viewport } = useThree();
  const materialRef = useRef<any>(null);

  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [nextIndex, setNextIndex] = useState((startIndex + 1) % PHOTOS.length);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const handleNext = () => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    
    const startTime = performance.now();
    const duration = 1200;
    
    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeProgress = progress < 0.5 
        ? 4 * progress * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      if (materialRef.current) {
        materialRef.current.uProgress = easeProgress;
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setCurrentIndex(nextIndex);
        setNextIndex((nextIndex + 1) % PHOTOS.length);
        if (materialRef.current) {
          materialRef.current.uProgress = 0;
        }
        setIsTransitioning(false);
      }
    };
    requestAnimationFrame(animate);
  };

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uTime = state.clock.elapsedTime;
    }
  });

  // Calculate target dimensions to fill screen while maintaining aspect ratio
  const aspect = 1.2 / 1.6; // Assuming portrait photos
  const screenAspect = viewport.width / viewport.height;
  let targetScaleX = viewport.width;
  let targetScaleY = viewport.height;
  
  if (screenAspect > aspect) {
    targetScaleY = viewport.width / aspect;
  } else {
    targetScaleX = viewport.height * aspect;
  }

  return (
    <mesh onClick={(e) => { e.stopPropagation(); handleNext(); }}>
      <planeGeometry args={[targetScaleX, targetScaleY]} />
      {/* @ts-expect-error - Custom material registered via extend */}
      <liquidDisplacementMaterial 
        ref={materialRef}
        uTexture1={textures[currentIndex]}
        uTexture2={textures[nextIndex]}
        transparent
      />
    </mesh>
  );
}

export default function MemoryWall3D() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <div className="relative">
      {/* HTML Masonry Grid */}
      <div className="columns-2 gap-4 space-y-4">
        {PHOTOS.map((photo, i) => (
          <motion.div
            key={i}
            layoutId={`photo-${i}`}
            className="relative rounded-2xl overflow-hidden cursor-pointer group break-inside-avoid"
            onClick={() => setSelectedIndex(i)}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.4 }}
          >
            <BlurImage 
              src={photo} 
              alt={`Memory ${i}`} 
              className="aspect-[3/4] w-full"
            />
          </motion.div>
        ))}
      </div>

      {/* WebGL Lightbox Overlay */}
      <AnimatePresence>
        {selectedIndex !== null && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-charcoal"
          >
            <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
              <ambientLight intensity={1} />
              <LightboxScene startIndex={selectedIndex} onClose={() => setSelectedIndex(null)} />
            </Canvas>

            <div className="absolute top-12 left-6 right-6 flex justify-between items-center pointer-events-none">
              <h2 className="font-serif text-2xl text-linen">Memory</h2>
              <button 
                onClick={() => setSelectedIndex(null)}
                className="pointer-events-auto text-linen/70 hover:text-linen w-10 h-10 flex items-center justify-center rounded-full bg-white/10 backdrop-blur-md"
              >
                ✕
              </button>
            </div>
            
            <div className="absolute bottom-12 left-0 right-0 text-center pointer-events-none">
              <p className="text-linen/70 text-sm tracking-widest uppercase">Tap to next</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
