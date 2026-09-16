// Resolves the *visible* list of ports for a node instance when its manifest
// opts into config-driven port count/labels (node.json `dynamicInputs` /
// `dynamicOutputs`). Backend never reads these fields — wiring is by string
// handle id regardless (see backend/engine/executor.js) — this only controls
// what BaseNode.jsx renders as <Handle>s on the canvas.
//
// Two shapes, chosen by which field the manifest declares:
//   - `countField`: slice the static port list to N entries, N read live from
//     node.config[countField], clamped to [min, max]. Used by Merge (inputs).
//   - `namesField`: one port per entry in node.config[namesField] (an array),
//     id taken positionally from the static list (so execute.js's output keys
//     stay stable — output0/output1/...), label taken from
//     entry[nameKey] if set. Optional extra port appended when
//     node.config[fallbackField] === 'extra'. Used by Switch (outputs).
export function resolveDynamicPorts(staticPorts, dynamicSpec, config) {
  if (!dynamicSpec) return staticPorts;
  const min = dynamicSpec.min ?? 1;
  const max = dynamicSpec.max ?? staticPorts.length;

  if (dynamicSpec.namesField) {
    const entries = config?.[dynamicSpec.namesField] || [];
    const fallbackOn = dynamicSpec.fallbackField && config?.[dynamicSpec.fallbackField] === 'extra';
    // Reserve the last static slot for the fallback port when it's on, so a
    // rule count that fills every slot can't collide with the fallback id.
    const ruleCap = fallbackOn ? max - 1 : max;
    const ports = entries.slice(0, ruleCap).map((entry, i) => ({
      id: staticPorts[i]?.id || `output${i}`,
      label: (dynamicSpec.nameKey && entry?.[dynamicSpec.nameKey]) || staticPorts[i]?.label || `Output ${i}`,
      type: staticPorts[i]?.type || 'array',
    }));

    if (fallbackOn) {
      // The fallback slot is always the *last* entry of the static list (e.g.
      // switch/node.json's trailing "fallback" port), not positional by rule
      // count — rule count varies, the fallback port's id must stay fixed.
      const fbStatic = staticPorts[staticPorts.length - 1];
      ports.push({
        id: fbStatic?.id || 'fallback',
        label: fbStatic?.label || 'Fallback',
        type: fbStatic?.type || 'array',
      });
    }

    return ports.length ? ports : staticPorts.slice(0, min);
  }

  if (dynamicSpec.countField) {
    const n = Math.min(max, Math.max(min, Number(config?.[dynamicSpec.countField]) || min));
    return staticPorts.slice(0, n);
  }

  return staticPorts;
}
