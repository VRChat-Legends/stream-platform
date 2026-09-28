import Database from 'better-sqlite3';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import fs from 'node:fs';
import argon2 from 'argon2';
import {z} from 'zod';
fs.mkdirSync('/data/uploads',{recursive:true});
export const db=new Database('/data/stream.db');
db.pragma('journal_mode = WAL');
db.exec('DROP TABLE IF EXISTS guests');
db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY,time TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audience (time INTEGER PRIMARY KEY,count INTEGER NOT NULL);`);
export const get=(key:string):any=>{const row=db.prepare('SELECT value FROM kv WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):null;};
export const put=(key:string,value:unknown)=>db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run(key,JSON.stringify(value));
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const random=()=>randomBytes(24).toString('hex');
const encryptionKey=Buffer.from(process.env.ENCRYPTION_KEY||'','hex');
if(encryptionKey.length!==32||!process.env.INTERNAL_TOKEN||!process.env.ADMIN_PASSWORD)throw new Error('Deployment secrets are required');
export function seal(value:string){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',encryptionKey,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data]).toString('base64');}
export function unseal(value:string){const b=Buffer.from(value,'base64');const d=createDecipheriv('aes-256-gcm',encryptionKey,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();}
export function newKey(){const key=random();put('streamKey',{hash:hash(key),encrypted:seal(key)});return key;}
export const key=()=>unseal(get('streamKey').encrypted);
export const log=(event:string,detail:string='')=>{db.prepare('INSERT INTO logs(time,event,detail) VALUES (?,?,?)').run(new Date().toISOString(),event,detail.replace(/(?:guest-)?ingest\/[a-f0-9]+/g,'ingest/[redacted]'));db.prepare('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 1000)').run();};
export const settingsSchema=z.object({
 title:z.string().min(1).max(100),description:z.string().max(2000),nowPlaying:z.string().max(200),
 offlineMessage:z.string().max(300),nextStream:z.string().max(80),
 showViewerCount:z.boolean(),showVrchatCard:z.boolean(),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),
 graceSeconds:z.number().int().min(0).max(30),
 resolution:z.enum(['1920x1080','1280x720']),bitrate:z.number().int().min(1500).max(6000),
 hlsVariant:z.enum(['mpegts','lowLatency']),hlsSegmentDuration:z.number().int().min(1).max(6),hlsSegmentCount:z.number().int().min(7).max(20),
 fallbackEnabled:z.boolean(),logo:z.string().regex(/^(|\/uploads\/[a-f0-9]+\.png)$/),offlineImage:z.string().regex(/^(|\/uploads\/[a-f0-9]+\.png)$/)
});
export const defaults={title:'VRChat Legends Live',description:'Live from our community. Stay for the next moment.',nowPlaying:'',offlineMessage:'The next live moment starts here.',nextStream:'',showViewerCount:true,showVrchatCard:true,accent:'#7C5CFF',graceSeconds:5,resolution:'1920x1080' as const,bitrate:4500,hlsVariant:'mpegts' as const,hlsSegmentDuration:2,hlsSegmentCount:7,fallbackEnabled:true,logo:'',offlineImage:''};
export const settings=()=>({...defaults,...get('settings')});
export async function initialize(){
 if(!get('admin'))put('admin',{username:process.env.ADMIN_USERNAME||'admin',password:await argon2.hash(process.env.ADMIN_PASSWORD!)});
 if(!get('streamKey'))newKey();
 if(!get('settings'))put('settings',defaults);
}
