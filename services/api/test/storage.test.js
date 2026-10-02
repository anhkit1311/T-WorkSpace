import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Buffer} from 'node:buffer';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {pool} from '../../../dist/api/infrastructure/database/db.js';
import {config} from '../../../dist/api/config/config.js';
import {createWorkspace,getWorkspaceChannels,saveMessage} from '../../../dist/api/modules/workspaces/service.js';
import {uploadFile,downloadFile} from '../../../dist/api/modules/files/service.js';
import {validateFile,cleanFileName} from '../../../dist/api/modules/files/validation.js';
import {runMaintenance} from '../../../dist/api/infrastructure/operations/maintenance.js';
test('File signatures reject spoofed type and unsafe names',()=>{
 validateFile(Buffer.from('Tiếng Việt'),'text/plain');
 validateFile(Buffer.from([137,80,78,71,13,10,26,10]),'image/png');
 assert.throws(()=>validateFile(Buffer.from('<script>'),'image/png'),{code:'INVALID_SIGNATURE'});
 assert.throws(()=>validateFile(Buffer.from([255,0]),'text/plain'),{code:'INVALID_SIGNATURE'});
 assert.equal(cleanFileName('a%2Fb%5Cc%0A.txt'),'a_b_c_.txt');
});
test('DB and S3 protocol: permission, quota, orphan cleanup and durable retry queue',{skip:process.env.RUN_DB_TESTS!=='1',timeout:20000},async()=>{
 const owner=randomUUID(),outsider=randomUUID(),objects=new Map();let workspace,server,failDelete=false;
 const quota=config.userFileQuotaBytes;
 try{
  for(const id of [owner,outsider])await pool.query(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test','Storage QA',true)`,[id,`storage-${id}@example.test`]);
  workspace=await createWorkspace(owner,'Storage QA');const channel=(await getWorkspaceChannels(owner,workspace.id)).find(c=>c.type==='text');
  process.env.FILE_STORAGE_PROVIDER='db';
  config.userFileQuotaBytes=3;await assert.rejects(uploadFile(owner,channel.id,'qa.txt','text/plain',Buffer.from('test')),{code:'USER_QUOTA_EXCEEDED'});config.userFileQuotaBytes=quota;
  const file=await uploadFile(owner,channel.id,'qa.txt','text/plain',Buffer.from('test'));
  await saveMessage(owner,channel.id,'File',{attachmentId:file.id});assert.equal((await downloadFile(owner,file.id)).data.toString(),'test');
  await assert.rejects(downloadFile(outsider,file.id),{statusCode:404});
  const pending=await uploadFile(owner,channel.id,'pending.txt','text/plain',Buffer.from('pending'));
  await pool.query(`UPDATE message_attachments SET created_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])`,[[file.id,pending.id]]);await runMaintenance(workspace.id);
  assert.equal((await pool.query(`SELECT id FROM message_attachments WHERE id=$1`,[pending.id])).rowCount,0);assert.equal((await downloadFile(owner,file.id)).data.toString(),'test');
  server=createServer(async(req,res)=>{
   const key=req.url.split('?')[0];
   if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);objects.set(key,Buffer.concat(chunks));res.setHeader('ETag','"qa"');res.end();}
   else if(req.method==='GET'){const value=objects.get(key);if(!value){res.statusCode=404;res.end();}else{res.setHeader('Content-Length',value.length);res.end(value);}}
   else if(req.method==='DELETE'){if(failDelete){res.statusCode=503;res.end();}else{objects.delete(key);res.statusCode=204;res.end();}}
   else{res.statusCode=405;res.end();}
  });server.listen(0,'127.0.0.1');await once(server,'listening');
  process.env.S3_ENDPOINT=`http://127.0.0.1:${server.address().port}`;process.env.S3_BUCKET='qa';process.env.S3_REGION='us-east-1';process.env.S3_FORCE_PATH_STYLE='true';process.env.AWS_ACCESS_KEY_ID='qa-local';process.env.AWS_SECRET_ACCESS_KEY='qa-local';process.env.FILE_STORAGE_PROVIDER='s3';
  const remote=await uploadFile(owner,channel.id,'remote.txt','text/plain',Buffer.from('remote'));
  await saveMessage(owner,channel.id,'Object',{attachmentId:remote.id});assert.equal((await downloadFile(owner,remote.id)).data.toString(),'remote');
  const unused=await uploadFile(owner,channel.id,'unused.txt','text/plain',Buffer.from('unused'));
  const key=(await pool.query(`SELECT object_key FROM message_attachments WHERE id=$1`,[unused.id])).rows[0].object_key;
  await pool.query(`DELETE FROM message_attachments WHERE id=$1`,[unused.id]);
  failDelete=true;await runMaintenance(workspace.id);assert.equal((await pool.query(`SELECT attempts FROM storage_cleanup WHERE object_key=$1`,[key])).rows[0].attempts,1);
  failDelete=false;await pool.query(`UPDATE storage_cleanup SET next_attempt_at=now() WHERE object_key=$1`,[key]);await runMaintenance(workspace.id);assert.equal((await pool.query(`SELECT id FROM storage_cleanup WHERE object_key=$1`,[key])).rowCount,0);assert.equal(objects.size,1);
 }finally{
  config.userFileQuotaBytes=quota;
  if(workspace){await pool.query(`DELETE FROM workspaces WHERE id=$1`,[workspace.id]);await pool.query(`DELETE FROM storage_cleanup WHERE object_key LIKE $1`,[`workspaces/${workspace.id}/%`]);}
  await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[[owner,outsider]]);await pool.end();if(server)await new Promise(resolve=>server.close(resolve));
 }
});
