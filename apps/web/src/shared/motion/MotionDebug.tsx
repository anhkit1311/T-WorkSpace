import {useEffect,useRef,useState} from "react";
import "./motion-debug.css";

type Sample={fps:number;frames:number;longTasks:number;maxTask:number;cls:number;blurNodes:number;blurDepth:number};
const empty:Sample={fps:0,frames:0,longTasks:0,maxTask:0,cls:0,blurNodes:0,blurDepth:0};

/** Diagnostic only, dynamically imported behind DEV + ?motion-debug=1. Never a production loop. */
export default function MotionDebug(){
  const [sample,setSample]=useState(empty);
  const [epoch,setEpoch]=useState(0);
  const current=useRef({...empty});
  useEffect(()=>{
    let frame=0,previous=0,start=0,count=0,lastBlur=0;
    current.current={...empty};
    const observer=new PerformanceObserver(list=>{
      for(const entry of list.getEntries()){
        if(entry.entryType==="longtask"){
          current.current.longTasks++;
          current.current.maxTask=Math.max(current.current.maxTask,entry.duration);
        }else if(entry.entryType==="layout-shift"){
          const shift=entry as PerformanceEntry & {value:number;hadRecentInput:boolean};
          if(!shift.hadRecentInput)current.current.cls+=shift.value;
        }
      }
    });
    const supported=PerformanceObserver.supportedEntryTypes;
    observer.observe({entryTypes:["longtask","layout-shift"].filter(type=>supported.includes(type))});
    const inspectBlur=()=>{
      let nodes=0,depth=0;
      const blurred=new Set<Element>();
      for(const el of document.querySelectorAll("body *")){
        if(el.closest("[data-motion-debug]"))continue;
        const style=getComputedStyle(el),box=el.getBoundingClientRect();
        if(style.backdropFilter!=="none"&&style.visibility!=="hidden"&&box.width&&box.height&&box.bottom>0&&box.top<innerHeight)blurred.add(el);
      }
      nodes=blurred.size;
      for(const el of blurred){let n=0;for(let p:Element|null=el;p;p=p.parentElement)if(blurred.has(p))n++;depth=Math.max(depth,n);}
      current.current.blurNodes=nodes;current.current.blurDepth=depth;
    };
    const tick=(time:number)=>{
      if(document.hidden){frame=0;return;}
      if(!start)start=time;
      if(previous)count++;
      previous=time;
      current.current.frames++;
      if(time-start>=1000){
        current.current.fps=Math.round(count*1000/(time-start));
        if(time-lastBlur>3000){inspectBlur();lastBlur=time;}
        setSample({...current.current});start=time;count=0;
      }
      frame=requestAnimationFrame(tick);
    };
    const visibility=()=>{cancelAnimationFrame(frame);previous=0;start=0;count=0;if(!document.hidden)frame=requestAnimationFrame(tick);};
    visibility();document.addEventListener("visibilitychange",visibility);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener("visibilitychange",visibility);};
  },[epoch]);
  return <aside className="motion-debug" data-motion-debug aria-label="Motion debug — chỉ môi trường phát triển">
    <strong>Motion debug · DEV</strong>
    <output>FPS rAF: {sample.fps} · frames: {sample.frames}</output>
    <output>Long tasks: {sample.longTasks} · max: {sample.maxTask.toFixed(1)}ms · CLS: {sample.cls.toFixed(4)}</output>
    <output>Blur DOM: {sample.blurNodes} · depth: {sample.blurDepth}</output>
    <button type="button" onClick={()=>setEpoch(n=>n+1)}>Đo lại</button>
    <small>rAF không phải GPU FPS; blur là cây DOM, không phải layer compositor.</small>
  </aside>;
}
