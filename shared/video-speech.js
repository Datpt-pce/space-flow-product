// Source-coordinate speech annotations. No filesystem or model access here.
const PRESETS = require('./video-caption-presets.json').map(p => p.id);
function wrapCaption(content, width, fontSize, safeMarginPct=8) {
  // Reserve padding/stroke as well as the safe margin. Wide Latin glyphs and
  // combining marks must not be treated like an average lowercase character.
  const limit = (width*(1-2*safeMarginPct/100)-fontSize*.7)/fontSize;
  const unit = c => /\p{Mark}/u.test(c) ? 0 : c.codePointAt(0) > 0x2e7f || /[MW@%]/.test(c) ? 1.1 : /[A-Z]/.test(c.normalize('NFD')[0]) ? .8 : .6;
  const units = text => [...text].reduce((sum,c) => sum + unit(c),0);
  return content.split('\n').map(paragraph => {
    const lines = []; let line = '', lineUnits = 0;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && lineUnits+unit(' ')+units(word) > limit) { lines.push(line); line = ''; lineUnits = 0; }
      if (line) { line += ' '; lineUnits += unit(' '); }
      for (const char of word) {
        if (line && lineUnits+unit(char) > limit) { lines.push(line); line = ''; lineUnits = 0; }
        line += char; lineUnits += unit(char);
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }).join('\n');
}
function splitCaptionCues(cues, { width, height, fps=30 }, style) {
  const margin = style.safeMarginPct ?? 8;
  const fontSize = Math.min(style.fontSize || 32, height*(1-2*margin/100)/2.7);
  const usedIds=new Set(cues.map(c=>c.id));
  const compact = text => text.replace(/\s/g,'');
  return cues.flatMap(cue => {
    const lines = wrapCaption(cue.content,width,fontSize,margin).split('\n');
    const pieces = [];
    for (let i=0;i<lines.length;i+=2) pieces.push(lines.slice(i,i+2).join('\n'));
    if (pieces.length === 1) return [{ ...cue,content:pieces[0] }];
    const frameMs=1000/fps, duration=cue.endMs-cue.startMs;
    if (duration < pieces.length*frameMs-1e-6) throw new Error('Câu quá dài so với thời lượng. Giảm cỡ chữ hoặc tăng thời gian câu để chia phụ đề.');
    const words=cue.words || [], hasTiming=compact(words.map(w=>w.word).join('')) === compact(cue.content);
    const length=Math.max(1,compact(cue.content).length);
    let consumed=0, start=cue.startMs;
    return pieces.map((content,index) => {
      consumed += compact(content).length;
      let boundary=cue.startMs+duration*consumed/length;
      if (hasTiming) {
        let count=0;
        for (const word of words) {
          const size=compact(word.word).length;
          if (count+size >= consumed && size) { boundary=word.startMs+(word.endMs-word.startMs)*(consumed-count)/size;break; }
          count+=size;
        }
      }
      const end=index === pieces.length-1 ? cue.endMs : Math.min(cue.endMs-(pieces.length-index-1)*frameMs,Math.max(start+frameMs,boundary));
      let id=cue.id;
      if(index) {
        const base=`${cue.id.slice(0,75)}-part-${index+1}`;id=base;
        let suffix=1;while(usedIds.has(id)) id=`${base}-${suffix++}`;
        usedIds.add(id);
      }
      const part={ ...cue,id,content,startMs:start,endMs:end,
        words:words.filter(w=>w.endMs>start && w.startMs<end).map(w=>({ ...w,startMs:Math.max(start,w.startMs),endMs:Math.min(end,w.endMs) })) };
      start=end;return part;
    });
  });
}
function validateSpeech(value, durationMs) {
  if (!value || !Array.isArray(value.cues) || value.cues.length > 5000
    || !value.style || !PRESETS.includes(value.style.preset)
    || !Number.isFinite(value.style.fontSize) || value.style.fontSize < 4 || value.style.fontSize > 500) throw new Error('Cấu hình captions không hợp lệ.');
  if (value.style.position !== undefined && !/^(top|middle|bottom)-(left|center|right)$/.test(value.style.position)) throw new Error('Vị trí captions không hợp lệ.');
  if (value.style.safeMarginPct !== undefined && (!Number.isFinite(value.style.safeMarginPct) || value.style.safeMarginPct < 4 || value.style.safeMarginPct > 20)) throw new Error('Lề captions phải từ 4 đến 20%.');
  if (value.style.fontFamily !== undefined && (typeof value.style.fontFamily !== 'string' || !value.style.fontFamily.trim() || value.style.fontFamily.length > 150 || /[\x00-\x1f]/.test(value.style.fontFamily))) throw new Error('Tên font không hợp lệ.');
  let end = 0;
  const ids = new Set();
  const cues = value.cues.map(c => {
    if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || ids.has(c.id)
      || !Number.isFinite(c.startMs) || !Number.isFinite(c.endMs) || c.startMs < end || c.endMs <= c.startMs || c.endMs > durationMs + 1
      || typeof c.content !== 'string' || c.content.length > 500 || typeof c.speaker !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(c.speaker)
      || !['keep', 'convert'].includes(c.action)) throw new Error('Các câu cần thời gian tăng dần, không chồng nhau và nằm trong nguồn.');
    ids.add(c.id); end = c.endMs;
    const words = Array.isArray(c.words) ? c.words.filter(w => typeof w.word === 'string' && w.word.length <= 100
      && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.startMs >= c.startMs && w.endMs <= c.endMs && w.endMs > w.startMs)
      .map(w => ({ word:w.word, startMs:w.startMs, endMs:w.endMs })) : [];
    return { id:c.id, startMs:c.startMs, endMs:c.endMs, content:c.content, speaker:c.speaker, action:c.action, words };
  });
  return { cues, style:{ preset:value.style.preset, fontSize:value.style.fontSize,
    ...(value.style.fontFamily !== undefined ? { fontFamily:value.style.fontFamily } : {}),
    ...(value.style.position !== undefined ? { position:value.style.position } : {}),
    ...(value.style.safeMarginPct !== undefined ? { safeMarginPct:value.style.safeMarginPct } : {}) } };
}

