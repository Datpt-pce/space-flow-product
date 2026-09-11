import BaseNodeBeta from '../nodes/BaseNodeBeta.jsx';
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
import ScheduleTriggerNode from '../nodes/ScheduleTriggerNode.jsx';
import ChatTriggerNode from '../nodes/ChatTriggerNode.jsx';
import PlayableAdsBuilderNode from '../nodes/PlayableAdsBuilderNode.jsx';
import VideoEditorWorkbenchNode from '../nodes/VideoEditorWorkbenchNode.jsx';

const CUSTOM_NODES = { list: ListNodeBeta, text: TextNode, media: MediaNode, 'sticky-note': StickyNoteNode, 'image-batch-resize': ImageBatchResizeNode, 'video-downloader': VideoDownloaderNode, 'batch-create-folder': BatchCreateFolderNode, 'advanced-renamer': AdvancedRenamerNode, 'capcut-generate': CapcutGenerateNode, 'resize-upload': ResizeUploadNode, 'resize-upload-v2': ResizeUploadV2Node, 'schedule-trigger': ScheduleTriggerNode, 'chat-trigger': ChatTriggerNode, 'playable-ads-builder': PlayableAdsBuilderNode, 'video-editor-workbench': VideoEditorWorkbenchNode };

// All custom node types registered here
// When adding a new node: import its component and add to CUSTOM_NODES above
CUSTOM_NODES['resize-upload-v3'] = ResizeUploadV3Node;
export function buildNodeTypes(manifests, nodes = []) {
  // Hydration precedes the manifest request. Never measure a default 150px node.
  const types = { ...CUSTOM_NODES };
  for (const node of nodes) types[node.type] = CUSTOM_NODES[node.type] || BaseNodeBeta;
  for (const m of manifests) {
    types[m.id] = CUSTOM_NODES[m.id] || BaseNodeBeta;
  }
  return types;
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
