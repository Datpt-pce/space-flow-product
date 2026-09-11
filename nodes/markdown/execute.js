const showdown = require('showdown');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const { getPath, setPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

// showdown has a known unfixed ReDoS in link/anchor parsing (GHSA-rmmh-p597-ppvv) —
// cap input size as defense in depth against pathological input.
const MAX_INPUT_LENGTH = 200000;

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const mode = config.mode || 'markdownToHtml';
  const field = config.field || '';
  const destinationFieldName = config.destinationFieldName || 'data';

  const converter = mode === 'markdownToHtml' ? new showdown.Converter() : null;

  const process = (item) => {
    const source = String((field ? getPath(item, field) : item) ?? '');
    if (source.length > MAX_INPUT_LENGTH) {
      throw new Error(`Markdown node: input quá dài (${source.length} ký tự, giới hạn ${MAX_INPUT_LENGTH})`);
    }
    const out = { ...item };
    const result = mode === 'markdownToHtml' ? converter.makeHtml(source) : NodeHtmlMarkdown.translate(source);
    setPath(out, destinationFieldName, result);
    return out;
  };

  return { items: toItems(items.map(process)) };
};