function applySpeechTracks(document, items, origins) {
  const added = [];
  for (const track of document.tracks) {
    const captions = [], audio = [];
    for (const clip of track.clips) {
      const speech = items[origins[clip.id]?.itemId]?.speech;
      if (!speech || !['video', 'audio'].includes(track.type) || clip.speed !== 1) continue;
      const start = clip.sourceInMs, end = clip.sourceOutMs, offset = clip.timelineInMs - start;
      if (speech.audio && clip.volume !== 0) {
        audio.push({ ...structuredClone(clip), id:`${clip.id}-voice`, assetId:speech.audio.assetId, effects:[], keyframes:[] });
        origins[`${clip.id}-voice`] = { ...origins[clip.id], voice:true };
        clip.volume = 0;
      }
      for (const cue of splitCaptionCues(speech.cues,{ ...document.resolution,fps:document.fps },speech.style)) {
        const a = Math.max(start, cue.startMs), b = Math.min(end, cue.endMs);
        if (b-a < 1000/document.fps-1e-6 || !cue.content.trim()) continue;
        const id = `${clip.id}-caption-${cue.id}`;
        captions.push({ id, sourceInMs:0, sourceOutMs:b-a, timelineInMs:a+offset, timelineOutMs:b+offset, speed:1,
          text:{ ...speech.style, fontSize:Math.min(speech.style.fontSize,document.resolution.height*(1-2*(speech.style.safeMarginPct ?? 8)/100)/2.7), content:cue.content,
            words:(cue.words || []).filter(w => w.endMs > a && w.startMs < b).map(w => ({ ...w, startMs:Math.max(a,w.startMs)+offset, endMs:Math.min(b,w.endMs)+offset })) } });
        origins[id] = { ...origins[clip.id], cueId:cue.id };
      }
    }
    if (captions.length) added.push({ ...track, id:`${track.id}-captions`, type:'caption', name:`Captions · ${track.name}`, muted:false, clips:captions });
    if (audio.length) added.push({ ...track, id:`${track.id}-voice`, type:'audio', name:`Voice · ${track.name}`, clips:audio });
  }
  document.tracks.push(...added);
}
module.exports = { validateSpeech, applySpeechTracks, wrapCaption, splitCaptionCues };
