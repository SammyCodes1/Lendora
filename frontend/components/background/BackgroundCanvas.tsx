"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { Component, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, MathUtils, ShaderMaterial } from "three";
import type { Group, Mesh, Points } from "three";

type CoinConfig = {
  position: [number, number, number];
  scale: number;
  speed: number;
  rotationSpeed: number;
};

function canCreateWebGLContext() {
  if (typeof document === "undefined") return false;

  try {
    const probe = document.createElement("canvas");
    return Boolean(
      probe.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
        probe.getContext("webgl", { failIfMajorPerformanceCaveat: false }) ||
        probe.getContext("experimental-webgl", { failIfMajorPerformanceCaveat: false }),
    );
  } catch {
    return false;
  }
}

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    // WebGL can be unavailable or exhausted on some devices. The rest of the
    // app should remain usable when the decorative scene cannot mount.
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

const coinConfigs: CoinConfig[] = Array.from({ length: 20 }, (_, index) => {
  const column = index % 5;
  const row = Math.floor(index / 5);

  return {
    position: [(column - 2) * 1.8, row * 0.8 - 2.2, -1 - (index % 4) * 0.7],
    scale: 0.14 + (index % 4) * 0.035,
    speed: 0.08 + (index % 5) * 0.012,
    rotationSpeed: 0.22 + (index % 6) * 0.04,
  };
});

const flowVertexShader = `
  attribute float aSpeed;
  attribute float aSize;
  uniform float uTime;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    pos.y = mod(pos.y + uTime * aSpeed + 5.0, 10.0) - 5.0;
    pos.x += sin(uTime * 0.35 + position.z * 1.8) * 0.22;
    vAlpha = smoothstep(-5.0, -2.0, pos.y) * (1.0 - smoothstep(3.4, 5.0, pos.y));

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (80.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const flowFragmentShader = `
  varying float vAlpha;

  void main() {
    float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
    float strength = 1.0 - smoothstep(0.0, 0.5, distanceToCenter);
    gl_FragColor = vec4(vec3(1.0), strength * vAlpha * 0.55);
  }
