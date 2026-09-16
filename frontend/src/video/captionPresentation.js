import presets from '../../../shared/video-caption-presets.json';
export { presets };
export const positions = [
  ['top-left','Trên trái'],['top-center','Trên giữa'],['top-right','Trên phải'],
  ['middle-left','Giữa trái'],['middle-center','Chính giữa'],['middle-right','Giữa phải'],
  ['bottom-left','Dưới trái'],['bottom-center','Dưới giữa'],['bottom-right','Dưới phải'],
];
export function captionAppearance(style, scale=1) {
  const p = presets.find(p => p.id === (style.preset || 'box')) || presets.at(-1);
  const size=(style.fontSize || 32)*scale;
  return { color:p.color, background:p.background ? `${p.background}${p.alpha === .5 ? '80' : 'ff'}` : 'transparent',
    fontSize:size, fontFamily:`"${(style.fontFamily || 'Arial').replace(/["\\]/g,'')}", sans-serif`, lineHeight:1.2, whiteSpace:'pre', maxWidth:'100%',
    WebkitTextStroke:p.stroke ? `${Math.max(.4,size/16)}px ${p.stroke}` : '0', paintOrder:'stroke fill',
    padding:p.background ? `${size*.12}px ${size*.25}px` : 0, borderRadius:p.background ? size*.12 : 0,
  };
}
