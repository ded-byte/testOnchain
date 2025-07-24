import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 10 });

let browser, page;

function slugify(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s#]/g, '')
    .replace(/\s+/g, '')
    .replace(/#/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = str => str.replace(/\s+/g, '+');
  const normalize = v => typeof v === 'string' ? v.trim().toLowerCase() : '';

  const p = [];
  if ((backdrop = normalize(backdrop)) && backdrop !== 'all') p.push(`attrs=Backdrop___${encode(backdrop)}`);
  if ((model = normalize(model)) && model !== 'all') p.push(`attrs=Model___${encode(model)}`);
  if ((symbol = normalize(symbol)) && symbol !== 'all') p.push(`attrs=Symbol___${encode(symbol)}`);

  return p.join('&');
}

async function initBrowser() {
  if (browser && page) return;
  const execPath = await chromium.executablePath();

  browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  page = await browser.newPage();

  // блокируем всё лишнее
  await page.setRequestInterception(true);
  page.on('request', req => {
    const block = ['stylesheet', 'font', 'image', 'media'];
    if (block.includes(req.resourceType())) req.abort();
    else req.continue();
  });

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  await page.setCacheEnabled(false);
}

async function fetchFast(nft, filters, limit = 10) {
  const cacheKey = `${nft}_${JSON.stringify(filters)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const base = `https://marketapp.ws/collection/${nft}/?market_filter_by=on_chain&tab=nfts&view=list&query=&sort_by=price_asc&filter_by=sale`;
  const url = buildAttrsParams(filters) ? `${base}&${buildAttrsParams(filters)}` : base;

  await initBrowser();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 2000 });
    await page.waitForSelector('tr', { timeout: 700 }); // только таблицу, не весь DOM

    const html = await page.content();
    const parsed = parseNFTs(html, limit);
    cache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.warn('Puppeteer failed:', err.message);
    return [];
  }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { nft, backdrop, model, symbol, limit = 10 } = req.body;
  if (!nft || typeof nft !== 'string') return res.status(400).json({ error: 'Field "nft" is required.' });

  try {
    const data = await fetchFast(nft, { backdrop, model, symbol }, limit);
    if (data.length === 0) return res.status(404).json({ error: `No NFTs found.` });
    return res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
