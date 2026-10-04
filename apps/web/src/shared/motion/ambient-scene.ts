import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { gsap } from "gsap";
import { DURATION, GSAP_EASE_INOUT, GSAP_EASE_OUT } from "./tokens";
import { nextQualitySample } from "./quality";

/*
 * Atmospheric layer drawn over the landscape video: drifting light motes plus a slow valley mist.
 * Everything animates in shaders (no per-frame buffer uploads); GSAP owns every tween and drives
 * the render from its ticker so uniform changes and frames land in the same rAF.
 */

export type AmbientMood =
  | "landing"
  | "login"
  | "overview"
  | "chat"
  | "meetings"
  | "tasks"
  | "profile"
  | "admin"
  | "notifications"
  | "invitation";

interface MoodSpec {
  tint: string;
  mist: number;
  motes: number;
  camX: number;
  camY: number;
}

// Reading-heavy views (chat, tasks) keep the atmosphere quiet behind dense text.
const MOODS: Record<AmbientMood, MoodSpec> = {
  landing: { tint: "#f2c6b2", mist: 0.34, motes: 1, camX: 0, camY: 0 },
  login: { tint: "#d6cdf0", mist: 0.4, motes: 0.85, camX: 0.7, camY: -0.25 },
  overview: { tint: "#f0d0c2", mist: 0.24, motes: 0.8, camX: 0, camY: 0.25 },
  chat: { tint: "#cdd7ec", mist: 0.1, motes: 0.38, camX: -0.55, camY: 0.1 },
  meetings: { tint: "#c8d2ea", mist: 0.16, motes: 0.5, camX: 0.55, camY: -0.2 },
  tasks: { tint: "#ead5c4", mist: 0.12, motes: 0.42, camX: -0.35, camY: -0.3 },
  profile: { tint: "#e6cfe0", mist: 0.2, motes: 0.6, camX: 0.35, camY: 0.3 },
  admin: { tint: "#d3d9e6", mist: 0.14, motes: 0.45, camX: 0.25, camY: -0.1 },
  notifications: { tint: "#dcd4ee", mist: 0.16, motes: 0.5, camX: -0.2, camY: 0.2 },
  invitation: { tint: "#f0d0c2", mist: 0.26, motes: 0.75, camX: 0, camY: 0 },
};

const mistVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const mistFragment = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  uniform vec3 uTint;
  uniform float uMist;
  uniform float uWarp;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 p = vec2(vUv.x * aspect, vUv.y) * 2.1 + uPointer * 0.06;
    float t = uTime * 0.028;
    float n = fbm(p + vec2(t, t * 0.35));
    float drift = fbm(p * 1.6 - vec2(t * 1.4, 0.0) + n * 1.2);
    // The video's valley sits in the lower-middle band; keep the mist there and clear the sky.
    float band = smoothstep(0.02, 0.42, vUv.y) * (1.0 - smoothstep(0.5, 0.92, vUv.y));
    float mist = smoothstep(0.38, 0.86, drift) * band;
    float glow = smoothstep(0.85, 0.0, distance(vUv, vec2(0.5 + uPointer.x * 0.04, 0.64)));
    vec3 color = mix(vec3(1.0), uTint, 0.4);
    float alpha = mist * uMist + glow * 0.05 + uWarp * 0.06 * band;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.6));
  }
`;

const moteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uWarp;
  uniform float uSize;
  attribute float aScale;
  attribute float aSpeed;
  attribute float aPhase;
  varying float vAlpha;
  varying float vMix;

  void main() {
    vec3 p = position;
    float t = uTime * aSpeed;
    p.y = mod(p.y + t * 0.32 + 8.0, 16.0) - 8.0;
    p.x += sin(t * 0.55 + aPhase * 6.2831) * 0.5;
    p.z += cos(t * 0.4 + aPhase * 6.2831) * 0.35 + uWarp * (1.5 + aPhase * 2.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aScale * uPixelRatio * (7.0 / max(-mv.z, 0.5));
    float edge = smoothstep(-8.0, -6.0, p.y) * (1.0 - smoothstep(6.0, 8.0, p.y));
    vAlpha = edge * (0.55 + 0.45 * sin(uTime * 1.1 + aPhase * 12.566));
    vMix = aPhase;
  }
`;

