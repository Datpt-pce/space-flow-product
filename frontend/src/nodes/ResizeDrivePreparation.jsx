import { useEffect } from 'react';
import { useStore } from '../store.js';
import ResizeDriveInput from './ResizeDriveInput.jsx';

export default function ResizeDrivePreparation() {
  const request = useStore(s => s.resizeDriveRequest);
  const ownerId = useStore(s => s.currentUser?.id);
  const nodes = useStore(s => s.nodes);
  const valid = request && request.ownerId === ownerId && nodes.some(node => node.id === request.nodeId);
  useEffect(() => { if (request && !valid) request.finish(null); }, [request, valid]);
  useEffect(() => () => request?.finish(null), [request]);
  return valid ? <ResizeDriveInput key={`${request.nodeId}:${request.url}:${request.recovery}`} version={request.version} request={request} /> : null;
}
