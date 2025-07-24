import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 10 });

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s#]/g, '')
    .replace(/\s+/g, '')
    .replace(/#/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = str => str.trim().replace(/\s+/g, '+');

  const params = [];

  if (typeof backdrop === 'string' && backdrop.trim().toLowerCase() !== 'all') {
    params.push(`attrs=Backdrop___${encode(backdrop)}`);
  }

  if (typeof model === 'string' && model.trim().toLowerCase() !== 'all') {
    params.push(`attrs=Model___${encode(model)}`);
  }

  if (typeof symbol === 'string' && symbol.trim().toLowerCase() !== 'all') {
    params.push(`attrs=Symbol___${encode(symbol)}`);
  }

  return params.join('&');
}

async function fetchWithAxios(nft, filters, limit) {
  const cacheKey = `${nft}_${JSON.stringify(filters)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const attrsQuery = buildAttrsParams(filters);
  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const fullUrl = attrsQuery ? `${baseUrl}&${attrsQuery}` : baseUrl;

  console.log('[FETCH]', fullUrl);

  const res = await axios.get(fullUrl, {
    timeout: 800,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': `https://marketapp.ws/collection/${nft}/`,
    },
  });

  const html = res.data;
  console.log('Axios HTML response (first 500 chars):', html.slice(0, 500));

  if (
    html.length < 1000 ||
    html.includes('Just a moment') ||
    html.includes('<meta name="robots" content="noindex"')
  ) {
    throw new Error('Bot protection triggered or invalid response');
  }

  const parsed = parseNFTs(html, limit);
  cache.set(cacheKey, parsed);
  return parsed;
}

function parseNFTs(html, limit = 10) {
  const dom = parseDocument(html);
  const rows = findAll(el => el.name === 'tr', [dom]);

  const allowed = ['Marketapp', 'Getgems', 'Fragment'];
  const result = [];

  for (const row of rows) {
    if (result.length >= limit) break;

    const priceEl = findAll(el => el.attribs?.['data-nft-price'], [row])[0];
    const addrEl = findAll(el => el.attribs?.['data-nft-address'], [row])[0];
    const nameEl = findAll(el =>
      el.name === 'div' && el.attribs?.class?.includes('table-cell-value'), [row])[0];
    const providerEl = findAll(el =>
      el.name === 'div' && el.attribs?.class?.includes('table-cell-status-thin'), [row])[0];

    const price = priceEl ? parseFloat(getAttributeValue(priceEl, 'data-nft-price')) : null;
    const nftAddress = addrEl ? getAttributeValue(addrEl, 'data-nft-address') : null;
    const name = nameEl ? textContent(nameEl).trim() : null;
    const provider = providerEl ? textContent(providerEl).trim() : null;

    if (!price || !nftAddress || !name || !allowed.includes(provider)) continue;

    result.push({
      name,
      slug: slugify(name),
      price,
      nftAddress,
      provider
    });
  }

  return result;
}

async function fetchNFTs(nft, filters = {}, limit = 10) {
  try {
    return await fetchWithAxios(nft, filters, limit);
  } catch (err) {
    console.warn('Axios fetch failed:', err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  console.log('Incoming payload:', JSON.stringify(req.body, null, 2));
  const { nft, backdrop, model, symbol, limit = 10 } = req.body;
  if (!nft || typeof nft !== 'string') return res.status(400).json({ error: 'Field "nft" is required.' });

  const start = performance.now();

  try {
    const data = await fetchNFTs(nft, { backdrop, model, symbol }, limit);
    const elapsed = performance.now() - start;
    console.log(`Response time: ${elapsed.toFixed(1)}ms`);

    if (data.length === 0) return res.status(404).json({ error: `No NFTs found.` });
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