`;

function FloatingCoins() {
  const groupRef = useRef<Group>(null);

  useFrame((state, delta) => {
    if (!groupRef.current) {
      return;
    }

    groupRef.current.children.forEach((child, index) => {
      const config = coinConfigs[index];
      child.position.y += config.speed * delta;
      child.rotation.x += config.rotationSpeed * delta;
      child.rotation.z += config.rotationSpeed * 0.65 * delta;

      if (child.position.y > 3.2) {
        child.position.y = -3.2;
      }

      child.position.x = config.position[0] + Math.sin(state.clock.elapsedTime * 0.25 + index) * 0.12;
    });
  });

  return (
    <group ref={groupRef}>
      {coinConfigs.map((config, index) => (
        <mesh key={index} position={config.position} scale={config.scale} rotation={[Math.PI / 2, 0, index * 0.4]}>
          <cylinderGeometry args={[1, 1, 0.08, 48]} />
          <meshStandardMaterial color="#ffffff" metalness={0.6} roughness={0.28} transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function LiquidityLines() {
  const groupRef = useRef<Group>(null);
  const lines = useMemo(
    () => [
      [
        [-3.6, -1.6, -1.4],
        [-1.8, 0.2, -2.1],
        [0.2, 1.0, -1.7],
      ],
      [
        [1.8, -2.0, -2.4],
        [0.2, -0.8, -1.2],
        [3.6, 1.2, -2.8],
      ],
      [
        [-0.2, -2.4, -3.1],
        [1.6, -0.4, -2.0],
        [0.8, 2.2, -2.6],
      ],
    ],
    [],
  );

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      {lines.map((points, index) => (
        <Line key={index} points={points as [number, number, number][]} color="#ffffff" transparent opacity={0.22} lineWidth={1} />
      ))}
    </group>
  );
}

function VaultShape() {
  const meshRef = useRef<Mesh>(null);

  useFrame((_, delta) => {
    if (!meshRef.current) {
      return;
    }

    meshRef.current.rotation.x += delta * 0.06;
    meshRef.current.rotation.y += delta * 0.08;
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -4]} scale={2.2}>
      <dodecahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.12} />
    </mesh>
  );
}

function MoneyFlowParticles() {
  const pointsRef = useRef<Points>(null);
  const materialRef = useRef<ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    const sizes = new Float32Array(particleCount);

    for (let index = 0; index < particleCount; index++) {
      const i3 = index * 3;
      positions[i3] = (Math.random() - 0.5) * 10;
      positions[i3 + 1] = Math.random() * 10 - 5;
      positions[i3 + 2] = -1 - Math.random() * 8;
      speeds[index] = 0.18 + Math.random() * 0.42;
      sizes[index] = 0.9 + Math.random() * 1.8;
    }

    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    bufferGeometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
    bufferGeometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    return bufferGeometry;
  }, []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.08) * 0.05;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={flowVertexShader}
        fragmentShader={flowFragmentShader}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        uniforms={{ uTime: { value: 0 } }}
      />
    </points>
  );
}

function VaultRing() {
  const meshRef = useRef<Mesh>(null);

  useFrame((state, delta) => {
    if (!meshRef.current) {
      return;
    }

    meshRef.current.rotation.y += delta * 0.08;
    const scale = 1 + Math.sin(state.clock.elapsedTime * 0.8) * 0.025;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef} position={[0, 0, -8]} rotation={[Math.PI / 2.8, 0, 0]}>
      <torusGeometry args={[3, 0.02, 8, 128]} />
      <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.16} />
    </mesh>
  );
}

function DataGrid() {
  const pointsRef = useRef<Points>(null);
  const geometry = useMemo(() => {
    const gridSize = 30;
    const positions = new Float32Array(gridSize * gridSize * 3);
    let cursor = 0;

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        positions[cursor++] = (x - gridSize / 2) * 0.38;
        positions[cursor++] = -5;
        positions[cursor++] = (z - gridSize / 2) * 0.38 - 4;
      }
    }

    const bufferGeometry = new BufferGeometry();
    bufferGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    return bufferGeometry;
  }, []);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.15;
    }
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial color="#ffffff" size={0.025} transparent opacity={0.15} depthWrite={false} />
    </points>
  );
}

function Scene() {
  const rigRef = useRef<Group>(null);
  const { camera } = useThree();

  useFrame((state, delta) => {
    if (!rigRef.current || typeof document === "undefined") return;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, window.scrollY / maxScroll);
    const bookend = Math.abs(progress - 0.5) * 2;
    const targetDepth = 7.7 - bookend * 1.7;
    camera.position.z = MathUtils.damp(camera.position.z, targetDepth, 2.2, delta);
    camera.position.x = MathUtils.damp(camera.position.x, Math.sin(progress * Math.PI * 2) * 0.28, 2, delta);
    rigRef.current.rotation.y += delta * (0.018 + bookend * 0.038);
    rigRef.current.rotation.x = MathUtils.damp(rigRef.current.rotation.x, (progress - 0.5) * 0.12, 1.8, delta);
    state.camera.lookAt(0, 0, -2.5);
  });

  return (
    <>
      <ambientLight intensity={0.18} />
      <pointLight position={[-3, 1.8, 1.5]} intensity={1.1} color="#ffffff" />
      <pointLight position={[3, -1.4, 0.8]} intensity={0.7} color="#ffffff" />
      <pointLight position={[0, 3, -2]} intensity={0.6} color="#ffffff" />
      <group ref={rigRef}>
        <FloatingCoins />
        <MoneyFlowParticles />
        <LiquidityLines />
        <DataGrid />
        <VaultRing />
        <VaultShape />
      </group>
    </>
  );
}

export const BackgroundCanvas = memo(function BackgroundCanvas() {
  const [webglReady, setWebglReady] = useState(false);

  useEffect(() => {
    setWebglReady(canCreateWebGLContext());
  }, []);

  if (!webglReady) return null;

  return (
    <div className="pointer-events-none fixed left-0 top-0 z-0 h-screen w-screen [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_82%)]" style={{ opacity: "var(--scene-opacity, 0.16)", transition: "opacity 500ms ease" }}>
      <SceneErrorBoundary>
        <Canvas
          fallback={null}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 6], fov: 48 }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        >
          <Scene />
        </Canvas>
      </SceneErrorBoundary>
    </div>
  );
});
