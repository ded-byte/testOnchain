import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300, checkperiod: 320 });

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

async function fetchNFTs(nft, filters = {}, limit = 10) {
  const cacheKey = `${nft}-${JSON.stringify(filters)}-${limit}`;

  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log('Returning cached data');
    return cachedResult;
  }

  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  let browser;

  try {
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || req.resourceType() === 'font') {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });

    await page.waitForTimeout(300);
    await page.evaluate(() => {
      window.scrollBy(0, 600);
    });
    await page.waitForTimeout(500);

    await page.waitForSelector('tr', { timeout: 5000 });

    const results = await page.evaluate((limit) => {
      const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
      const rows = Array.from(document.querySelectorAll('tr'));
      const nfts = [];

      for (const row of rows) {
        if (nfts.length >= limit) break;

        const priceEl = row.querySelector('[data-nft-price]');
        const addrEl = row.querySelector('[data-nft-address]');
        const nameEl = row.querySelector('.table-cell-value');
        const providerEl = row.querySelector('.table-cell-status-thin');

        const price = priceEl ? parseFloat(priceEl.getAttribute('data-nft-price')) : null;
        const nftAddress = addrEl ? addrEl.getAttribute('data-nft-address') : null;
        const name = nameEl ? nameEl.textContent.trim() : null;
        const provider = providerEl ? providerEl.textContent.trim() : null;

        if (!price || !nftAddress || !name || !allowedProviders.includes(provider)) continue;

        nfts.push({
          name,
          slug: name.toLowerCase()
            .replace(/[^a-z0-9\s#]/g, '')
            .replace(/\s+/g, '')
            .replace(/#/g, '-')
            .replace(/-+/g, '-')
            .trim(),
          price,
          nftAddress,
          provider
        });
      }

      return nfts;
    }, limit);

    cache.set(cacheKey, results);

    return results;
  } catch (err) {
    console.error('Browser error:', err);
    throw new Error('Failed to fetch NFTs from marketapp.ws');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
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
    console.error('Error in handler:', error);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