const moteFragment = /* glsl */ `
  precision mediump float;
  uniform vec3 uTint;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vMix;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 color = mix(vec3(1.0, 0.98, 0.95), uTint, vMix * 0.6);
    gl_FragColor = vec4(color, a * a * vAlpha * uOpacity);
  }
`;

export interface AmbientSceneOptions {
  reducedMotion: boolean;
}

export class AmbientScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 0.1, 60);
  private readonly mist: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly motes: Points<BufferGeometry, ShaderMaterial>;
  private readonly tint = new Color(MOODS.landing.tint);
  private readonly rig = { baseX: 0, baseY: 0, pointerX: 0, pointerY: 0, scroll: 0 };
  private readonly pointerTo: { x: (v: number) => void; y: (v: number) => void } | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion: boolean;
  private mood: AmbientMood | null = null;
  private running = false;
  private active = true;
  private elapsed = 0;
  private disposed = false;
  private slowMs = 0;
  private qualityReduced = false;
  private renders = 0;
  debugState() { return { running: this.running, renders: this.renders, quality: this.qualityReduced ? "adaptive-half" : "base" }; }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: AmbientSceneOptions,
  ) {
    this.reducedMotion = options.reducedMotion;
    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      premultipliedAlpha: true,
    });
    this.renderer.setClearColor(0x000000, 0);

    const compact = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1 : 1.25));
    this.camera.position.set(0, 0, 9);

    this.mist = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: mistVertex,
        fragmentShader: mistFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uResolution: { value: new Vector2(1, 1) },
          uPointer: { value: new Vector2() },
          uTint: { value: this.tint },
          uMist: { value: MOODS.landing.mist },
          uWarp: { value: 0 },
        },
      }),
    );
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 0;
    this.scene.add(this.mist);

    this.motes = new Points(
      this.createMoteGeometry(compact ? 260 : 620),
      new ShaderMaterial({
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: this.renderer.getPixelRatio() },
          uWarp: { value: 0 },
          uSize: { value: compact ? 15 : 19 },
          uTint: { value: this.tint },
          uOpacity: { value: MOODS.landing.motes },
        },
      }),
    );
    this.motes.renderOrder = 1;
    this.scene.add(this.motes);

    this.pointerTo = this.reducedMotion
      ? null
      : {
          x: gsap.quickTo(this.rig, "pointerX", { duration: 1.4, ease: "power3.out" }),
          y: gsap.quickTo(this.rig, "pointerY", { duration: 1.4, ease: "power3.out" }),
        };

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    window.addEventListener("pointermove", this.handlePointer, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  /** Cross-fades palette, density and camera framing; `pulse` adds the tab-change depth push. */
  setMood(next: AmbientMood, pulse = true) {
    if (this.disposed || next === this.mood) return;
    const first = this.mood === null;
    this.mood = next;
    const spec = MOODS[next];
    const target = new Color(spec.tint);
    const mist = this.mist.material.uniforms;
    const motes = this.motes.material.uniforms;

    if (first || this.reducedMotion) {
      this.tint.copy(target);
      mist.uMist.value = spec.mist;
      motes.uOpacity.value = spec.motes;
      this.rig.baseX = spec.camX;
      this.rig.baseY = spec.camY;
      this.renderFrame();
      return;
    }

    gsap.killTweensOf([this.tint, mist.uMist, motes.uOpacity, this.rig]);
    gsap.to(this.tint, {
      r: target.r,
      g: target.g,
      b: target.b,
      duration: DURATION.scene,
      ease: GSAP_EASE_INOUT,
    });
    gsap.to(mist.uMist, { value: spec.mist, duration: DURATION.scene, ease: GSAP_EASE_INOUT });
    gsap.to(motes.uOpacity, { value: spec.motes, duration: DURATION.scene, ease: GSAP_EASE_INOUT });
    gsap.to(this.rig, {
      baseX: spec.camX,
      baseY: spec.camY,
      duration: DURATION.scene * 1.2,
      ease: GSAP_EASE_OUT,
    });
    if (pulse) this.pulse();
  }

  /** Short forward drift of the motes, synchronised with the DOM fade between tabs. */
  pulse() {
    if (this.disposed || this.reducedMotion || !this.active || document.hidden) return;
    const warps = [this.mist.material.uniforms.uWarp, this.motes.material.uniforms.uWarp];
    gsap.killTweensOf(warps);
    gsap
      .timeline()
      .to(warps, { value: 1, duration: 0.28, ease: "power2.in" })
      .to(warps, { value: 0, duration: 0.95, ease: GSAP_EASE_OUT });
  }

  /** 0..1 scroll progress for public pages; the camera rises gently with the page. */
  setScroll(progress: number) {
    if (this.reducedMotion) return;
    this.rig.scroll = Math.min(1, Math.max(0, progress));
  }

  /** Stops drawing (e.g. while a call decodes video) without tearing down GPU resources. */
  setActive(active: boolean) {
    this.active = active;
    this.syncLoop();
  }

  start() {
    this.syncLoop();
    this.renderFrame();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    gsap.killTweensOf([
      this.tint,
      this.rig,
      this.mist.material.uniforms.uMist,
      this.mist.material.uniforms.uWarp,
      this.motes.material.uniforms.uOpacity,
      this.motes.material.uniforms.uWarp,
    ]);
    window.removeEventListener("pointermove", this.handlePointer);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.resizeObserver.disconnect();
    this.mist.geometry.dispose();
    this.mist.material.dispose();
    this.motes.geometry.dispose();
    this.motes.material.dispose();
    this.renderer.dispose();
  }

  private createMoteGeometry(count: number) {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 26;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 2] = -Math.random() * 12 + 3;
      scales[i] = 0.35 + Math.random() * 0.9;
      speeds[i] = 0.25 + Math.random() * 0.75;
      phases[i] = Math.random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aScale", new BufferAttribute(scales, 1));
    geometry.setAttribute("aSpeed", new BufferAttribute(speeds, 1));
    geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
    return geometry;
  }

  private resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    (this.mist.material.uniforms.uResolution.value as Vector2).set(width, height);
    this.renderFrame();
  }

  private readonly handlePointer = (event: PointerEvent) => {
    if (!this.active || document.hidden || !this.pointerTo || event.pointerType === "touch") return;
    this.pointerTo.x((event.clientX / window.innerWidth) * 2 - 1);
    this.pointerTo.y(-((event.clientY / window.innerHeight) * 2 - 1));
  };

  private readonly handleVisibility = () => this.syncLoop();

  private readonly tick = (_time: number, deltaMs: number) => {
    if (!this.qualityReduced) {
      const sample = nextQualitySample(this.slowMs, deltaMs);
      this.slowMs = sample.slowMs;
      if (sample.downgrade) {
        this.motes.geometry.setDrawRange(0, Math.floor(this.motes.geometry.attributes.position.count / 2));
        this.qualityReduced = true;
      }
    }
    // Clamp long frames (tab restore, GC) so motion never jumps.
    this.elapsed += Math.min(deltaMs, 50) / 1000;
    this.renderFrame();
  };

  private syncLoop() {
    const shouldRun =
      !this.disposed &&
      this.active &&
      !this.reducedMotion &&
      document.visibilityState === "visible";
    if (shouldRun && !this.running) {
      gsap.ticker.add(this.tick);
      this.running = true;
    } else if (!shouldRun && this.running) {
      this.stopLoop();
    }
  }

  private stopLoop() {
    this.slowMs = 0;
    if (!this.running) return;
    gsap.ticker.remove(this.tick);
    this.running = false;
  }

  private renderFrame() {
    if (this.disposed) return;
    this.renders++;
    const { rig } = this;
    this.camera.position.x = rig.baseX + rig.pointerX * 0.45;
    this.camera.position.y = rig.baseY + rig.pointerY * 0.3 + rig.scroll * 1.6;
    this.camera.lookAt(rig.baseX * 0.4, rig.baseY * 0.4 + rig.scroll * 1.2, 0);
    const mist = this.mist.material.uniforms;
    mist.uTime.value = this.elapsed;
    (mist.uPointer.value as Vector2).set(rig.pointerX, rig.pointerY);
    this.motes.material.uniforms.uTime.value = this.elapsed;
    this.renderer.render(this.scene, this.camera);
  }
}
