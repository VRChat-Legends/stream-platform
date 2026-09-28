import {useEffect,useRef,useState} from 'react';
import Hls from 'hls.js';
import QRCode from 'qrcode';
import {Copy,Check,Eye,EyeOff,Maximize2} from 'lucide-react';
export function Brand({logo}:{logo?:string}){return <a className="brand" href="/">{logo&&<img src={logo} alt=""/>}<span>VRChat <b>Legends</b></span></a>}
export function CopyField({label,value,secret=false,qr=false}:{label:string;value:string;secret?:boolean;qr?:boolean}){
 const [copied,setCopied]=useState(false),[visible,setVisible]=useState(!secret),[code,setCode]=useState('');
 async function copy(){await navigator.clipboard.writeText(value);setCopied(true);setTimeout(()=>setCopied(false),1800)}
 return <div className="copy-field"><label>{label}</label><div className="copy-row"><input aria-label={label} readOnly value={value} type={visible?'text':'password'}/>{secret&&<button className="icon-button" aria-label={visible?'Hide key':'Reveal key'} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button>}<button onClick={()=>void copy()}><span aria-hidden>{copied?<Check size={16}/>:<Copy size={16}/>}</span>{copied?'Copied':'Copy'}</button>{qr&&<button className="secondary" onClick={()=>void QRCode.toDataURL(value,{width:240,margin:2}).then(setCode)}>QR</button>}</div>{code&&<dialog open className="qr-dialog"><img src={code} alt={'QR code for '+label}/><button onClick={()=>setCode('')}>Close</button></dialog>}</div>
}
export function Player({src,compact=false,poster}:{src:string;compact?:boolean;poster?:string}){
 const ref=useRef<HTMLVideoElement>(null),wrap=useRef<HTMLDivElement>(null);const [error,setError]=useState(false);
 useEffect(()=>{
 const video=ref.current!;let hls:Hls|undefined;let timer:ReturnType<typeof setTimeout>;let disposed=false;
 const recover=()=>{setError(true);clearTimeout(timer);timer=setTimeout(()=>{if(!disposed){if(hls)hls.startLoad();else video.load();void video.play().catch(()=>{});}},3000)};
 if(Hls.isSupported()){hls=new Hls({liveSyncDurationCount:3,maxLiveSyncPlaybackRate:1.1});hls.on(Hls.Events.MEDIA_ATTACHED,()=>hls?.loadSource(src));hls.on(Hls.Events.MANIFEST_PARSED,()=>{video.muted=true;void video.play().catch(()=>{})});hls.attachMedia(video);hls.on(Hls.Events.ERROR,(_e,d)=>{if(d.fatal){if(d.type===Hls.ErrorTypes.MEDIA_ERROR)hls?.recoverMediaError();else recover();}});}
 else{video.src=src;video.addEventListener('error',recover);}
 video.addEventListener('playing',()=>setError(false));void video.play().catch(()=>{});
 return()=>{disposed=true;clearTimeout(timer);hls?.destroy();video.removeEventListener('error',recover);};
 },[src]);
 return <div className={'player '+(compact?'compact':'')} ref={wrap}><video ref={ref} controls autoPlay muted playsInline poster={poster}/>{error&&<div className="player-error"><strong>Reconnecting to the stream</strong><span>Playback will resume automatically.</span></div>}{!compact&&<button className="theater secondary" onClick={()=>wrap.current?.classList.toggle('expanded')}><Maximize2 size={15}/>Theater mode</button>}</div>;
}
export function VrchatHelp(){return <div className="help"><p>Use an <strong>AVPro</strong> video player for live streams. Unity video players may not support live HLS.</p><ol><li>Open VRChat’s settings and find <strong>Allow Untrusted URLs</strong> under safety settings.</li><li>Enable it, then paste the HLS URL into your world’s video player.</li><li>Enable live streams in the world’s player if it has that option.</li></ol><p>HLS plays a few seconds behind the broadcast. RTSP over TCP can reduce the delay in compatible AVPro players.</p></div>}
export const vrcMessage='To watch VRChat Legends, enable Allow Untrusted URLs in your VRChat safety settings, then paste https://stream.vrchatlegends.com/live.m3u8 into an AVPro video player.';
