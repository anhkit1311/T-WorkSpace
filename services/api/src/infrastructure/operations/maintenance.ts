import {withTransaction} from '../database/db.js';
import {deleteObject} from '../../modules/files/storage.js';
export async function runMaintenance(workspaceId?:string){
  return withTransaction(async client=>{
    if(!(await client.query(`SELECT pg_try_advisory_xact_lock(778921403) AS locked`)).rows[0].locked)return {skipped:true};
    // Pending uploads retain a full day for a lost ACK/retry. Attached files are never removed here.
    const files=await client.query(`DELETE FROM message_attachments a WHERE ($1::uuid IS NULL OR EXISTS(SELECT 1 FROM channels c WHERE c.id=a.channel_id AND c.workspace_id=$1)) AND a.created_at<now()-interval '24 hours' AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM task_attachments t WHERE t.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM thesis_submissions s WHERE s.attachment_id=a.id)`,[workspaceId??null]);
    await client.query(`DELETE FROM email_otps WHERE expires_at<now()-interval '1 day'`);
    await client.query(`DELETE FROM refresh_sessions WHERE expires_at<now()-interval '7 days'`);
    await client.query(`DELETE FROM request_rate_limits WHERE window_start<now()-interval '1 day'`);
    await client.query(`DELETE FROM socket_io_attachments WHERE created_at<now()-interval '1 day'`);
    const queued=await client.query(`SELECT id,object_key FROM storage_cleanup WHERE next_attempt_at<=now() AND ($1::text IS NULL OR object_key LIKE 'workspaces/'||$1||'/%') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,[workspaceId??null]);
    for(const row of queued.rows){
      try{await deleteObject(row.object_key);await client.query(`DELETE FROM storage_cleanup WHERE id=$1`,[row.id]);}
      catch{await client.query(`UPDATE storage_cleanup SET attempts=attempts+1,next_attempt_at=now()+interval '1 hour' WHERE id=$1`,[row.id]);}
    }
    return {deletedPendingFiles:files.rowCount,processedObjects:queued.rowCount};
  });
}
export function startMaintenance(){
  let running=false;const tick=()=>{if(running)return;running=true;void runMaintenance().catch(error=>console.error(JSON.stringify({level:'error',event:'maintenance_error',message:error.message}))).finally(()=>{running=false;});};
  const timer=setInterval(tick,600000);timer.unref();return ()=>clearInterval(timer);
}
