import assert from 'node:assert/strict';
const intervals=new Map();let intervalId=0,now=Date.now(),failOnce=true;
const requests=[],storage=new Map();
globalThis.window=new EventTarget();
globalThis.document=Object.assign(new EventTarget(),{cookie:'sf_csrf=fixture',hidden:false,hasFocus:()=>true,
  querySelectorAll:()=>[],documentElement:new EventTarget()});
globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
const originalDateNow=Date.now;Date.now=()=>now;
const originalSetInterval=globalThis.setInterval,originalClearInterval=globalThis.clearInterval;
globalThis.setInterval=fn=>{intervals.set(++intervalId,fn);return intervalId;};globalThis.clearInterval=id=>intervals.delete(id);
globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/config'))return {ok:true,json:async()=>({enabled:true,performanceSampleRate:0})};
  requests.push(JSON.parse(options.body));
  if(failOnce){failOnce=false;throw new Error('temporary network error');}
  return {ok:true};
};
const {beginAnalytics,track,setAnalyticsOptOut}=await import('./analyticsClient.js');
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const tick=async()=>{for(let i=0;i<15;i++)for(const fn of intervals.values())fn();await settle();};
const stop=beginAnalytics({ownerId:'one',getFeature:()=> 'canvas',getWaiting:()=>false});await settle();await settle();
track('run_clicked',{target:'/private/file/path'});await tick();
assert.equal(requests.length,1);assert(!JSON.stringify(requests).includes('/private/file/path'),'target becomes opaque ephemeral UUID');
const ids=requests[0].events.map(e=>e.id);now+=5000;await tick();
assert.deepEqual(requests[1].events.map(e=>e.id).slice(0,ids.length),ids,'network retry keeps original event IDs');
track('undo');stop();now+=5000;await tick();assert.equal(requests.length,2,'stopped identity discards queued events');
const stop2=beginAnalytics({ownerId:'two',getFeature:()=> 'canvas',getWaiting:()=>false});await settle();await settle();
track('redo');setAnalyticsOptOut(true);await tick();assert.equal(requests.length,2,'opt-out prevents transport immediately');stop2();
Date.now=originalDateNow;globalThis.setInterval=originalSetInterval;globalThis.clearInterval=originalClearInterval;
console.log('Analytics client bounded queue, retry IDs, opaque targets, identity cleanup and opt-out passed');
