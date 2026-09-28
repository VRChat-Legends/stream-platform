import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import argon2 from 'argon2';
import {timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {z} from 'zod';
import {registerCommunity} from './community.js';
import {registerMediaExtra} from './media-extra.js';
import {registerDiscord} from './discord.js';
import {db,get,put,hash,random,key,newKey,log,settings,settingsSchema,initialize} from './store.js';
await initialize();
const run=promisify(execFile);
const token=process.env.INTERNAL_TOKEN!;
const streamHost=process.env.STREAM_HOST||'stream.vrchatlegends.com';
const watchHost=process.env.WATCH_HOST||'watch.vrchatlegends.com';
const studioHost=process.env.STUDIO_HOST||'studio.vrchatlegends.com';
const allowedOrigins=new Set([streamHost,watchHost,studioHost].map(h=>'https://'+h));
const equal=(a:string,b:string)=>{const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const app=Fastify({logger:false,trustProxy:['127.0.0.1','172.16.0.0/12'],bodyLimit:65536});
const internal=Fastify({logger:false,bodyLimit:65536});
await app.register(cookie);
await app.register(rateLimit,{max:300,timeWindow:'1 minute'});
await app.register(multipart,{limits:{fileSize:250*1024*1024,files:1,fields:1}});
await app.register(staticFiles,{root:path.resolve('dist'),prefix:'/',wildcard:false});
app.setErrorHandler((e:any,_req,reply)=>{const status=e.statusCode|| (e instanceof z.ZodError?400:500);reply.code(status).send({error:status>=500?'The request could not be completed. Check the event log.':e instanceof z.ZodError?'Please check the submitted values.':e.message});});
app.addHook('onRequest',async(req,reply)=>{
 reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','strict-origin-when-cross-origin');
 if(req.url.startsWith('/api/'))reply.header('Cache-Control','no-store');
 if(req.routeOptions.url?.startsWith('/api/admin/')){
  if(req.headers.host?.split(':')[0]!==studioHost)return reply.code(404).send({error:'Use the studio address.'});
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!allowedOrigins.has(String(req.headers.origin||'')))return reply.code(403).send({error:'Invalid request origin.'});
 }
});
function session(req:any){const raw=req.cookies.session;if(!raw)return null;return db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(hash(raw),Date.now()) as {hash:string,csrf:string,expires:number}|undefined;}
const auth=async(req:any,reply:any)=>{const s=session(req);if(!s)return reply.code(401).send({error:'Sign in to continue.'});if(!['GET','HEAD'].includes(req.method)&&!equal(String(req.headers['x-csrf-token']||''),s.csrf))return reply.code(403).send({error:'Session changed. Reload and try again.'});};
async function mtx(endpoint:string,body?:unknown){const r=await fetch('http://mediamtx:9997/v3/'+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Basic '+Buffer.from('service:'+token).toString('base64'),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error('Media server unavailable');const t=await r.text();return t?JSON.parse(t):{};}
async function patchMtx(endpoint:string,body:unknown){const r=await fetch('http://mediamtx:9997/v3/'+endpoint,{method:'PATCH',headers:{Authorization:'Basic '+Buffer.from('service:'+token).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error('Media configuration rejected');}
let source:any=null,livePath:any=null,startedAt:string|null=null,incomingKbps=0,lastBytes=0,lastSample=Date.now(),mediaOnline=false;
let program:any={ready:false,source:'fallback',speed:0,cpu:0,updatedAt:0};
const viewers=new Map<string,number>();
let synced=false;
async function sample(){
 try{
  const data=await mtx('paths/list'); const items=data.items||[];
  const currentPath='ingest/'+key();for(const p of items)if(p.name.startsWith('ingest/')&&p.name!==currentPath&&p.source?.type==='rtmpConn')await mtx('rtmpconns/kick/'+encodeURIComponent(p.source.id),{});const next=items.find((p:any)=>p.name===currentPath&&(p.ready||p.online));
  livePath=items.find((p:any)=>p.name==='live');mediaOnline=!!livePath?.available;viewers.clear();for(const reader of livePath?.readers||[])if(reader.type==='hlsSession')viewers.set(reader.id,Date.now());
  if(next&&!source){startedAt=new Date().toISOString();log('Publisher connected');}
  if(!next&&source){log('Publisher disconnected',startedAt?'Session lasted '+Math.round((Date.now()-Date.parse(startedAt))/1000)+' seconds':'');startedAt=null;}
  const now=Date.now();incomingKbps=next&&source?Math.max(0,Math.round(((next.inboundBytes||next.bytesReceived||0)-lastBytes)*8/(now-lastSample))):0;lastBytes=next?.inboundBytes||next?.bytesReceived||0;lastSample=now;source=next||null;
  if(!synced){const s=settings();await patchMtx('config/global/patch',{hlsVariant:s.hlsVariant,hlsSegmentDuration:s.hlsSegmentDuration+'s',hlsSegmentCount:s.hlsSegmentCount});synced=true;}
 }catch{mediaOnline=false;source=null;startedAt=null;}
 for(const [v,t]of viewers)if(Date.now()-t>30000)viewers.delete(v);
}
setInterval(()=>void sample(),2000);
setInterval(()=>{db.prepare('INSERT OR REPLACE INTO audience VALUES (?,?)').run(Math.floor(Date.now()/60000)*60000,viewers.size);db.prepare('DELETE FROM audience WHERE time<?').run(Date.now()-86400000);db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());},60000);
const urls=()=>({watch:'https://'+watchHost,studio:'https://'+studioHost,rtmp:'rtmp://'+streamHost+':1935/ingest',mp4:'https://'+streamHost+'/live.mp4',ts:'https://'+streamHost+'/live.ts',hls:'https://'+streamHost+'/live/index.m3u8',short:'https://'+streamHost+'/live.m3u8',redirect:'https://'+streamHost+'/vrc/live',rtsp:'rtspt://'+streamHost+':8554/live',embed:'<iframe src="https://'+watchHost+'/embed" width="1280" height="720" allow="autoplay; fullscreen" allowfullscreen></iframe>'});
const status=()=>({...settings(),live:!!source,viewers:viewers.size,startedAt,pipelineReady:mediaOnline&&program.ready&&Date.now()-program.updatedAt<15000,programSource:program.source,urls:urls()});
app.get('/api/status',async()=>status());
app.get('/api/health',async()=>({mediaOnline,programFresh:Date.now()-program.updatedAt<15000}));
app.get('/vrc/live',async(_req,reply)=>reply.header('Cache-Control','no-store').redirect(urls().hls,302));
app.get('/live.m3u8',async(_req,reply)=>{
 const r=await fetch('http://mediamtx:8888/live/index.m3u8',{signal:AbortSignal.timeout(5000)});
 const raw=await r.text();const manifest=raw.split('\n').map(line=>line&&!line.startsWith('#')?new URL(line,urls().hls).href:line.replace(/URI="([^"]+)"/g,(_m,u)=>'URI="'+new URL(u,urls().hls).href+'"')).join('\n');
 return reply.code(r.status).header('Cache-Control','no-store').header('Access-Control-Allow-Origin','*').type('application/vnd.apple.mpegurl').send(manifest);
});
app.get('/uploads/:file',async(req,reply)=>{const name=(req.params as any).file;if(!/^[a-f0-9]+\.png$/.test(name))return reply.code(404).send();return reply.type('image/png').send(fs.createReadStream('/data/uploads/'+name));});
app.post('/api/admin/login',{config:{rateLimit:{max:5,timeWindow:'1 minute'}}},async(req,reply)=>{
 const {username,password}=z.object({username:z.string().max(100),password:z.string().max(256)}).parse(req.body);
 const admin=get('admin');const valid=await argon2.verify(admin.password,password);
 if(username!==admin.username||!valid)return reply.code(401).send({error:'Incorrect username or password.'});
 const raw=random(),csrf=random();db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(raw),csrf,Date.now()+43200000);
 log('Studio sign-in',req.ip);reply.setCookie('session',raw,{path:'/',httpOnly:true,secure:true,sameSite:'strict',maxAge:43200});return {csrf};
});
app.get('/api/admin/session',{preHandler:auth},async req=>({csrf:session(req)!.csrf,username:get('admin').username}));
app.post('/api/admin/logout',{preHandler:auth},async(req,reply)=>{db.prepare('DELETE FROM sessions WHERE hash=?').run(session(req)!.hash);reply.clearCookie('session',{path:'/'});return {ok:true};});
app.post('/api/admin/password',{preHandler:auth},async(req)=>{const p=z.object({current:z.string(),password:z.string().min(14).max(256)}).parse(req.body);const admin=get('admin');if(!await argon2.verify(admin.password,p.current))throw Object.assign(new Error('Current password is incorrect.'),{statusCode:400});put('admin',{...admin,password:await argon2.hash(p.password)});db.prepare('DELETE FROM sessions WHERE hash<>?').run(session(req)!.hash);log('Password changed');return {ok:true};});
app.get('/api/admin/stats',{preHandler:auth},async()=>({...status(),incomingKbps,tracks:source?.tracks||[],program,audience:db.prepare('SELECT * FROM audience ORDER BY time').all(),viewerCountNote:'Active HLS sessions reported by the media server. Separate player tabs count as separate sessions.'}));
app.get('/api/admin/credentials',{preHandler:auth},async()=>({server:urls().rtmp,key:key()}));
async function kick(){await sample();if(!source?.source)return;const types:Record<string,string>={rtmpConn:'rtmpconns',rtspSession:'rtspsessions'};const type=types[source.source.type];if(type)await mtx(type+'/kick/'+encodeURIComponent(source.source.id),{});source=null;startedAt=null;}
app.post('/api/admin/credentials/regenerate',{preHandler:auth},async()=>{await kick();const value=newKey();log('Stream key regenerated');return {key:value};});
app.post('/api/admin/kick',{preHandler:auth},async()=>{await kick();log('Publisher kicked');return {ok:true};});
app.get('/api/admin/settings',{preHandler:auth},async()=>settings());
app.put('/api/admin/settings',{preHandler:auth},async req=>{
 const s=settingsSchema.parse(req.body);const old=settings();
 if(s.hlsVariant!==old.hlsVariant||s.hlsSegmentCount!==old.hlsSegmentCount||s.hlsSegmentDuration!==old.hlsSegmentDuration)await patchMtx('config/global/patch',{hlsVariant:s.hlsVariant,hlsSegmentCount:s.hlsSegmentCount,hlsSegmentDuration:s.hlsSegmentDuration+'s'});
 put('settings',s);log('Settings updated');return s;
});
app.get('/api/admin/logs',{preHandler:auth},async()=>db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 100').all());
let restartRequested=0;
app.post('/api/admin/restart-media',{preHandler:auth},async()=>{
 const r=await fetch('http://mediamtx:9998/restart',{method:'POST',headers:{'x-internal-token':token},signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new Error('Media restart failed');synced=false;log('Media server restart requested');return {ok:true};
});
app.post('/api/admin/restart',{preHandler:auth},async()=>{restartRequested=Date.now();log('Program restart requested');return {ok:true};});
app.post('/api/admin/vrchat-test',{preHandler:auth},async()=>{
 const r=await fetch(urls().hls,{signal:AbortSignal.timeout(8000)});const master=await r.text();let playlist=master,base=urls().hls;
 if(master.includes('#EXT-X-STREAM-INF')){const next=master.split('\n').find(l=>l.trim()&&!l.startsWith('#'));if(next){base=new URL(next,base).href;playlist=await(await fetch(base,{signal:AbortSignal.timeout(8000)})).text();}}
 const segment=playlist.split('\n').find(l=>l.trim()&&!l.startsWith('#'));
 let segmentOk=false;if(segment){const sr=await fetch(new URL(segment,base),{signal:AbortSignal.timeout(8000)});segmentOk=sr.ok;await sr.body?.cancel();}
 let codecs:any={};try{const result=await run('ffprobe',['-v','error','-show_streams','-of','json','-read_intervals','%+3',urls().hls],{timeout:15000,maxBuffer:1024*1024});codecs=JSON.parse(result.stdout);}catch{}
 const tracks=codecs.streams||[];return {https:true,httpStatus:r.status,contentType:r.headers.get('content-type'),playlistValid:playlist.includes('#EXTM3U')&&!playlist.includes('#EXT-X-ENDLIST'),segmentOk,tracks:tracks.map((s:any)=>({codec:s.codec_name,type:s.codec_type,width:s.width,height:s.height,fps:s.r_frame_rate,profile:s.profile,bFrames:s.has_b_frames,sampleRate:s.sample_rate,channels:s.channels})),warnings:tracks.some((s:any)=>s.codec_type==='video'&&s.codec_name!=='h264')?['Video should be H.264.']:[],note:'Automated transport and codec check. Confirm playback inside your actual VRChat world.'};
});
let uploadBusy=false;
app.post('/api/admin/upload',{preHandler:auth,config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req,reply)=>{
 if(uploadBusy)return reply.code(409).send({error:'Another upload is being processed.'});
 uploadBusy=true;const id=random(),temp='/data/uploads/'+id+'.upload';
 try{
 const file=await req.file();if(!file)throw Object.assign(new Error('Choose a file.'),{statusCode:400});
 await pipeline(file.file,fs.createWriteStream(temp));if(file.file.truncated)throw Object.assign(new Error('File exceeds 250 MB.'),{statusCode:413});
 const type=String((req.query as any).type||'fallback');
 if(type==='fallback'){
 const info=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',temp],{timeout:15000})).stdout);
 if(!info.streams.some((s:any)=>s.codec_type==='video')||Number(info.format.duration)>600)throw Object.assign(new Error('Use a video no longer than 10 minutes.'),{statusCode:400});
 const hasAudio=info.streams.some((s:any)=>s.codec_type==='audio');const s=settings();const [w,h]=s.resolution.split('x');const dest='/data/uploads/fallback.new.mp4';
 await run('ffmpeg',['-v','error','-y','-threads','1','-i',temp,...(hasAudio?[]:['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']),'-map','0:v:0','-map',hasAudio?'0:a:0':'1:a:0','-vf',`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`,'-c:v','libx264','-threads','1','-preset','veryfast','-profile:v','high','-b:v',s.bitrate+'k','-g','60','-bf','0','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-shortest','-movflags','+faststart',dest],{timeout:900000,maxBuffer:1024*1024});
 fs.renameSync(dest,'/data/uploads/fallback.mp4');log('Fallback video updated');return {ok:true};
 }
 if(!['logo','offlineImage'].includes(type))throw Object.assign(new Error('Unknown upload type.'),{statusCode:400});
 if(!['image/png','image/jpeg','image/webp'].includes(file.mimetype))throw Object.assign(new Error('Use PNG, JPEG or WebP.'),{statusCode:400});
 await run('ffmpeg',['-v','error','-y','-i',temp,'-vf','scale=1280:720:force_original_aspect_ratio=decrease','-frames:v','1','/data/uploads/'+id+'.png'],{timeout:30000});
 put('settings',{...settings(),[type]:'/uploads/'+id+'.png'});log('Image updated',type);return {ok:true,url:'/uploads/'+id+'.png'};
 }finally{uploadBusy=false;fs.rmSync(temp,{force:true});}
});
const internalAuth=async(req:any,reply:any)=>{if(!equal(String(req.headers['x-internal-token']||''),token))return reply.code(403).send();};
internal.post('/internal/auth',async(req,reply)=>{
 const b=req.body as any;const service=b.user==='service'&&equal(String(b.password||''),token);
 if(service&&['read','api'].includes(b.action))return {};
 if(service&&b.action==='publish'&&b.path==='live')return {};
 if(b.action==='read'&&b.path==='live'){
  return {};
 }
 if(b.action==='publish'&&b.protocol==='rtmp'&&/^ingest\/[a-f0-9]{48}$/.test(b.path||'')&&equal(hash(b.path.slice(7)),get('streamKey').hash)){log('Publisher authorized',String(b.ip||''));return {};}
 return reply.code(401).send();
});
internal.get('/internal/program',{preHandler:internalAuth},async()=>({key:key(),connected:!!source,settings:settings(),restartRequested}));
internal.post('/internal/program',{preHandler:internalAuth},async(req)=>{const b=req.body as any;program={ready:!!b.ready,source:b.source==='obs'?'obs':'fallback',speed:Number(b.speed)||0,cpu:Number(b.cpu)||0,frames:Number(b.frames)||0,restarts:Number(b.restarts)||0,updatedAt:Date.now()};return {};});
internal.post('/internal/viewer',{preHandler:internalAuth},async(req)=>{const b=req.body as any;if(typeof b.ip==='string')viewers.set(hash(b.ip+'|'+String(b.ua||'')).slice(0,24),Date.now());return {};});
internal.post('/internal/event',{preHandler:internalAuth},async(req)=>{const b=req.body as any;log(String(b.event||'Program event').slice(0,100),String(b.detail||'').slice(0,300));return {};});
await registerCommunity(app,auth);
await registerMediaExtra(app);
await registerDiscord(app,auth,status);
for(const route of ['/admin','/embed','/chat','/chat/overlay'])app.get(route,async(_r,reply)=>reply.sendFile('index.html'));
await internal.listen({port:3001,host:'0.0.0.0'});
await app.listen({port:3000,host:'0.0.0.0'});
log('Application started');
