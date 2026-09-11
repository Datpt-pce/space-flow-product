const { DAY, dayOf, duration, percentile } = require('./math');
const { FEATURES, CLOCKS } = require('./collector');
const { forecast, diskScenario } = require('./forecast');
function queryAnalytics(db, query={}, now=Date.now()) {
  if (Object.keys(query).some(k=>!['days','feature','node','role','location'].includes(k)) || Object.values(query).some(v=>typeof v!=='string')) throw Object.assign(new Error('Invalid analytics filter'),{status:400});
  const days=Number(query.days||30),feature=query.feature||'',node=query.node||'',role=query.role||'',location=query.location||'';
  if (![7,30,90].includes(days) || (feature&&!FEATURES.includes(feature)) || !/^[a-zA-Z0-9_-]{0,100}$/.test(node) ||
    (role&&!['admin','member'].includes(role)) || (location&&!['agent','server','unknown'].includes(location))) throw Object.assign(new Error('Invalid analytics range'),{status:400});
  const today=dayOf(now),from=dayOf(Date.parse(today)-(days-1)*DAY),fromMs=Date.parse(from);
  const daily=db.prepare(`SELECT d.*,u.role FROM analytics_daily d JOIN users u ON u.id=d.owner_id
    WHERE day>=? AND (?='' OR feature=?) AND (?='' OR u.role=?) ORDER BY day LIMIT 50001`).all(from,feature,feature,role,role);
  const kindFilter=feature?({canvas:'workflow',video:'render',batch:'delivery'}[feature]||'none'):'';
  const jobs=db.prepare(`SELECT j.*,u.role FROM analytics_jobs j JOIN users u ON u.id=j.owner_id
    WHERE j.created_at>=? AND (?='' OR u.role=?) AND (?='' OR location=?) AND (?='' OR kind=?)
    ORDER BY j.created_at LIMIT 50001`).all(fromMs,role,role,location,location,kindFilter,kindFilter);
  const attempts=db.prepare(`SELECT a.* FROM analytics_attempts a JOIN users u ON u.id=a.owner_id WHERE started_at>=?
    AND (?='' OR node_type=?) AND (?='' OR u.role=?) AND (?='' OR location=?) AND (?='' OR ?='canvas') ORDER BY started_at LIMIT 50001`).all(fromMs,node,node,role,role,location,location,feature,feature);
  let complete = daily.length<=50000 && jobs.length<=50000 && attempts.length<=50000;
  const perUser=new Map(),features={},byDay=new Map(),active=new Set(),wau=new Set(),mau=new Set(),sessions=new Set();
  for (let i=0;i<days;i++){const day=dayOf(fromMs+i*DAY);byDay.set(day,{day,users:new Set(),actions:0,jobs:0,success:0,outputs:0,engagedMs:0});}
  const addSpans=(object,p)=>{for(const clock of CLOCKS)(object[clock] ||= []).push(...(p[clock]||[]));};
  for(const row of daily){
    if(!byDay.has(row.day))continue;
    const a=JSON.parse(row.actions),s=JSON.parse(row.spans),key=`${row.day}:${row.owner_id}`;
    const f=features[row.feature] ||= {feature:row.feature,users:new Set(),actions:{},spans:{},sessions:new Set()};
    const human=(a.human||0)>0;
    if(human){active.add(row.owner_id);f.users.add(row.owner_id);byDay.get(row.day)?.users.add(row.owner_id);
      if(row.day>=dayOf(Date.parse(today)-6*DAY))wau.add(row.owner_id);
      if(row.day>=dayOf(Date.parse(today)-29*DAY))mau.add(row.owner_id);
      for(const id of JSON.parse(row.sessions)){sessions.add(`${row.owner_id}:${id}`);f.sessions.add(`${row.owner_id}:${id}`);}}
    for(const [name,value]of Object.entries(a)){f.actions[name]=(f.actions[name]||0)+value;}
    byDay.get(row.day).actions+=a.human||0;
    const user=perUser.get(key)||{day:row.day,owner:row.owner_id,spans:{}};addSpans(user.spans,s);perUser.set(key,user);
    // Feature union must retain owner to avoid overlapping different users.
    const fs=f.spans[key] ||= {};addSpans(fs,s);
  }
  const clocks=Object.fromEntries(CLOCKS.map(c=>[c,0]));
  for(const row of perUser.values())for(const clock of CLOCKS){const ms=duration(row.spans[clock]||[]);clocks[clock]+=ms;if(clock==='engaged')byDay.get(row.day).engagedMs+=ms;}
  const succeeded=j=>['succeeded','done'].includes(j.state),terminal=j=>j.ended_at!==null;
  const outcomeUsers=new Set();
  for(const j of jobs){const d=byDay.get(dayOf(j.created_at));if(!d)continue;d.jobs++;if(succeeded(j))d.success++;
    if(j.kind==='delivery'&&succeeded(j)){d.outputs++;outcomeUsers.add(j.owner_id);}}
  const nodeGroups={};
  for(const a of attempts){const n=nodeGroups[a.node_type] ||= {node:a.node_type,users:new Set(),runs:new Set(),attempts:0,success:0,failed:0,cancelled:0,incomplete:0,retries:0,durations:[],firstAttempts:0,firstSuccess:0};
    n.users.add(a.owner_id);n.runs.add(a.run_id);n.attempts++;n[a.state==='succeeded'?'success':a.state==='failed'?'failed':a.state==='cancelled'?'cancelled':'incomplete']++;
    if(a.attempt>1)n.retries++;if(a.attempt===1){n.firstAttempts++;if(a.state==='succeeded')n.firstSuccess++;}
    if(a.duration_ms!==null)n.durations.push(a.duration_ms);
  }
  const interactions=db.prepare(`SELECT node_type,e.name,COUNT(*) AS n FROM analytics_events e JOIN users u ON u.id=e.owner_id
    WHERE at>=? AND node_type IS NOT NULL AND (?='' OR u.role=?) AND (?='' OR node_type=?) AND (?='' OR feature=?) GROUP BY node_type,e.name`).all(fromMs,role,role,node,node,feature,feature);
  const friction={};for(const r of interactions){(friction[r.node_type] ||= {})[r.name]=r.n;}
  const resources=db.prepare(`SELECT r.* FROM analytics_resource_daily r LEFT JOIN users u ON u.id=r.owner_id
    WHERE day>=? AND (?='' OR u.role=? OR r.scope='server') ORDER BY day LIMIT 10001`).all(from,role,role);
  const recent=db.prepare(`SELECT r.* FROM analytics_resources r LEFT JOIN users u ON u.id=r.owner_id
    WHERE at>=? AND (?='' OR u.role=? OR r.scope='server') ORDER BY at DESC LIMIT 1000`).all(Math.max(fromMs,now-3600000),role,role);
  const latest=new Map();for(const r of recent)if(!latest.has(r.instance_id))latest.set(r.instance_id,{scope:r.scope,instance:r.instance_id,at:r.at,...JSON.parse(r.sample)});
  const coverage=db.prepare(`SELECT strftime('%Y-%m-%d',minute*60,'unixepoch') AS day,COUNT(*)/1440.0 AS coverage,
    CASE WHEN COUNT(DISTINCT version)=1 THEN MIN(version) ELSE 'mixed' END AS version FROM analytics_coverage
    WHERE minute>=? GROUP BY day ORDER BY day`).all(Math.floor((Date.parse(today)-90*DAY)/60000));
  const forecasts={};
  for(const kind of ['workflow','render']){
    const counts=db.prepare(`SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') AS day,COUNT(*) AS n FROM analytics_jobs
      WHERE kind=? AND created_at>=? GROUP BY day`).all(kind,Date.parse(today)-90*DAY);
    const map=new Map(counts.map(r=>[r.day,r.n]));
    const history=coverage.filter(r=>r.day<today).map(r=>({...r,value:map.get(r.day)||0}));
    forecasts[kind]={...forecast(history),history:history.slice(-56)};
  }
  const serverHistory=db.prepare("SELECT * FROM analytics_resource_daily WHERE scope='server' AND day>=? ORDER BY last_at LIMIT 50001").all(dayOf(Date.parse(today)-90*DAY));
  const cpuByDay=new Map(),diskByDay=new Map();
  for(const r of serverHistory){cpuByDay.set(r.day,(cpuByDay.get(r.day)||0)+r.cpu_seconds);diskByDay.set(r.day,{day:r.day,free:r.disk_free});}
  const cpuHistory=coverage.filter(r=>r.day<today).map(r=>({...r,value:cpuByDay.get(r.day)??null}));
  forecasts.cpu={...forecast(cpuHistory),history:cpuHistory.slice(-56)};
  const disk=diskScenario([...diskByDay.values()].filter(r=>r.day<today));
  const cohortRows=db.prepare(`SELECT d.day,d.owner_id,d.actions FROM analytics_daily d JOIN users u ON u.id=d.owner_id
    WHERE (?='' OR feature=?) AND (?='' OR u.role=?) ORDER BY d.day LIMIT 50001`).all(feature,feature,role,role);
  const activeDates=new Map();
  for(const r of cohortRows)if(JSON.parse(r.actions).human>0){if(!activeDates.has(r.owner_id))activeDates.set(r.owner_id,new Set());activeDates.get(r.owner_id).add(r.day);}
  const cohorts=[1,7,30].map(offset=>{let eligible=0,returned=0;for(const dates of activeDates.values()){
    const first=[...dates][0],target=dayOf(Date.parse(first)+offset*DAY);
    if(target<today){eligible++;if(dates.has(target))returned++;}}
    return {day:offset,eligible,returned};});
  complete = complete && resources.length<=10000 && cohortRows.length<=50000 && serverHistory.length<=50000;
  const perf=db.prepare(`SELECT props FROM analytics_events e JOIN users u ON u.id=e.owner_id WHERE e.name='performance' AND at>=?
    AND (?='' OR u.role=?) AND (?='' OR feature=?) ORDER BY at DESC LIMIT 10000`).all(fromMs,role,role,feature,feature).map(r=>JSON.parse(r.props));
  const states={};for(const j of jobs)states[j.state]=(states[j.state]||0)+1;
  const downloads=(!feature||feature==='video')?db.prepare(`SELECT COUNT(*) AS outputs,COUNT(DISTINCT owner_id) AS users FROM analytics_output_usage o
    JOIN users u ON u.id=o.owner_id WHERE first_at>=? AND (?='' OR u.role=?)`).get(fromMs,role,role):{outputs:0,users:0};
  return {generatedAt:now,watermark:db.prepare('SELECT MAX(minute)*60000 AS at FROM analytics_coverage').get().at,
    enabled:db.prepare("SELECT value FROM analytics_settings WHERE key='enabled'").get()?.value==='1',
    range:{from,to:today,days,timezone:'UTC',feature,node,role,location},complete,limits:{rows:50000,rawDays:30,resourceDays:7,dailyDays:395},
    overview:{activeUsers:active.size,wau:wau.size,mau:days>=30?mau.size:null,sessions:sessions.size,clocks,
      jobs:jobs.length,terminalJobs:jobs.filter(terminal).length,succeeded:jobs.filter(succeeded).length,states,
      deliveredOutputs:jobs.filter(j=>j.kind==='delivery'&&succeeded(j)).length,outcomeUsers:outcomeUsers.size,downloads,
      queueP50:percentile(jobs.filter(j=>j.started_at!==null).map(j=>j.started_at-j.created_at),.5),
      queueP95:percentile(jobs.filter(j=>j.started_at!==null).map(j=>j.started_at-j.created_at),.95),
      runtimeP95:percentile(jobs.filter(j=>j.started_at!==null&&j.ended_at!==null).map(j=>j.ended_at-j.started_at),.95)},
    trend:[...byDay.values()].map(d=>{const observed=coverage.find(r=>r.day===d.day)?.coverage||0;
      return {...d,users:d.users.size || (observed?0:null),jobs:d.jobs || (observed?0:null),coverage:observed};}),
    features:Object.values(features).map(f=>({...f,users:f.users.size,sessions:f.sessions.size,
      clocks:Object.fromEntries(CLOCKS.map(c=>[c,Object.values(f.spans).reduce((s,p)=>s+duration(p[c]||[]),0)])),spans:undefined})),
    nodes:Object.values(nodeGroups).map(n=>({...n,users:n.users.size,runs:n.runs.size,p50:percentile(n.durations,.5),p95:percentile(n.durations,.95),durations:undefined,friction:friction[n.node]||{}})),
    resources:{daily:resources,latest:[...latest.values()],browser:{samples:perf.length,heapP95:percentile(perf.map(p=>p.heapBytes),.95),interactionP95:percentile(perf.map(p=>p.interactionMs),.95),longTaskP95:percentile(perf.map(p=>p.longTaskMs),.95)},
      provider:require('../services/providerRequest').snapshot()},
    forecasts,disk,cohorts,coverage:coverage.slice(-days)};
}
module.exports={queryAnalytics};
