import { captionSvg } from '@shared/video-caption-layout';
let context;
function measure(line,p) {
  context ||= document.createElement('canvas').getContext('2d');
  context.font=`${p.fontSize}px "${p.fontFamily.replace(/["\\]/g,'')}"`;
  return context.measureText(line).width;
}
export default function CaptionGraphic({ text,resolution }) {
  const svg=captionSvg(text,resolution,measure).replace('<svg ',`<svg viewBox="0 0 ${resolution.width} ${resolution.height}" style="width:100%;height:100%" `);
  return <div data-caption-preview className="absolute inset-0 pointer-events-none" dangerouslySetInnerHTML={{ __html:svg }}/>;
}
