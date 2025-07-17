import { request } from 'undici';
import * as cheerio from 'cheerio';

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

  const params = [];
  if (normalize(backdrop) && backdrop.toLowerCase() !== 'all') params.push(`attrs=Backdrop___${encode(backdrop)}`);
  if (normalize(model) && model.toLowerCase() !== 'all') params.push(`attrs=Model___${encode(model)}`);
  if (normalize(symbol) && symbol.toLowerCase() !== 'all') params.push(`attrs=Symbol___${encode(symbol)}`);

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

  const { body } = await request(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
    },
  });
  const html = await body.text();
  const $ = cheerio.load(html);

  const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
  const results = [];

  $('tr').each((_, el) => {
    if (results.length >= limit) return false;

    const price = parseFloat($(el).find('[data-nft-price]').attr('data-nft-price') || '');
    const nftAddress = $(el).find('[data-nft-address]').attr('data-nft-address');
    const name = $(el).find('.table-cell-value').text().trim();
    const provider = $(el).find('.table-cell-status-thin').text().trim();

    if (!price || !nftAddress || !name || !allowedProviders.includes(provider)) return;

    results.push({
      name,
      slug: slugify(name),
      price,
      nftAddress,
      provider,
    });
  });

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
