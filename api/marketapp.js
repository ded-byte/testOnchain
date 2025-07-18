import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import http from 'http';
import https from 'https';

// 🔁 Подключаем keep-alive
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

// 🧠 Мягкий кеш
const cache = new Map();

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
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
    },
    httpAgent,
    httpsAgent,
  });

  const dom = parseDocument(html);
  const rows = findAll(el => el.name === 'tr', dom.children);
  const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
  const results = [];

  for (const row of rows) {
    if (results.length >= limit) break;

    const priceEl = findAll(el => el.attribs?.['data-nft-price'], [row])[0];
    const addrEl = findAll(el => el.attribs?.['data-nft-address'], [row])[0];
    const nameEl = findAll(el => el.name === 'div' && el.attribs?.class?.includes('table-cell-value'), [row])[0];
    const providerEl = findAll(el => el.name === 'div' && el.attribs?.class?.includes('table-cell-status-thin'), [row])[0];

    const price = priceEl ? parseFloat(getAttributeValue(priceEl, 'data-nft-price')) : null;
    const nftAddress = addrEl ? getAttributeValue(addrEl, 'data-nft-address') : null;
    const name = nameEl ? textContent(nameEl).trim() : null;
    const provider = providerEl ? textContent(providerEl).trim() : null;

    if (!price || !nftAddress || !name || !allowedProviders.includes(provider)) continue;

    results.push({
      name,
      slug: slugify(name),
      price,
      nftAddress,
      provider
    });
  }

  return results;
}

// 🧠 Обёртка с кешем на 5 секунд
async function fetchNFTsCached(nft, filters, limit) {
  const key = JSON.stringify({ nft, filters, limit });
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && now - cached.timestamp < 5000) {
    return cached.data;
  }

  const data = await fetchNFTs(nft, filters, limit);
  cache.set(key, { data, timestamp: now });
  return data;
}

// 🔥 Прогрев популярных коллекций (однократный)
let isWarmedUp = false;
async function warmUpPopular() {
  if (isWarmedUp) return;
  isWarmedUp = true;
  const warmUpNft = 'EQDxxxxxx...'; // замените на популярную коллекцию
  try {
    await fetchNFTsCached(warmUpNft, {}, 5);
    console.log(`✅ Warmed up collection ${warmUpNft}`);
  } catch (e) {
    console.warn(`⚠️ Warm-up failed for ${warmUpNft}:`, e.message);
  }
}

export default async function handler(req, res) {
  await warmUpPopular(); // фоновой прогрев

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { nft, backdrop, model, symbol, limit = 10 } = req.body;

  if (!nft || typeof nft !== 'string') {
    return res.status(400).json({ error: 'Field "nft" is required and must be a string.' });
  }

  try {
    const nfts = await fetchNFTsCached(nft, { backdrop, model, symbol }, limit);
    if (nfts.length === 0) {
      return res.status(404).json({ error: `No NFTs found for contract address "${nft}".` });
    }
    return res.status(200).json(nfts);
  } catch (error) {
    console.error('❌ Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
