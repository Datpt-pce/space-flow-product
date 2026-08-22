const xml2js = require('xml2js');
const { getPath, setPath } = require('../../backend/utils/dotPath');
const { toItems, fromItems } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config) {
  const items = fromItems(inputs.items || []);
  const mode = config.mode || 'xmlToJson';
  const field = config.field || '';
  const destinationFieldName = config.destinationFieldName || 'data';
  const explicitArray = !!config.explicitArray;
  const rootName = config.rootName || 'root';
  const headless = !!config.headless;

  const process = async (item) => {
    const source = field ? getPath(item, field) : item;
    const out = { ...item };

    if (mode === 'jsonToXml') {
      const builder = new xml2js.Builder({ rootName, headless });
      setPath(out, destinationFieldName, builder.buildObject(source));
    } else {
      const xmlStr = typeof source === 'string' ? source : String(source ?? '');
      const parsed = await xml2js.parseStringPromise(xmlStr, { explicitArray });
      setPath(out, destinationFieldName, parsed);
    }
    return out;
  };

  const result = [];
  for (const item of items) result.push(await process(item));
  return { items: toItems(result) };
};
