import '@fontsource/inter/400.css'; import '@fontsource/inter/500.css'; import '@fontsource/inter/600.css'; import '@fontsource/inter/700.css'; import '@fontsource/jetbrains-mono/400.css';
import React,{useEffect,useState,lazy,Suspense} from 'react';import {createRoot} from 'react-dom/client';import {api,type Status} from './api';import './style.css';
import {Chat} from './Chat';import './extras.css';
const Viewer=lazy(()=>import('./Viewer').then(m=>({default:m.Viewer})));const Studio=lazy(()=>import('./Studio').then(m=>({default:m.Studio})));
function App(){const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(false);useEffect(()=>{const refresh=()=>api('/api/status').then(s=>{setStatus(s);setError(false)}).catch(()=>setError(true));void refresh();const timer=setInterval(refresh,5000);return()=>clearInterval(timer)},[]);
 const studio=location.hostname.startsWith('studio.')||location.pathname==='/admin';if(studio)return <Studio status={status}/>;
 if(!status)return <div className="loading"><h1>VRChat Legends</h1><p>{error?'The stream server is reconnecting. Retrying automatically.':'Connecting to the stream…'}</p></div>;
 return <Viewer status={status} embed={location.pathname==='/embed'}/>}
function Router(){if(location.pathname==='/chat/overlay')return <Chat overlay/>;if(location.pathname==='/chat')return <div className="chat-popout"><Chat/></div>;return <App/>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<div className="loading">Loading…</div>}><Router/></Suspense></React.StrictMode>);
