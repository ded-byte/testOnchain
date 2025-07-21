import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 10 });
let browser;

const slugify = (name) => name.toLowerCase()
  .replace(/[^a-z0-9\s#]/g, '')
  .replace(/\s+/g, '')
  .replace(/#/g, '-')
  .replace(/-+/g, '-')
  .trim();

const buildAttrsParams = ({ backdrop, model, symbol }) => {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

  const p = [];
  if ((backdrop = normalize(backdrop)) && backdrop !== 'all') p.push(`attrs=Backdrop___${encode(backdrop)}`);
  if ((model = normalize(model)) && model !== 'all') p.push(`attrs=Model___${encode(model)}`);
  if ((symbol = normalize(symbol)) && symbol !== 'all') p.push(`attrs=Symbol___${encode(symbol)}`);

  return p.join('&');
};

const getBrowser = async () => {
  if (browser) return browser;
  const execPath = await chromium.executablePath();
  browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: execPath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
  return browser;
};

const fetchWithAxios = async (nft, filters, limit) => {
  const cacheKey = `${nft}_${JSON.stringify(filters)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const fullUrl = url + (buildAttrsParams(filters) ? `&${buildAttrsParams(filters)}` : '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);

  try {
    const res = await axios.get(fullUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': `https://marketapp.ws/collection/${nft}/`,
      },
    });
    const html = res.data;
    if (html.length < 1000 || html.includes('Just a moment') || html.includes('<meta name="robots"')) throw new Error('Bot protection');
    const parsed = parseNFTs(html, limit);
    cache.set(cacheKey, parsed);
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchWithPuppeteer = async (nft, filters, limit) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    const url = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale${buildAttrsParams(filters) ? `&${buildAttrsParams(filters)}` : ''}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 2500 });

    const html = await page.content();
    return parseNFTs(html, limit);
  } finally {
    await page.close();
  }
};

const parseNFTs = (html, limit = 10) => {
  const dom = parseDocument(html);
  const rows = findAll(el => el.name === 'tr', [dom]);
  const allowed = ['Marketapp', 'Getgems', 'Fragment'];
  const result = [];

  for (const row of rows) {
    if (result.length >= limit) break;

    const priceEl = findAll(el => el.attribs?.['data-nft-price'], [row])[0];
    const addrEl = findAll(el => el.attribs?.['data-nft-address'], [row])[0];
    const nameEl = findAll(el => el.name === 'div' && el.attribs?.class?.includes('table-cell-value'), [row])[0];
    const providerEl = findAll(el => el.name === 'div' && el.attribs?.class?.includes('table-cell-status-thin'), [row])[0];

    const price = priceEl ? parseFloat(getAttributeValue(priceEl, 'data-nft-price')) : null;
    const nftAddress = addrEl ? getAttributeValue(addrEl, 'data-nft-address') : null;
    const name = nameEl ? textContent(nameEl).trim() : null;
    const provider = providerEl ? textContent(providerEl).trim() : null;

    if (!price || !nftAddress || !name || !allowed.includes(provider)) continue;

    result.push({ name, slug: slugify(name), price, nftAddress, provider });
  }

  return result;
};

const fetchNFTs = async (nft, filters = {}, limit = 10) => {
  try {
    return await Promise.any([
      fetchWithAxios(nft, filters, limit),
      fetchWithPuppeteer(nft, filters, limit),
    ]);
  } catch (err) {
    console.warn('All fetch methods failed:', err);
    return [];
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { nft, backdrop, model, symbol, limit = 10 } = req.body;
  if (!nft || typeof nft !== 'string') return res.status(400).json({ error: 'Field "nft" is required.' });

  try {
    const data = await fetchNFTs(nft, { backdrop, model, symbol }, limit);
    if (data.length === 0) return res.status(404).json({ error: 'No NFTs found.' });
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
