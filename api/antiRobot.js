import puppeteer from 'puppeteer';

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

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });

  const html = await page.content();
  await browser.close();

  const rows = [];
  const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
  const results = [];

  const dom = new DOMParser().parseFromString(html, 'text/html');
  const rowElements = dom.querySelectorAll('tr'); // Предположим, что строки находятся в <tr> элементах

  rowElements.forEach((row) => {
    if (results.length >= limit) return;

    const priceEl = row.querySelector('[data-nft-price]');
    const addrEl = row.querySelector('[data-nft-address]');
    const nameEl = row.querySelector('.table-cell-value');
    const providerEl = row.querySelector('.table-cell-status-thin');

    const price = priceEl ? parseFloat(priceEl.getAttribute('data-nft-price')) : null;
    const nftAddress = addrEl ? addrEl.getAttribute('data-nft-address') : null;
    const name = nameEl ? nameEl.textContent.trim() : null;
    const provider = providerEl ? providerEl.textContent.trim() : null;

    if (!price || !nftAddress || !name || !allowedProviders.includes(provider)) return;

    results.push({
      name,
      slug: slugify(name),
      price,
      nftAddress,
      provider
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
