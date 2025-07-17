import axios from 'axios';
import * as cheerio from 'cheerio';

// 🔧 Функция построения параметров фильтров
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

// 🚀 Основная функция для получения NFT
async function fetchNFTs(nft, filters = {}, limit = 10) {
  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://marketapp.ws/',
        'Accept': 'text/html'
      }
    });

    const $ = cheerio.load(data);
    const rows = $('tr').toArray();
    const nftResults = [];

    const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];

    for (const el of rows) {
      if (nftResults.length >= limit) break;

      const $el = $(el);

      const name = $el.find('div.table-cell-value.tm-value').first().text().trim();
      const priceStr = $el.find('span[data-nft-price]').attr('data-nft-price');
      const price = priceStr ? parseFloat(priceStr) : null;
      const nftAddress = $el.find('span[data-nft-address]').attr('data-nft-address');
      const provider = $el.find('div.table-cell-status-thin.tm-status-market').text().trim();

      if (!allowedProviders.includes(provider)) continue;
      if (!name || !price || !nftAddress) continue;

      const slug = name.toLowerCase()
        .replace(/[^a-z0-9\s#]/g, '')
        .replace(/\s+/g, '')
        .replace(/#/g, '-')
        .replace(/-+/g, '-')
        .trim();

      nftResults.push({ name, slug, price, nftAddress, provider });
    }

    return nftResults;
  } catch (error) {
    throw new Error(`Failed to fetch NFTs: ${error.message}`);
  }
}

// 📦 Vercel handler
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
