// Caption formatting can split one cue into several. Compare JSON values across
// the browser/server boundary; SetProperties only accepts scalar from-values.
const { cloneState, getTrack }=require('./state');
const { assertAllInvariants }=require('./invariants');
function validate(state,args) {
  if(!Array.isArray(args.changes) || !args.changes.length) throw new Error('No caption changes');
  const seen=new Set();
  for(const change of args.changes) {
    const track=getTrack(state,change.trackId);
    if(track.type !== 'caption' || track.locked || seen.has(track.id) || !Array.isArray(change.to)
      || JSON.stringify(track.clips) !== JSON.stringify(change.from)) throw new Error('Caption track changed; reload before formatting');
    seen.add(track.id);
  }
  assertAllInvariants(apply(state,args));
}
function apply(state,args) {
  const next=cloneState(state);
  for(const change of args.changes) getTrack(next,change.trackId).clips=structuredClone(change.to);
  return next;
}
function invert(state,args) {
  const next=cloneState(state);
  for(const change of args.changes) getTrack(next,change.trackId).clips=structuredClone(change.from);
  return next;
}
module.exports={ validate,apply,invert };
