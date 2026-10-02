import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { AmbientMood, AmbientScene } from "./ambient-scene";
import { prefersReducedMotion } from "./tokens";

const VIDEO_SRC = "https://designerstephen.github.io/public-assets/videos/serene-art-hero.mp4";

// Pages outside React's prop flow (scroll-driven landing) reach the live scene through this bridge.
let liveScene: AmbientScene | null = null;
export const ambientBridge = {
  setScroll(progress: number) {
    liveScene?.setScroll(progress);
  },
  pulse() {
    liveScene?.pulse();
  },
};

interface AmbientBackdropProps {
  mood: AmbientMood;
  tone: "public" | "workspace";
  /** False pauses WebGL drawing, e.g. while a meeting decodes several video streams. */
  active?: boolean;
}

/**
 * One persistent background for every screen: the landscape video, a tone veil and the three.js
 * atmosphere. Keeping it mounted above the screen switch removes the reload flash between
 * landing, login and the workspace.
 */
export function AmbientBackdrop({ mood, tone, active = true }: AmbientBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<AmbientScene | null>(null);
  const moodRef = useRef(mood);
  const activeRef = useRef(active);
  const [webgl, setWebgl] = useState(true);
  moodRef.current = mood;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // three.js loads after first paint so it never blocks the initial screen.
    void import("./ambient-scene")
      .then(({ AmbientScene }) => {
        if (cancelled) return;
        const scene = new AmbientScene(canvas, { reducedMotion: prefersReducedMotion() });
        sceneRef.current = scene;
        liveScene = scene;
        scene.setMood(moodRef.current, false);
        scene.setActive(activeRef.current);
        scene.start();
        gsap.fromTo(canvas, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, ease: "power2.out" });
      })
      .catch(() => {
        if (!cancelled) setWebgl(false);
      });
    return () => {
      cancelled = true;
      gsap.killTweensOf(canvas);
      if (liveScene === sceneRef.current) liveScene = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setMood(mood);
  }, [mood]);

  useEffect(() => {
    sceneRef.current?.setActive(active);
  }, [active]);

  return (
    <div className={`ambient-backdrop ambient-backdrop--${tone}`} aria-hidden="true">
      <video
        className="ambient-backdrop__video"
        src={VIDEO_SRC}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
      <div className="ambient-backdrop__veil ambient-backdrop__veil--public" />
      <div className="ambient-backdrop__veil ambient-backdrop__veil--workspace" />
      {webgl && <canvas ref={canvasRef} className="ambient-backdrop__canvas" />}
    </div>
  );
}
