const presets = require('./video-caption-presets.json');
const escape = value => String(value).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' }[c]));
function captionLayout(text, resolution, measure) {
  const theme=presets.find(p=>p.id === (text.preset || 'box')) || presets.at(-1);
  const margin=Math.max(4,Math.min(20,Number(text.safeMarginPct) || 8))/100;
  const size=Math.max(4,Math.min(Number(text.fontSize) || 32,resolution.height*(1-2*margin)/2.7));
  const fontFamily=String(text.fontFamily || 'Arial').slice(0,150);
  const lines=String(text.content || '').split('\n'), padding=size*.3;
  const widths=lines.map(line=>measure(line,{ fontFamily,fontSize:size }));
  const naturalWidth=Math.max(1,...widths), maxWidth=resolution.width*(1-2*margin)-2*padding;
  const scaleX=Math.min(1,maxWidth/naturalWidth), width=naturalWidth*scaleX+2*padding;
  const height=lines.length*size*1.2+size*.24;
  const [row,column]=(text.position || 'bottom-center').split('-');
  const x=column === 'left' ? resolution.width*margin : column === 'right' ? resolution.width*(1-margin)-width : (resolution.width-width)/2;
  const y=row === 'top' ? resolution.height*margin : row === 'middle' ? (resolution.height-height)/2 : resolution.height*(1-margin)-height;
  return { theme,size,fontFamily,lines,padding,width,height,x,y,scaleX,column,naturalWidth };
}
function captionSvg(text,resolution,measure) {
  const p=captionLayout(text,resolution,measure), { theme,size }=p;
  const anchor=p.column === 'left' ? 'start' : p.column === 'right' ? 'end' : 'middle';
  const x=p.column === 'left' ? 0 : p.column === 'right' ? p.naturalWidth : p.naturalWidth/2;
  const background=theme.background ? `<rect width="${p.width}" height="${p.height}" rx="${size*.12}" fill="${theme.background}" opacity="${theme.alpha ?? 1}"/>` : '';
  const lines=p.lines.map((line,i)=>`<text x="${x}" y="${size*(1.02+i*1.2)}" text-anchor="${anchor}">${escape(line)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${resolution.width}" height="${resolution.height}"><g transform="translate(${p.x} ${p.y})">${background}<g transform="translate(${p.padding} 0) scale(${p.scaleX} 1)" font-family="${escape(p.fontFamily)}" font-size="${size}" fill="${theme.color}" stroke="${theme.stroke || 'none'}" stroke-width="${size/16}" stroke-linejoin="round" paint-order="stroke fill">${lines}</g></g></svg>`;
}
module.exports={ captionLayout,captionSvg };
