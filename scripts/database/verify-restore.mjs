import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream,createReadStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import pg from 'pg';
import {config} from '../../dist/api/config/config.js';
const token=randomUUID().replaceAll('-',''),names=[`qa_migrate_${token}`,`qa_restore_${token}`];
const admin=new pg.Pool({connectionString:config.databaseUrl});let source,restored;
function run(command,args,options={}){const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],...options});let errors='',output='';child.stderr.on('data',part=>{errors+=part.toString();});child.stdout.on('data',part=>{output+=part.toString();});return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(new Error(`${command} exited ${code}: ${errors}`)));});}
function connection(name){const url=new URL(config.databaseUrl);url.pathname=`/${name}`;return url.toString();}
try{
 for(const name of names){if(!/^qa_(migrate|restore)_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe database name');await admin.query(`CREATE DATABASE "${name}"`);}
 const runners=await Promise.all([1,2].map(()=>run(process.execPath,['dist/api/scripts/migrate.js'],{env:{...process.env,DATABASE_URL:connection(names[0])}})));
 source=new pg.Pool({connectionString:connection(names[0])});
 const id=randomUUID(),workspace=randomUUID(),channel=randomUUID(),message=randomUUID();
 await source.query('BEGIN');
 await source.query(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,'restore-qa@example.test','test-only','Restore QA',true)`,[id]);
 await source.query(`INSERT INTO workspaces(id,name,slug,owner_id) VALUES($1,'Restore QA',$2,$3)`,[workspace,workspace,id]);
 await source.query(`INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`,[workspace,id]);
 await source.query(`INSERT INTO channels(id,workspace_id,created_by,name,type) VALUES($1,$2,$3,'tong-quan','text')`,[channel,workspace,id]);
 await source.query(`INSERT INTO messages(id,channel_id,author_id,content) VALUES($1,$2,$3,'Khôi phục tiếng Việt')`,[message,channel,id]);
 await source.query('COMMIT');
 await mkdir('docs/evidence',{recursive:true});
 const container=process.env.POSTGRES_CONTAINER??'infra-postgres-1';
 const dump=spawn('docker',['exec',container,'pg_dump','-U','workspace','--format=c','--no-owner',names[0]],{stdio:['ignore','pipe','pipe']});
 let dumpErrors='';dump.stderr.on('data',part=>{dumpErrors+=part.toString();});const dumpDone=new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('exit',code=>code===0?resolve():reject(new Error(dumpErrors)));});
 await Promise.all([pipeline(dump.stdout,createWriteStream('docs/evidence/restore-qa.dump')),dumpDone]);
 const restore=spawn('docker',['exec','-i',container,'pg_restore','-U','workspace','--no-owner','--exit-on-error','-d',names[1]],{stdio:['pipe','ignore','pipe']});
 let restoreErrors='';restore.stderr.on('data',part=>{restoreErrors+=part.toString();});const restoreDone=new Promise((resolve,reject)=>{restore.on('error',reject);restore.on('exit',code=>code===0?resolve():reject(new Error(restoreErrors)));});
 await Promise.all([pipeline(createReadStream('docs/evidence/restore-qa.dump'),restore.stdin),restoreDone]);
 restored=new pg.Pool({connectionString:connection(names[1])});
 const count=(await restored.query(`SELECT count(*)::integer AS count FROM schema_migrations`)).rows[0].count;
 const restoredMessage=(await restored.query(`SELECT content FROM messages WHERE id=$1`,[message])).rows[0]?.content;
 if(count!==20||restoredMessage!=='Khôi phục tiếng Việt')throw new Error('Restored data/schema mismatch');
 const report={timestamp:new Date().toISOString(),node:process.version,postgres:(await source.query('SHOW server_version')).rows[0].server_version,migrationCount:count,concurrentRunners:runners.map(text=>({applied:text.split('\n').filter(line=>line.startsWith('applied')).length,skipped:text.split('\n').filter(line=>line.startsWith('skip')).length})),restore:{schemaCount:count,messageVerified:true},scope:'Two newly created QA databases only; no production backup claim'};
 await writeFile('docs/evidence/restore-2026-10-01.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 await source?.end();await restored?.end();
 for(const name of names)if(/^qa_(migrate|restore)_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
 await admin.end();
}
