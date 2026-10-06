import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DURATION,EASE,SPRING,getMotionPreset,interpolateCount,tabDirection,prefersReducedMotion} from '../src/shared/motion/tokens.ts';
import {nextQualitySample} from '../src/shared/motion/quality.ts';

test('motion tokens use bounded timing and damped springs',()=>{
 assert.equal(DURATION.micro,.12);assert.equal(DURATION.overlay,.22);assert.equal(DURATION.page,.3);assert.equal(DURATION.story,.9);
 assert.ok(DURATION.panelExit<DURATION.panel);
 for(const ease of Object.values(EASE)){assert.equal(ease.length,4);assert.ok(ease[0]>=0&&ease[0]<=1&&ease[2]>=0&&ease[2]<=1);}
 for(const spring of Object.values(SPRING)){assert.ok(spring.stiffness>0&&spring.damping>0&&spring.mass>0);}
});
test('useMotionSafe preset always provides full smooth animations',()=>{
 const safe=getMotionPreset(true),full=getMotionPreset(false);
 assert.equal(safe.reduced,false);assert.equal(full.reduced,false);
 assert.equal(safe.duration(.22),.22);assert.equal(full.duration(.22),.22);
 assert.equal(safe.gesture.whileTap.scale,.97);assert.equal(full.gesture.whileTap.scale,.97);
 assert.equal(safe.panel.exit.opacity,0);assert.equal(safe.view.exit.y,-6);
});
test('count interpolation clamps progress and remains monotonic in both directions',()=>{
 assert.equal(interpolateCount(0,25,-1),0);assert.equal(interpolateCount(0,25,2),25);
 for(const[from,to]of[[0,123],[100,4]]){let last=from;for(let i=0;i<=100;i++){const value=interpolateCount(from,to,i/100);assert.ok(to>from?value>=last:value<=last);last=value;}assert.equal(last,to);}
});
test('tab direction has no initial/same-tab displacement',()=>{
 assert.equal(tabDirection(2,2),0);assert.equal(tabDirection(0,4),1);assert.equal(tabDirection(4,0),-1);
});
test('adaptive scene quality requires sustained slow frames and resets after recovery',()=>{
 let slow=0,result;for(let i=0;i<79;i++){result=nextQualitySample(slow,25);slow=result.slowMs;assert.equal(result.downgrade,false);}
 assert.equal(nextQualitySample(slow,25).downgrade,true);
 assert.equal(nextQualitySample(1500,16).slowMs,0);assert.equal(nextQualitySample(1500,900).downgrade,false);
});
test('non-browser preference read is safe',()=>{assert.equal(prefersReducedMotion(),false);});
test('generated CSS and JS timings remain synchronized',async()=>{
 const css=await readFile(new URL('../src/shared/motion/motion.css',import.meta.url),'utf8');
 for(const[key,value]of Object.entries(DURATION)){const name=key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());assert.ok(css.includes(`--dur-${name}: ${value}s;`));}
 assert.ok(!css.includes('prefers-reduced-motion'));
});
