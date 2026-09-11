import { apiFetch } from './transport.js';
import { createPresenceClock } from './analyticsPresence.js';
let client = null;
const preferenceKey = 'sf_analytics_optout';
export const optedOut = () => { try {return localStorage.getItem(preferenceKey)==='1';} catch {return true;} };
export function setAnalyticsOptOut(value) {
  try {localStorage.setItem(preferenceKey,value?'1':'0');}catch { /* restricted storage */ }
  window.dispatchEvent(new Event('sf-analytics-preference'));
}
export function track(name, props={}, options={}) { client?.track(name,props,options); }
export function trackConfig(nodeId,nodeType) { client?.config(nodeId,nodeType); }
export function beginAnalytics({ownerId,getFeature,getWaiting}) {
  let stopped=false,queue=[],inflight=false,timer,controller=new AbortController(),generation=crypto.randomUUID();
  let session=crypto.randomUUID(),lastHuman=0,pointer=false,segment=null,backoff=0,retryAt=0,dropped=0,lastRepeat=null;
  let performanceStats={longTaskMs:0,interactionMs:null,heapBytes:null,samples:0},observers=[];
  const configs=new Map(),targetIds=new Map();
  const safeType=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)?v:undefined;
  const targetId=value=>{if(!targetIds.has(value)){if(targetIds.size>=1000)targetIds.clear();targetIds.set(value,crypto.randomUUID());}return targetIds.get(value);};
  const flags=()=>({visible:!document.hidden,focused:document.hasFocus(),pointer,
    viewing:[...document.querySelectorAll('video')].some(v=>!v.paused&&!v.ended),waiting:!!getWaiting()});
  const clock=createPresenceClock({mono:performance.now(),wall:Date.now(),flags:flags()});
  let feature=getFeature();
  function enqueue(name,props={},options={}) {
    if(stopped||optedOut())return;
    if(queue.length>=500){queue.shift();dropped++;}
    queue.push({id:crypto.randomUUID(),at:Date.now(),name,feature:options.feature||getFeature(),sessionId:session,
      ...(safeType(options.nodeType)?{nodeType:options.nodeType}:{}),props});
  }
  function seal(){if(segment){enqueue('presence',segment,{feature});segment=null;}}
  function advance(input=false) {
    const next=getFeature(),result=clock.advance(performance.now(),Date.now(),flags(),input);
    for(const interval of result.intervals){
      if(!interval.visible||interval.end<=interval.start)continue;
      const same=segment&&segment.end===interval.start&&['visible','focused','pointer','engaged','viewing','waiting'].every(k=>segment[k]===interval[k]);
      if(same&&interval.end-segment.start<=15000)segment.end=interval.end;
      else{seal();segment=interval;}
    }
    if(result.missingMs){seal();dropped++;}
    if(next!==feature){seal();feature=next;enqueue('feature_opened');}
  }
  function semantic(name,props={},options={}) {
    if(Date.now()-lastHuman>1800000){seal();session=crypto.randomUUID();enqueue('session_started');}
    lastHuman=Date.now();advance(true);
    const safe={...props};
    if(safe.target)safe.target=targetId(safe.target);
    enqueue(name,safe,options);
    const key=[name,safe.target||'',options.nodeType||''].join(':');
    if(lastRepeat?.key===key&&Date.now()-lastRepeat.at<2000&&['run_clicked','cancel_clicked','data_refresh_clicked','command_requested'].includes(name))enqueue('repeat_action',{},options);
    lastRepeat={key,at:Date.now()};
  }
  async function flush(keepalive=false) {
    advance();seal();
    if(stopped||inflight||!queue.length||Date.now()<retryAt||optedOut())return;
    const batch=queue.slice(0,50);while(JSON.stringify({events:batch}).length>30000)batch.pop();
    if(!batch.length)return;
    queue.splice(0,batch.length);inflight=true;
    try {
      const response=await apiFetch('/api/analytics/events',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({events:batch}),keepalive,signal:controller.signal});
      if(!response.ok)throw Object.assign(new Error('telemetry'),{status:response.status});
      backoff=0;retryAt=0;
    } catch(error){
      if(!stopped && ![400,401,403,413].includes(error.status)){
        queue=[...batch,...queue].slice(0,500);backoff=Math.min(60000,Math.max(1000,backoff*2));retryAt=Date.now()+backoff*(1+Math.random());
      } else dropped+=batch.length;
    } finally {inflight=false;}
  }
  let lastPointerInput=-Infinity;
  const input=e=>{
    if(!e.isTrusted)return;
    if(e.type==='pointermove'&&performance.now()-lastPointerInput<250)return;
    if(e.type==='pointermove')lastPointerInput=performance.now();
    if(lastHuman&&Date.now()-lastHuman>1800000){seal();session=crypto.randomUUID();enqueue('session_started');}
    lastHuman=Date.now();advance(true);
  };
  const change=()=>{advance();if(document.hidden)void flush(true);};
  const enter=()=>{advance();pointer=true;advance();},leave=()=>{advance();pointer=false;advance();};
  const pagehide=()=>void flush(true);
  const command=e=>{
    if(e.detail.phase==='requested')e.detail.generation=generation;
    if(e.detail.generation!==generation)return;
    const {phase,feature:actionFeature,command,durationMs}=e.detail;
    // Only explicitly mapped business commands are included. Async completion is
    // paired by the transport and retained even if focus moved in the meantime.
    if(phase==='requested')semantic('command_requested',{command},{feature:actionFeature});
    else enqueue(phase==='completed'?'command_completed':'command_failed',{command,durationMs},{feature:actionFeature});
  };
  function stop(){stopped=true;clearInterval(timer);controller.abort();queue=[];configs.clear();targetIds.clear();segment=null;
    for(const [target,name,fn,opts]of registrations)target.removeEventListener(name,fn,opts);
    observers.forEach(o=>o.disconnect());if(client?.generation===generation)client=null;}
  const registrations=[];
  const on=(target,name,fn,opts)=>{target.addEventListener(name,fn,opts);registrations.push([target,name,fn,opts]);};
  apiFetch('/api/analytics/config',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(config=>{
    if(stopped||!config?.enabled||optedOut())return;
    client={generation,track:semantic,config:(id,type)=>configs.set(id,{at:Date.now(),type})};
    enqueue('session_started');enqueue('feature_opened');
    if(performance.getEntriesByType('navigation')[0]?.type==='reload')enqueue('page_reload');
    for(const name of ['pointerdown','pointermove','keydown','wheel','touchstart'])on(window,name,input,{passive:true,capture:true});
    on(document,'visibilitychange',change);on(window,'focus',change);on(window,'blur',change);
    on(document.documentElement,'pointerenter',enter);on(document.documentElement,'pointerleave',leave);
    on(window,'pagehide',pagehide);on(window,'sf-api-operation',command);
    let ticks=0;
    if(Math.random()<config.performanceSampleRate && typeof PerformanceObserver!=='undefined'){
      for(const type of ['longtask','event'])try{const observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){performanceStats.samples++;if(type==='longtask')performanceStats.longTaskMs+=entry.duration;
          else performanceStats.interactionMs=Math.max(performanceStats.interactionMs||0,entry.duration);}});
        observer.observe({type,buffered:false,...(type==='event'?{durationThreshold:16}:{})});observers.push(observer);}catch{/* unsupported */}
    }
    timer=setInterval(()=>{
      advance();
      for(const [id,c]of configs)if(Date.now()-c.at>=1000){semantic('node_config_committed',{target:id},{nodeType:c.type});configs.delete(id);}
      if(++ticks%15===0){if(observers.length){performanceStats.heapBytes=performance.memory?.usedJSHeapSize??null;
        enqueue('performance',{...performanceStats,dropped});performanceStats={longTaskMs:0,interactionMs:null,heapBytes:null,samples:0};dropped=0;}
        void flush();}
    },1000);
  }).catch(()=>{});
  return stop;
}
