import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {URL} from 'node:url';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {io} from 'socket.io-client';
process.env.JWT_SECRET='distributed-test-secret-at-least-32-characters';
import {pool} from '../../../dist/api/infrastructure/database/db.js';
import {createAccessToken} from '../../../dist/api/modules/auth/tokens.js';
import {createWorkspace,addWorkspaceMember,getWorkspaceChannels} from '../../../dist/api/modules/workspaces/service.js';
test('Two API processes: chat dedup, task, notifications, presence and revoked private access',{skip:process.env.RUN_DB_TESTS!=='1',timeout:30000},async()=>{
 const users=[randomUUID(),randomUUID()],children=[],sockets=[],instanceIds=[randomUUID(),randomUUID()];let workspace;
 try{
  for(const id of users)await pool.query(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Cluster QA',true)`,[id,`cluster-${id}@example.test`]);
  workspace=await createWorkspace(users[0],'Cluster QA');await addWorkspaceMember(workspace.id,users[1]);
  const channel=(await getWorkspaceChannels(users[0],workspace.id)).find(c=>c.type==='text');
  const addresses=[];
  for(let index=0;index<2;index++){
   const child=fork(new URL('./helpers/api-process.mjs',import.meta.url),[],{env:{...process.env,API_INSTANCE_ID:instanceIds[index],SOCKET_ADAPTER:'postgres',SOCKET_CHANNEL_PREFIX:`qa-${workspace.id}`,DB_POOL_MAX:'4'},stdio:['ignore','pipe','pipe','ipc']});children.push(child);
   let errors='';child.stderr.on('data',value=>{errors+=value.toString();});
   const ready=await Promise.race([once(child,'message'),once(child,'exit').then(()=>{throw new Error(errors||'Child exited');})]);addresses.push(`http://127.0.0.1:${ready[0].port}`);
  }
  const tokens=await Promise.all(users.map(createAccessToken));
  for(let index=0;index<2;index++){const socket=io(addresses[index],{auth:{token:tokens[index]},transports:['websocket'],reconnection:false});sockets.push(socket);await once(socket,'connect');}
  const received=[];sockets[1].on('new_message',message=>received.push(message));
  const notification=once(sockets[1],'notifications_changed');
  const clientMessageId=randomUUID(),payload={channelId:channel.id,content:'Tin xuyên tiến trình',clientMessageId,mentionedUserIds:[users[1]]};
  const first=await sockets[0].timeout(5000).emitWithAck('send_message',payload);assert.equal(first.success,true);await notification;
  const retry=await sockets[0].timeout(5000).emitWithAck('send_message',payload);assert.equal(retry.message.id,first.message.id);await delay(100);assert.equal(received.length,1);
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM socket_presence WHERE user_id=ANY($1::uuid[]) AND expires_at>now()`,[users])).rows[0].count,2);
  const taskChanged=once(sockets[1],'task_changed');
  const taskResponse=await fetch(`${addresses[0]}/api/channels/${channel.id}/tasks`,{method:'POST',headers:{Authorization:`Bearer ${tokens[0]}`,'Content-Type':'application/json'},body:JSON.stringify({title:'Cluster task',clientTaskId:randomUUID()})});assert.equal(taskResponse.status,201);await taskChanged;
  const voice=(await getWorkspaceChannels(users[0],workspace.id)).find(c=>c.type==='video');
  if(process.env.RUN_SFU_TESTS==='1'){
   const primary=await sockets[0].timeout(10000).emitWithAck('join_meeting',{roomId:voice.id});assert.equal(primary.success,true);
   const other=io(addresses[1],{auth:{token:tokens[0]},transports:['websocket'],reconnection:false});sockets.push(other);await once(other,'connect');
   const misrouted=await other.timeout(10000).emitWithAck('join_meeting',{roomId:voice.id});assert.equal(misrouted.success,false);assert.match(misrouted.error,/media/);
  }
  const revoked=once(sockets[1],'access_revoked'),disconnected=once(sockets[1],'disconnect');
  const privacy=await fetch(`${addresses[0]}/api/workspaces/${workspace.id}/channels/manage/${channel.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${tokens[0]}`,'Content-Type':'application/json'},body:JSON.stringify({isPrivate:true})});
  if(privacy.status!==200)throw new Error(`Privacy ${privacy.status}: ${await privacy.text()}`);await revoked;await disconnected;
  const history=await fetch(`${addresses[1]}/api/channels/${channel.id}/messages`,{headers:{Authorization:`Bearer ${tokens[1]}`}});assert.equal(history.status,403);

 }finally{
  for(const socket of sockets)socket.disconnect();
  for(const child of children){if(child.exitCode===null){const exited=once(child,'exit');child.send('stop');await Promise.race([exited,delay(5000).then(()=>child.kill())]);}}
  await pool.query(`DELETE FROM socket_presence WHERE instance_id=ANY($1::text[])`,[instanceIds]);await pool.query(`DELETE FROM api_instances WHERE id=ANY($1::text[])`,[instanceIds]);
  if(workspace)await pool.query(`DELETE FROM workspaces WHERE id=$1`,[workspace.id]);await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await pool.end();
 }
});
