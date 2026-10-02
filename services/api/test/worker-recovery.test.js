import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {roomManager} from '../../../dist/api/modules/meetings/media/room-manager.js';
test('Worker pool isolates failure and replaces worker on next join',{skip:process.env.RUN_SFU_TESTS!=='1',timeout:15000},async()=>{
 try{
  await roomManager.joinRoom('worker-room-a','peer-a','user-a','QA A');
  await roomManager.joinRoom('worker-room-b','peer-b','user-b','QA B');
  const metrics=roomManager.metrics();assert.equal(metrics.workers,2);assert.deepEqual(metrics.workerRooms.map(w=>w.rooms),[1,1]);
  const failed=once(roomManager.events,'media_failure');process.kill(metrics.workerRooms[0].pid,'SIGKILL');
  const [failure]=await failed;assert.equal(failure.roomId,'worker-room-a');assert.equal(roomManager.getPeer('worker-room-a','peer-a'),undefined);assert.ok(roomManager.getPeer('worker-room-b','peer-b'));
  await roomManager.joinRoom('worker-room-c','peer-c','user-c','QA C');assert.equal(roomManager.metrics().workers,2);assert.ok(roomManager.getPeer('worker-room-c','peer-c'));
  assert.equal((await roomManager.resourceUsage()).length,2);
 }finally{roomManager.close();}
});
