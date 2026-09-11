const { DAY, dayOf, percentile } = require('./math');
function predict(values, horizon, model) {
  return Array.from({length:horizon},(_,i)=> {
    const weekday=values.length-7+(i%7);
    if (model==='seasonal-naive') return values[weekday];
    const samples=[0,1,2,3].map(w=>values[weekday-w*7]).filter(Number.isFinite);
    return samples.reduce((a,b)=>a+b,0)/samples.length;
  });
}
function forecast(series, horizon=7) {
  const unavailable=reason=>({status:'insufficient_data',reason,horizon,requiredDays:horizon===30?84:56,points:[]});
  const required=horizon===30?84:56;
  if (series.length<required) return unavailable(`Cần ít nhất ${required} ngày lịch sử liên tục đã đo.`);
  const recent=series.slice(-required);
  if (recent.some((s,i)=>s.coverage<.95 || !Number.isFinite(s.value) || s.value<0 || (i && Date.parse(s.day)-Date.parse(recent[i-1].day)!==DAY)))
    return unavailable('Có ngày thiếu dữ liệu hoặc coverage dưới 95%.');
  if (recent.some(s=>s.version==='mixed') || new Set(recent.map(s=>s.version)).size!==1) return unavailable('Phiên bản thay đổi trong cửa sổ huấn luyện; cần kiểm tra lại tính so sánh.');
  const values=series.map(s=>s.value);
  if (recent.filter(s=>s.value>0).length<14) return unavailable('Chưa có đủ ngày phát sinh tác vụ để kiểm tra dự báo.');
  // Disjoint weekly holdouts: calibrate on first two, validate on next two.
  const evaluate=model=> {
    const residuals=[],errors=[],actual=[];
    for(let cut=values.length-28;cut<values.length;cut+=7) {
      const predicted=predict(values.slice(0,cut),7,model);
      for(let i=0;i<7;i++){residuals.push(Math.abs(values[cut+i]-predicted[i]));actual.push(values[cut+i]);}
    }
    errors.push(...residuals.slice(14));
    return {mae:errors.reduce((a,b)=>a+b,0)/errors.length,
      wape:actual.slice(14).reduce((a,b)=>a+b,0)>0 ? errors.reduce((a,b)=>a+b,0)/actual.slice(14).reduce((a,b)=>a+b,0) : null,
      q80:percentile(residuals.slice(0,14),.8),q95:percentile(residuals.slice(0,14),.95),errors};
  };
  const baseline=evaluate('seasonal-naive'),candidate=evaluate('weekday-mean');
  const model=candidate.mae<=baseline.mae?'weekday-mean':'seasonal-naive',score=model==='weekday-mean'?candidate:baseline;
  const coverage80=score.errors.filter(e=>e<=score.q80).length/score.errors.length;
  const coverage95=score.errors.filter(e=>e<=score.q95).length/score.errors.length;
  if (coverage80<.75 || coverage95<.9) return unavailable('Khoảng dự báo chưa đạt coverage trên dữ liệu kiểm tra.');
  if(horizon===30) return unavailable('Dự báo 30 ngày cần kiểm chứng holdout 30 ngày; hiện chỉ công bố chân trời 7 ngày.');
  const last=Date.parse(series.at(-1).day);
  return {status:'available',model,horizon,trainingCutoff:series.at(-1).day,mae:score.mae,wape:score.wape,baselineMae:baseline.mae,
    coverage80,coverage95,validationDays:14,points:predict(values,horizon,model).map((value,i)=>({day:dayOf(last+(i+1)*DAY),value,
      lower80:Math.max(0,value-score.q80),upper80:value+score.q80,lower95:Math.max(0,value-score.q95),upper95:value+score.q95}))};
}
function diskScenario(rows, reserve=1024**3) {
  const history=rows.filter(r=>Number.isFinite(r.free)).slice(-14);
  if(history.length<14 || history.some((r,i)=>i&&Date.parse(r.day)-Date.parse(history[i-1].day)!==DAY))
    return {status:'insufficient_data',reason:'Cần 14 ngày liên tục có số đo dung lượng trống.'};
  const growth=(history[0].free-history.at(-1).free)/13;
  if(growth<=0)return {status:'not_decreasing',growthBytesPerDay:growth,reason:'Dung lượng trống chưa giảm đều; không có ngày chạm ngưỡng hữu hạn.'};
  const remaining=Math.max(0,(history.at(-1).free-reserve)/growth);
  return {status:'scenario',growthBytesPerDay:growth,reserveBytes:reserve,daysToReserve:remaining,
    date:remaining<=36500?dayOf(Date.parse(history.at(-1).day)+Math.ceil(remaining)*DAY):null,
    reason:'Kịch bản giữ tốc độ giảm dung lượng trống của toàn filesystem trong 14 ngày; bao gồm ứng dụng khác và cleanup.'};
}
module.exports={forecast,predict,diskScenario};
