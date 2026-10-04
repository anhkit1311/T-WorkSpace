import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import type { AmbientMood, AmbientScene } from "./ambient-scene";
import { useMotionSafe, useSceneCovered } from "./MotionProvider";

const VIDEO_SRC = "https://designerstephen.github.io/public-assets/videos/serene-art-hero.mp4";
// TODO(asset): owner must supply licensed local WebM/MP4 + a matching poster.
// Keep the approved source until supplied; do not fetch/copy third-party media.

// Pages outside React's prop flow (scroll-driven landing) reach the live scene through this bridge.
let liveScene: AmbientScene | null = null;
export const ambientBridge = {
  setScroll(progress: number) {
    liveScene?.setScroll(progress);
  },
  pulse() {
    liveScene?.pulse();
  },
  debugState() { return liveScene?.debugState(); },
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const { reduced } = useMotionSafe();
  const covered = useSceneCovered();
  const drawing = active && !covered;
  const saveData = Boolean((navigator as Navigator & {connection?:{saveData?:boolean}}).connection?.saveData);
  const sceneRef = useRef<AmbientScene | null>(null);
  const moodRef = useRef(mood);
  const activeRef = useRef(active);
  const [webgl, setWebgl] = useState(true);
  moodRef.current = mood;
  activeRef.current = drawing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // three.js loads after first paint so it never blocks the initial screen.
    void import("./ambient-scene")
      .then(({ AmbientScene }) => {
        if (cancelled) return;
        const scene = new AmbientScene(canvas, { reducedMotion: reduced });
        sceneRef.current = scene;
        liveScene = scene;
        scene.setMood(moodRef.current, false);
        scene.setActive(activeRef.current);
        scene.start();
        if (!reduced) gsap.fromTo(canvas, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.2, ease: "power2.out" });
      })
      .catch(() => {
        if (!cancelled) setWebgl(false);
      });
    return () => {
      cancelled = true;
      gsap.killTweensOf(canvas);
      gsap.set(canvas, { clearProps: "opacity,visibility" });
      if (liveScene === sceneRef.current) liveScene = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    const sync = () => {
      if (!videoRef.current) return;
      if (reduced || saveData || !drawing || document.hidden) videoRef.current.pause();
      else void videoRef.current.play().catch(() => { /* Autoplay denied: retain the loaded first frame. */ });
    };
    sync();
    document.addEventListener("visibilitychange",sync);
    return () => document.removeEventListener("visibilitychange",sync);
  },[drawing,reduced,saveData]);

  useEffect(() => {
    sceneRef.current?.setMood(mood);
  }, [mood]);

  useEffect(() => {
    sceneRef.current?.setActive(drawing);
  }, [drawing]);

  return (
    <div className={`ambient-backdrop ambient-backdrop--${tone}`} aria-hidden="true">
      <video
        ref={videoRef}
        className="ambient-backdrop__video"
        src={VIDEO_SRC}
        autoPlay={!reduced && !saveData && drawing}
        loop
        muted
        playsInline
        preload="metadata"
      />
      <div className="ambient-backdrop__veil ambient-backdrop__veil--public" />
      <div className="ambient-backdrop__veil ambient-backdrop__veil--workspace" />
      {webgl && <canvas ref={canvasRef} className="ambient-backdrop__canvas" />}
    </div>
  );
}
