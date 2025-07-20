import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { Parser } from 'htmlparser2';

let browser;

async function initBrowser() {
  if (!browser || !(await browser.isConnected())) {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      devtools: false,
      disableGpu: true,
      noSandbox: true,
    });
    console.log('Browser initialized');
  }
  return browser;
}

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

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
  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  const startTime = Date.now();

  try {
    const browserInstance = await initBrowser();
    const page = await browserInstance.newPage();

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (['image', 'stylesheet', 'font', 'script', 'media'].includes(request.resourceType())) {
        request.abort();
      } else {
        request.continue();
      }
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 1500 });

    const html = await page.content();

    const nfts = [];
    const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
    let currentRow = null;
    let currentElement = null;
    let textBuffer = '';

    const parser = new Parser({
      onopentag(name, attributes) {
        if (name === 'tr') {
          currentRow = {};
        } else if (name === 'td' || name === 'div') {
          if (attributes['data-nft-price']) {
            currentRow.price = parseFloat(attributes['data-nft-price']) || null;
          } else if (attributes['data-nft-address']) {
            currentRow.nftAddress = attributes['data-nft-address'] || null;
          } else if (attributes.class && attributes.class.includes('table-cell-value')) {
            currentElement = 'name';
          } else if (attributes.class && attributes.class.includes('table-cell-status-thin')) {
            currentElement = 'provider';
          }
        }
      },
      ontext(text) {
        if (currentElement) {
          textBuffer += text.trim();
        }
      },
      onclosetag(name) {
        if (name === 'tr' && currentRow) {
          if (currentRow.name && currentRow.price && currentRow.nftAddress && allowedProviders.includes(currentRow.provider)) {
            nfts.push({
              name: currentRow.name,
              slug: currentRow.name
                .toLowerCase()
                .replace(/[^a-z0-9\s#]/g, '')
                .replace(/\s+/g, '')
                .replace(/#/g, '-')
                .replace(/-+/g, '-')
                .trim(),
              price: currentRow.price,
              nftAddress: currentRow.nftAddress,
              provider: currentRow.provider,
            });
          }
          currentRow = null;
        } else if (name === 'td' || name === 'div') {
          if (currentElement === 'name') {
            currentRow.name = textBuffer || null;
          } else if (currentElement === 'provider') {
            currentRow.provider = textBuffer || null;
          }
          currentElement = null;
          textBuffer = '';
        }
        if (nfts.length >= limit) {
          parser.end();
        }
      },
    }, { decodeEntities: true });

    parser.write(html);
    parser.end();

    console.log('Fetch time:', Date.now() - startTime, 'ms');

    await page.close();

    return nfts;
  } catch (err) {
    console.error('Error fetching NFTs:', err);
    throw new Error('Failed to fetch NFTs from marketapp.ws');
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