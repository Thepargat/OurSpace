import { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

function SilkMesh() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { invalidate } = useThree();

  // For gyroscope
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma != null && e.beta != null) {
        mouse.current.x = e.gamma / 90; // -1 to 1
        mouse.current.y = (e.beta - 45) / 90;
        invalidate();
      }
    };
    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [invalidate]);

  // To keep it moving slowly, we set up an interval to invalidate at ~30fps
  useEffect(() => {
    const interval = setInterval(() => {
      invalidate();
    }, 1000 / 30);
    return () => clearInterval(interval);
  }, [invalidate]);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor1: { value: new THREE.Color('#F8F4EE') },
    uColor2: { value: new THREE.Color('#EDE8DF') }
  }), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    
    // Subtle gyro rotation
    meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, -Math.PI / 4 + mouse.current.y * 0.2, 0.05);
    meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, mouse.current.x * 0.2, 0.05);

    const material = meshRef.current.material as THREE.ShaderMaterial;
    if (material.uniforms) {
      material.uniforms.uTime.value = state.clock.getElapsedTime() * 0.15;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 4, 0, 0]} position={[0, 0, -1]}>
      <planeGeometry args={[12, 12, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={`
          uniform float uTime;
          varying vec2 vUv;
          varying float vElevation;

          // Simplex 2D noise
          vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
          float snoise(vec2 v){
            const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
            vec2 i  = floor(v + dot(v, C.yy) );
            vec2 x0 = v -   i + dot(i, C.xx);
            vec2 i1;
            i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec4 x12 = x0.xyxy + C.xxzz;
            x12.xy -= i1;
            i = mod(i, 289.0);
            vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
            + i.x + vec3(0.0, i1.x, 1.0 ));
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
            vUv = uv;
            vec4 modelPosition = modelMatrix * vec4(position, 1.0);
            
            float elevation = snoise(vec2(modelPosition.x * 0.4 + uTime, modelPosition.y * 0.4 + uTime)) * 0.6;
            elevation += snoise(vec2(modelPosition.x * 1.2 - uTime, modelPosition.y * 1.2 + uTime)) * 0.2;
            
            modelPosition.z += elevation;
            vElevation = elevation;
            
            vec4 viewPosition = viewMatrix * modelPosition;
            vec4 projectedPosition = projectionMatrix * viewPosition;
            gl_Position = projectedPosition;
          }
        `}
        fragmentShader={`
          uniform vec3 uColor1;
          uniform vec3 uColor2;
          varying vec2 vUv;
          varying float vElevation;

          void main() {
            float mixStrength = (vElevation + 0.5) * 0.8;
            vec3 color = mix(uColor1, uColor2, mixStrength);
            
            // Add some fake lighting/shading based on elevation
            color *= (1.0 + vElevation * 0.15);
            
            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  );
}

export default function SilkBackground() {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="absolute inset-0 z-0 opacity-60 pointer-events-none bg-gradient-to-br from-[#F8F4EE] to-[#EDE8DF] animate-pulse" />
    );
  }

  return (
    <div className="absolute inset-0 z-0 opacity-60 pointer-events-none bg-gradient-to-br from-[#F8F4EE] to-[#EDE8DF]">
      <Canvas 
        frameloop="demand" 
        camera={{ position: [0, 0, 3], fov: 45 }}
        onCreated={({ gl }) => {
          if (!gl) setHasError(true);
        }}
      >
        <SilkMesh />
      </Canvas>
    </div>
  );
}
