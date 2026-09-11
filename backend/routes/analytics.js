const express = require('express');
const { createCollector } = require('../analytics/collector');
function createAnalyticsRouter(db) {
  const router=express.Router(),collector=createCollector(db),limits=new Map();
  router.get('/config',(req,res)=>res.json({enabled:process.env.SF_ANALYTICS_ENABLED!=='0',schemaVersion:1,flushMs:15000,idleMs:60000,
    retentionDays:30,performanceSampleRate:.1}));
  router.post('/events',(req,res,next)=>{
    if(process.env.SF_ANALYTICS_ENABLED==='0')return res.status(204).end();
    const now=Date.now(),key=req.user.id;
    // Bounded one-minute buckets, expire entries before admission.
    for(const [id,bucket]of limits)if(now-bucket.at>=60000)limits.delete(id);
    const bucket=limits.get(key)||{at:now,count:0};
    if(bucket.count>=120 || (limits.size>=10000&&!limits.has(key)))return res.status(429).set('Retry-After','60').json({error:'Analytics rate limit'});
    bucket.count++;limits.set(key,bucket);
    try {res.json(collector.ingest(key,req.body));}catch(error){next(error);}
  });
  return router;
}
module.exports={createAnalyticsRouter};
