import test from 'node:test';
import assert from 'node:assert/strict';
import {toastDuration, shouldResetProfile, meetingShortcut, beforeTaskAt, withPending} from '../src/shared/lib/interaction.ts';

test('toast durations give readers time for warnings and information', () => {
  assert.equal(toastDuration('success'), 4000);
  assert.equal(toastDuration('info'), 5000);
  assert.equal(toastDuration('warning'), 8000);
  assert.equal(toastDuration('error'), 8000);
});
test('meeting shortcuts never intercept typing, dialogs, modifiers, or repeated keys', () => {
  assert.equal(meetingShortcut({key:'M'}, false, false), 'm');
  for (const e of [{key:'m',ctrlKey:true},{key:'m',repeat:true},{key:'m',defaultPrevented:true}]) assert.equal(meetingShortcut(e,false,false),null);
  assert.equal(meetingShortcut({key:'m'},true,false),null);
  assert.equal(meetingShortcut({key:'Escape'},false,true),null);
  assert.equal(meetingShortcut({key:'x'},false,false),null);
});
test('Kanban insertion follows card midpoints, excludes dragged card, and supports empty columns', () => {
  const items = [{id:'a',top:100,height:40},{id:'b',top:150,height:80},{id:'c',top:250,height:40}];
  assert.equal(beforeTaskAt(items,110,'a'),'b');
  assert.equal(beforeTaskAt(items,200,'a'),'c');
  assert.equal(beforeTaskAt(items,300,'a'),null);
  assert.equal(beforeTaskAt([],0,'a'),null);
});
test('background profile refresh preserves dirty drafts; switching accounts resets', () => {
  assert.equal(shouldResetProfile('a','a',true),false);
  assert.equal(shouldResetProfile('a','a',false),true);
  assert.equal(shouldResetProfile('a','b',true),true);
});
test('OTP resend settles after success and failure and can run twice', async () => {
  const states=[];
  await withPending(async()=>{}, value=>states.push(value));
  await assert.rejects(withPending(async()=>{throw Error('offline')}, value=>states.push(value)));
  await withPending(async()=>{}, value=>states.push(value));
  assert.deepEqual(states,[true,false,true,false,true,false]);
});
