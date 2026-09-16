import BaseNodeBeta from '../nodes/BaseNodeBeta.jsx';
import { NodeToolbar, Position } from '@xyflow/react';
import NodeHistoryScope, { NodeHistoryControls } from '../components/NodeHistoryScope.jsx';
import ListNodeBeta from '../nodes/ListNodeBeta.jsx';
import TextNode from '../nodes/TextNode.jsx';
import MediaNode from '../nodes/MediaNode.jsx';
import StickyNoteNode from '../nodes/StickyNoteNode.jsx';
import ImageBatchResizeNode from '../nodes/ImageBatchResizeNode.jsx';
import VideoDownloaderNode from '../nodes/VideoDownloaderNode.jsx';
import BatchCreateFolderNode from '../nodes/BatchCreateFolderNode.jsx';
import AdvancedRenamerNode from '../nodes/AdvancedRenamerNode.jsx';
import CapcutGenerateNode from '../nodes/CapcutGenerateNode.jsx';
import ResizeUploadNode from '../nodes/ResizeUploadNode.jsx';
import ResizeUploadV2Node from '../nodes/ResizeUploadV2Node.jsx';
import ResizeUploadV3Node from '../nodes/ResizeUploadV3Node.jsx';
import ResizeUploadV31Node from '../nodes/ResizeUploadV31Node.jsx';
import ResizeUploadV32Node from '../nodes/ResizeUploadV32Node.jsx';
import ScheduleTriggerNode from '../nodes/ScheduleTriggerNode.jsx';
import ChatTriggerNode from '../nodes/ChatTriggerNode.jsx';
import PlayableAdsBuilderNode from '../nodes/PlayableAdsBuilderNode.jsx';
import VideoEditorWorkbenchNode from '../nodes/VideoEditorWorkbenchNode.jsx';

const CUSTOM_NODES = { list: ListNodeBeta, text: TextNode, media: MediaNode, 'sticky-note': StickyNoteNode, 'image-batch-resize': ImageBatchResizeNode, 'video-downloader': VideoDownloaderNode, 'batch-create-folder': BatchCreateFolderNode, 'advanced-renamer': AdvancedRenamerNode, 'capcut-generate': CapcutGenerateNode, 'resize-upload': ResizeUploadNode, 'resize-upload-v2': ResizeUploadV2Node, 'schedule-trigger': ScheduleTriggerNode, 'chat-trigger': ChatTriggerNode, 'playable-ads-builder': PlayableAdsBuilderNode, 'video-editor-workbench': VideoEditorWorkbenchNode };

// All custom node types registered here
// When adding a new node: import its component and add to CUSTOM_NODES above
CUSTOM_NODES['resize-upload-v3'] = ResizeUploadV3Node;
CUSTOM_NODES['resize-upload-v3-1'] = ResizeUploadV31Node;
CUSTOM_NODES['resize-upload-v3-2'] = ResizeUploadV32Node;
const historyTypes = new Map();
function withHistory(Component) {
  if (!historyTypes.has(Component)) historyTypes.set(Component, function NodeWithHistory(props) {
    return <NodeHistoryScope nodeId={props.id} style={{ display: 'contents' }}>
      <Component {...props} />
      <NodeToolbar isVisible={!!props.selected} position={Position.Bottom}>
        <div className="bg-[var(--card,#fff)] text-[var(--text,#111827)] border border-[var(--card-border,#e5e7eb)] rounded-lg shadow-sm"><NodeHistoryControls nodeId={props.id} /></div>
      </NodeToolbar>
    </NodeHistoryScope>;
  });
  return historyTypes.get(Component);
}
export function buildNodeTypes(manifests, nodes = []) {
  // Hydration precedes the manifest request. Never measure a default 150px node.
  const types = { ...CUSTOM_NODES };
  for (const node of nodes) types[node.type] = CUSTOM_NODES[node.type] || BaseNodeBeta;
  for (const m of manifests) {
    types[m.id] = CUSTOM_NODES[m.id] || BaseNodeBeta;
  }
  return Object.fromEntries(Object.entries(types).map(([key, Component]) => [key, withHistory(Component)]));
}

export const CATEGORY_COLORS = {
  trigger: '#eab308',
  input:   '#0ea5e9',
  image:   '#7c3aed',
  ai:      '#f59e0b',
  data:    '#10b981',
  output:  '#ef4444',
  control: '#6b7280',
};
