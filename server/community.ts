import type {FastifyInstance} from 'fastify';
import {createHash} from 'node:crypto';
import {db,hash,random,log} from './store.js';
import {z} from 'zod';

const watchHost=process.env.WATCH_HOST||'watch.vrchatlegends.com';
const callback='https://'+watchHost+'/auth/callback';
const origins=new Set([watchHost,process.env.STUDIO_HOST||'studio.vrchatlegends.com'].map(h=>'https://'+h));
db.exec(`CREATE TABLE IF NOT EXISTS community_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, binding TEXT NOT NULL, verifier TEXT NOT NULL, target TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, body TEXT NOT NULL, time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_bans (user_id TEXT PRIMARY KEY);`);
export function communitySession(req:any){const raw=req.cookies?.['__Host-community'];return raw?db.prepare('SELECT * FROM community_sessions WHERE hash=? AND expires>?').get(hash(raw),Date.now()) as any:null;}
export const communityAuth=async(req:any,reply:any)=>{const s=communitySession(req);if(!s)return reply.code(401).send({error:'Sign in with VRChat Legends to continue.'});if(!['GET','HEAD'].includes(req.method)&&(!origins.has(req.headers.origin)||req.headers['x-community-csrf']!==s.csrf))return reply.code(403).send({error:'Reload the page and try again.'});};
const peers=new Set<any>();
function broadcast(event:string,data:unknown){const payload='event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n';for(const p of peers){if(p.writableLength>1048576)p.destroy();else p.write(payload);}}
export const messages=()=>db.prepare('SELECT id,user_id AS userId,name,body,time FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse();
const fail=(message:string,status=400)=>Object.assign(new Error(message),{statusCode:status});
export async function registerCommunity(app:FastifyInstance,adminAuth:any){
 app.get('/auth/login',async(req,reply)=>{
  if(!process.env.OAUTH_CLIENT_SECRET)throw fail('Community sign-in is not configured.',503);
  const target='watch',state=random(),binding=random(),verifier=random()+random();
  db.prepare('INSERT INTO oauth_states VALUES (?,?,?,?,?)').run(hash(state),hash(binding),verifier,target,Date.now()+600000);
  reply.setCookie('__Host-oauth',binding,{path:'/',secure:true,httpOnly:true,sameSite:'lax',maxAge:600});
  const u=new URL('https://api.vrchatlegends.com/api/oauth2/authorize');u.search=new URLSearchParams({client_id:process.env.OAUTH_CLIENT_ID!,redirect_uri:callback,response_type:'code',scope:'identify',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return reply.redirect(u.href);
 });
 app.get('/auth/callback',async(req,reply)=>{
  const q=req.query as any;const state=typeof q.state==='string'?db.prepare('SELECT * FROM oauth_states WHERE hash=? AND expires>?').get(hash(q.state),Date.now()) as any:null;
  if(!state||state.binding!==hash(req.cookies['__Host-oauth']||''))throw fail('Sign-in expired or state did not match. Start sign-in again.');
  db.prepare('DELETE FROM oauth_states WHERE hash=?').run(hash(q.state));reply.clearCookie('__Host-oauth',{path:'/'});
  if(q.error||typeof q.code!=='string')throw fail('Sign-in was cancelled. You can try again.');
  const r=await fetch('https://api.vrchatlegends.com/api/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.OAUTH_CLIENT_ID+':'+process.env.OAUTH_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:q.code,redirect_uri:callback,client_id:process.env.OAUTH_CLIENT_ID!,code_verifier:state.verifier}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw fail('VRChat Legends could not finish sign-in. Please start again.');const t=await r.json() as any;
  const ur=await fetch('https://api.vrchatlegends.com/api/oauth2/userinfo',{headers:{Authorization:'Bearer '+t.access_token},signal:AbortSignal.timeout(10000)});
  if(!ur.ok)throw fail('VRChat Legends could not load your public identity.');const u=await ur.json() as any;
  const user=u.user||u;const id=String(user.sub||user.id||user.user_id||'');if(!id)throw fail('The identity response did not contain a user ID.');
  const name=String(user.display_name||user.displayName||user.name||user.username||'Legend').slice(0,80);
  const raw=random(),csrf=random();const expires=Date.now()+Math.min(604800,Math.max(60,Number(t.expires_in)||3600))*1000;
  db.prepare('INSERT INTO community_sessions VALUES (?,?,?,?,?)').run(hash(raw),id,name,csrf,expires);
  reply.setCookie('__Host-community',raw,{path:'/',secure:true,httpOnly:true,sameSite:'lax',maxAge:Math.floor((expires-Date.now())/1000)});log('Community sign-in');return reply.redirect('/');
 });
 app.get('/api/community/session',async req=>{const s=communitySession(req);return {user:s?{id:s.user_id,name:s.name}:null,csrf:s?.csrf,login:'https://'+watchHost+'/auth/login',callback};});
 app.post('/api/community/logout',{preHandler:communityAuth},async(req,reply)=>{db.prepare('DELETE FROM community_sessions WHERE hash=?').run(communitySession(req).hash);reply.clearCookie('__Host-community',{path:'/'});return {ok:true};});
 app.get('/api/chat/messages',async()=>({messages:messages()}));
 app.get('/api/chat/events',async(req,reply)=>{if(peers.size>=200)return reply.code(503).send({error:'Chat is busy. Please retry.'});reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});peers.add(reply.raw);reply.raw.write('event: snapshot\ndata: '+JSON.stringify(messages())+'\n\n');const heartbeat=setInterval(()=>reply.raw.write(': heartbeat\n\n'),15000);req.raw.on('close',()=>{peers.delete(reply.raw);clearInterval(heartbeat)});});
 app.post('/api/chat/messages',{preHandler:communityAuth,config:{rateLimit:{max:12,timeWindow:'1 minute'}}},async(req,reply)=>{const s=communitySession(req);if(db.prepare('SELECT 1 FROM chat_bans WHERE user_id=?').get(s.user_id))return reply.code(403).send({error:'Chat posting is disabled for this account.'});const body=z.object({body:z.string().trim().min(1).max(500)}).parse(req.body).body;const last=db.prepare('SELECT time FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 1').get(s.user_id) as any;if(last&&Date.now()-last.time<2000)throw fail('Please wait a moment before posting again.',429);const time=Date.now();const r=db.prepare('INSERT INTO chat_messages(user_id,name,body,time) VALUES (?,?,?,?)').run(s.user_id,s.name,body,time);const m={id:Number(r.lastInsertRowid),userId:s.user_id,name:s.name,body,time};broadcast('message',m);return m;});
 app.delete('/api/admin/chat/:id',{preHandler:adminAuth},async req=>{const id=Number((req.params as any).id);db.prepare('DELETE FROM chat_messages WHERE id=?').run(id);broadcast('delete',{id});log('Chat message removed');return {ok:true};});
 app.post('/api/admin/chat/ban',{preHandler:adminAuth},async req=>{const b=z.object({userId:z.string().min(1).max(200),banned:z.boolean()}).parse(req.body);if(b.banned)db.prepare('INSERT OR IGNORE INTO chat_bans VALUES (?)').run(b.userId);else db.prepare('DELETE FROM chat_bans WHERE user_id=?').run(b.userId);log(b.banned?'Chat account muted':'Chat account unmuted');return {ok:true};});
 app.get('/api/admin/chat/bans',{preHandler:adminAuth},async()=>db.prepare('SELECT user_id AS userId FROM chat_bans').all());
 app.post('/api/admin/chat/clear',{preHandler:adminAuth},async()=>{db.prepare('DELETE FROM chat_messages').run();broadcast('snapshot',[]);log('Chat cleared');return {ok:true};});
 setInterval(()=>{db.prepare('DELETE FROM community_sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM oauth_states WHERE expires<?').run(Date.now());db.prepare('DELETE FROM chat_messages WHERE time<? OR id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 1000)').run(Date.now()-7*86400000);db.prepare("DELETE FROM kv WHERE key LIKE 'exchange:%' AND json_extract(value,'$.expires')<?").run(Date.now());},60000);
}
