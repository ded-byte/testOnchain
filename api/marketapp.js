import axios from 'axios';
import { parse } from 'node-html-parser';

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

export async function fetchNFTs(nft, filters = {}, limit = 10) {
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

    const root = parse(data);
    const rows = root.querySelectorAll('tr');
    const results = [];
    const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];

    for (const row of rows) {
      if (results.length >= limit) break;

      const name = row.querySelector('div.table-cell-value.tm-value')?.text.trim();
      const price = parseFloat(row.querySelector('span[data-nft-price]')?.getAttribute('data-nft-price') || 0);
      const nftAddress = row.querySelector('span[data-nft-address]')?.getAttribute('data-nft-address');
      const provider = row.querySelector('div.table-cell-status-thin.tm-status-market')?.text.trim();

      if (!name || !price || !nftAddress || !allowedProviders.includes(provider)) continue;

      const slug = name.toLowerCase()
        .replace(/[^a-z0-9\s#]/g, '')
        .replace(/\s+/g, '')
        .replace(/#/g, '-')
        .replace(/-+/g, '-')
        .trim();

      results.push({ name, slug, price, nftAddress, provider });
    }

    return results;
  } catch (err) {
    throw new Error(`Failed to fetch NFTs: ${err.message}`);
  }
}
