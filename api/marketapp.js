import axios from 'axios';
import { Agent } from 'https';
import * as htmlparser2 from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';
import LRU from 'lru-cache';

// ✅ Keep-Alive агент
const httpsAgent = new Agent({ keepAlive: true });

// ✅ Инстанс axios с кастомным агентом
const axiosInstance = axios.create({
  httpsAgent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'text/html',
  },
  timeout: 5000,
});

// ✅ Кеширование HTML (НЕ данных поиска)
const htmlCache = new LRU({
  max: 30,
  ttl: 1000 * 30, // 30 сек
});

// 🔍 Главная функция парсинга
export default async function handler(req, res) {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'Missing address parameter' });
  }

  const url = `https://marketapp.ws/nft/${address}/`;

  try {
    let html;

    if (htmlCache.has(url)) {
      html = htmlCache.get(url);
    } else {
      const { data } = await axiosInstance.get(url);
      html = data;
      htmlCache.set(url, html);
    }

    const dom = htmlparser2.parseDocument(html);
    const nftTitle = textContent(findAll(el => el.name === 'h1', dom)[0] || '').trim();

    // Цена
    const priceEl = findAll(el =>
      el.name === 'span' &&
      getAttributeValue(el, 'class')?.includes('price'), dom
    )[0];
    const price = textContent(priceEl || '').replace(/\s+/g, ' ').trim();

    // Ссылка на коллекцию
    const collectionAnchor = findAll(el =>
      el.name === 'a' &&
      getAttributeValue(el, 'href')?.includes('/collection/'), dom
    )[0];
    const collection = {
      name: textContent(collectionAnchor || '').trim(),
      href: getAttributeValue(collectionAnchor, 'href') || ''
    };

    return res.status(200).json({
      success: true,
      title: nftTitle,
      price,
      collection,
    });

  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch or parse page', details: error.message });
  }
}
