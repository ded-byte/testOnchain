import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { getAttributeValue, textContent } from 'domutils';
import { Element, isTag } from 'domhandler';

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

  const params = [];
  const normBackdrop = normalize(backdrop);
  const normModel = normalize(model);
  const normSymbol = normalize(symbol);

  if (normBackdrop && normBackdrop !== 'all') params.push(`attrs=Backdrop___${encode(backdrop)}`);
  if (normModel && normModel !== 'all') params.push(`attrs=Model___${encode(model)}`);
  if (normSymbol && normSymbol !== 'all') params.push(`attrs=Symbol___${encode(symbol)}`);

  return params.join('&');
}

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s#]/g, '')
    .replace(/\s+/g, '')
    .replace(/#/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function fetchNFTs(nft, filters = {}, limit = 10) {
  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  const { data: html } = await axios.get(url, {
    responseType: 'text',
    decompress: false,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
    },
  });

  const dom = parseDocument(html);
  const results = [];
  const allowedProviders = new Set(['Marketapp', 'Getgems', 'Fragment']);

  const stack = [...dom.children];

  while (stack.length && results.length < limit) {
    const el = stack.pop();

    if (!isTag(el)) continue;

    if (el.name === 'tr') {
      let price = null, nftAddress = null, name = null, provider = null;

      for (const child of el.children || []) {
        if (!isTag(child)) continue;

        const attrs = child.attribs || {};
        if (attrs['data-nft-price']) price = parseFloat(attrs['data-nft-price']);
        if (attrs['data-nft-address']) nftAddress = attrs['data-nft-address'];

        const cls = attrs.class || '';
        if (!name && cls.includes('table-cell-value')) {
          name = textContent(child).trim();
        }
        if (!provider && cls.includes('table-cell-status-thin')) {
          provider = textContent(child).trim();
        }
      }

      if (price && nftAddress && name && allowedProviders.has(provider)) {
        results.push({
          name,
          slug: slugify(name),
          price,
          nftAddress,
          provider,
        });
      }
    } else if (el.children?.length) {
      stack.push(...el.children);
    }
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { nft, backdrop, model, symbol, limit = 10 } = req.body;

  if (!nft || typeof nft !== 'string') {
    return res.status(400).json({ error: 'Field "nft" is required and must be a string.' });
  }

  try {
    const nfts = await fetchNFTs(nft, { backdrop, model, symbol }, limit);
    if (nfts.length === 0) {
      return res.status(404).json({ error: `No NFTs found for contract address "${nft}".` });
    }
    return res.status(200).json(nfts);
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
