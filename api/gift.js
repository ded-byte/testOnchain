import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'Missing slug' });

  const url = `https://t.me/nft/${slug}`;
  console.log('Fetching URL:', url); // 👈 Выводим ссылку

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000,
      validateStatus: () => true // не бросать ошибку по 404
    });

    const dom = parseDocument(html);
    const rows = findAll(el => el.name === 'tr', dom);

    const extractAttr = (label) => {
      const row = rows.find(tr => {
        const th = tr.children?.find(c => c.name === 'th');
        const text = th ? textContent(th).replace(/\s+/g, ' ').trim() : '';
        return text.includes(label); // 👈 Более мягкая проверка
      });

      if (!row) return null;

      const td = row.children?.find(c => c.name === 'td');
      if (!td) return null;

      const mark = findAll(el => el.name === 'mark', td)[0];
      const value = mark ? textContent(mark).trim() : null;

      const name = td.children
        .filter(c => c.type === 'text')
        .map(c => c.data?.trim())
        .filter(Boolean)
        .join(' ');

      return {
        name: name || null,
        value: value || null
      };
    };

    const extractOwner = () => {
      const row = rows.find(tr => {
        const th = tr.children?.find(c => c.name === 'th');
        const text = th ? textContent(th).replace(/\s+/g, ' ').trim() : '';
        return text.includes('Owner');
      });

      if (!row) return null;
      const link = findAll(el => el.name === 'a', row)[0];
      return getAttributeValue(link, 'href') || null;
    };

    const extractSignature = () => {
      const footer = findAll(
        el => el.name === 'th' && el.attribs?.class?.includes('footer'),
        dom
      )[0];

      return footer ? textContent(footer).trim() : null;
    };

    const result = {
      owner: extractOwner(),
      model: extractAttr('Model'),
      backdrop: extractAttr('Backdrop'),
      symbol: extractAttr('Symbol'),
      signature: extractSignature()
    };

    return res.status(200).json(result);

  } catch (err) {
    console.error('Parse error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch or parse', detail: err.message });
  }
}
