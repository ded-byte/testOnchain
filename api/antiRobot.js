import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 10, checkperiod: 12 });

let browser = null;
let page = null;

async function getBrowser() {
  if (!browser) {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });
    console.log('Browser launched');
  }
  return browser;
}

async function getPage() {
  if (!page) {
    console.log('Opening new page...');
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'stylesheet', 'font', 'script', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });
    console.log('Page opened');
  }
  return page;
}

async function closeBrowser() {
  if (browser) {
    console.log('Closing browser...');
    await browser.close();
    browser = null;
  }
}

async function closePage() {
  if (page) {
    console.log('Closing page...');
    await page.close();
    page = null;
  }
}

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

  const params = [];
  if (normalize(backdrop) !== 'all') params.push(`attrs=Backdrop___${encode(backdrop)}`);
  if (normalize(model) !== 'all') params.push(`attrs=Model___${encode(model)}`);
  if (normalize(symbol) !== 'all') params.push(`attrs=Symbol___${encode(symbol)}`);

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

async function fetchWithRetry(url, options = {}, retries = 3, delay = 400) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      const response = await axios.get(url, {
        signal: controller.signal,
        timeout: 1500,
        ...options,
      });

      clearTimeout(timeout);
      return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function parseNFTs(html, limit = 10) {
  const dom = parseDocument(html);
  const rows = findAll(el => el.name === 'tr', [dom]);

  const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
  const results = [];

  for (const row of rows) {
    if (results.length >= limit) break;

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

async function fetchNFTsWithAxios(nft, filters = {}, limit = 10) {
  const cacheKey = `${nft}_${JSON.stringify(filters)}`;
  const cachedData = cache.get(cacheKey);
  if (cachedData) return cachedData;

  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  const { data: html } = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'text/html',
      'Referer': `https://marketapp.ws/collection/${nft}/`,
    },
  });

  if (
    html.length < 1000 ||
    html.includes('Just a moment') ||
    html.includes('<meta name="robots" content="noindex"') ||
    html.includes('data:image/gif;base64')
  ) {
    throw new Error('Bot protection triggered');
  }

  const result = parseNFTs(html, limit);
  cache.set(cacheKey, result);
  return result;
}

async function fetchNFTsWithPuppeteer(nft, filters = {}, limit = 10) {
  const page = await getPage();
  const baseUrl = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const attrsParams = buildAttrsParams(filters);
  const url = `${baseUrl}${attrsParams ? `&${attrsParams}` : ''}`;

  try {
    console.log('Navigating to URL:', url);
    await page.goto(url, { waitUntil: 'load', timeout: 2000 });
    const html = await page.content();
    return parseNFTs(html, limit);
  } catch (err) {
    console.error('Puppeteer request failed:', err.message);
    throw new Error('Puppeteer request failed: ' + err.message);
  }
}

async function fetchNFTs(nft, filters = {}, limit = 10) {
  try {
    const axiosRequest = fetchNFTsWithAxios(nft, filters, limit);
    const puppeteerRequest = fetchNFTsWithPuppeteer(nft, filters, limit);

    const results = await Promise.race([
      axiosRequest,
      new Promise((resolve, reject) => setTimeout(() => reject('Axios request timeout'), 1000)),
      puppeteerRequest,
      new Promise((resolve, reject) => setTimeout(() => reject('Puppeteer request timeout'), 2000)),
    ]);

    return results;
  } catch (err) {
    console.warn('Error fetching NFTs:', err.message);
    return [];
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
      return res.status(404).json({ error: `No NFTs found for collection "${nft}".` });
    }
    return res.status(200).json(nfts);
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}
