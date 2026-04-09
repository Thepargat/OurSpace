import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface OnlineParticlesProps {
  isAnniversary?: boolean;
  bothOnline?: boolean;
}

function ParticleField({ isAnniversary, bothOnline }: OnlineParticlesProps) {
  const pointsRef = useRef<THREE.Points>(null);
  
  const particleCount = isAnniversary ? 300 : (bothOnline ? 100 : 0);
  
  const [positions, speeds, phases] = useMemo(() => {
    const pos = new Float32Array(300 * 3);
    const spd = new Float32Array(300);
    const phs = new Float32Array(300);
    
    for (let i = 0; i < 300; i++) {
      // x: -5 to 5, y: -5 to 5, z: -2 to 2
      pos[i * 3] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
      
      spd[i] = 0.2 + Math.random() * 0.5;
      phs[i] = Math.random() * Math.PI * 2;
    }
    return [pos, spd, phs];
  }, []);

  useFrame((state, delta) => {
    if (!pointsRef.current || particleCount === 0) return;
    
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    
    for (let i = 0; i < particleCount; i++) {
      // Move up
      positions[i * 3 + 1] += speeds[i] * delta * (isAnniversary ? 1.5 : 0.5);
      
      // Gentle sway
      positions[i * 3] += Math.sin(state.clock.elapsedTime + phases[i]) * delta * 0.2;
      
      // Reset if too high
      if (positions[i * 3 + 1] > 5) {
        positions[i * 3 + 1] = -5;
      }
    }
    
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  if (particleCount === 0) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={isAnniversary ? 0.08 : 0.05}
        color="#B8955A"
        transparent
        opacity={isAnniversary ? 0.8 : 0.4}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

export default function OnlineParticles({ isAnniversary = false, bothOnline = true }: OnlineParticlesProps) {
  if (!isAnniversary && !bothOnline) return null;

  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <ParticleField isAnniversary={isAnniversary} bothOnline={bothOnline} />
      </Canvas>
    </div>
  );
}
