import type {FastifyInstance} from 'fastify';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {random} from './store.js';
const token=process.env.INTERNAL_TOKEN!;
const rtsp=(path:string)=>'rtsp://service:'+token+'@mediamtx:8554/'+path;
const relays=new Map<string,{process:ChildProcessWithoutNullStreams;clients:Set<any>}>();
const fail=(message:string,status=400)=>Object.assign(new Error(message),{statusCode:status});
const baseArgs=['-hide_banner','-loglevel','error','-nostats','-threads','1'];
function attachRelay(reply:any,path:string,format:string){
 const key=path+':'+format;let relay=relays.get(key);
 // Every fragmented MP4 connection needs its own initialization header.
 if(format==='mp4')relay=undefined;
 if([...relays.values()].reduce((n,r)=>n+r.clients.size,0)>=40)throw fail('Direct playback is busy. Use the HLS URL.',503);
 const relayKey=format==='mp4'?key+':'+random():key;
 if(!relay){const p=spawn('ffmpeg',[...baseArgs,'-rtsp_transport','tcp','-timeout','10000000','-i',rtsp(path),'-map','0:v:0?','-map','0:a:0?','-c','copy',...(format==='mp4'?['-movflags','frag_keyframe+empty_moov+default_base_moof','-frag_duration','1000000']:['-mpegts_flags','resend_headers']),'-f',format==='mp4'?'mp4':'mpegts','pipe:1']);relay={process:p,clients:new Set()};relays.set(relayKey,relay);p.stdin.end();p.stderr.resume();const owned=relay;
 p.stdout.on('data',chunk=>{for(const client of owned.clients){if(client.writableLength>4*1024*1024)client.destroy();else client.write(chunk);}});const end=()=>{for(const c of owned.clients)c.end();relays.delete(relayKey)};p.on('exit',end);p.on('error',end);
 }
 reply.hijack();reply.raw.writeHead(200,{'Content-Type':format==='mp4'?'video/mp4':'video/mp2t','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no','Accept-Ranges':'none'});relay.clients.add(reply.raw);const owned=relay;
 reply.raw.on('close',()=>{owned.clients.delete(reply.raw);if(!owned.clients.size){owned.process.kill('SIGTERM');if(relays.get(relayKey)===owned)relays.delete(relayKey);}});
}
export async function registerMediaExtra(app:FastifyInstance){
 for(const format of ['mp4','ts'])app.get('/live.'+format,async(_req,reply)=>attachRelay(reply,'live',format));
}
