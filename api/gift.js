import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { findAll, getAttributeValue, textContent } from 'domutils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { slug } = req.body;
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' });
  }

  const url = `https://t.me/nft/${slug}`;

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000
    });

    const dom = parseDocument(html);
    const rows = findAll(el => el.name === 'tr', dom);

    const extract = (label) => {
      const row = rows.find(tr => {
        const th = tr.children?.find(c => c.name === 'th');
        return th && textContent(th).trim() === label;
      });
      if (!row) return null;

      const td = row.children?.find(c => c.name === 'td');
      if (!td) return null;

      const text = textContent(td).replace(/\s+/g, ' ').trim();
      return text;
    };

    const extractWithMark = (label) => {
      const row = rows.find(tr => {
        const th = tr.children?.find(c => c.name === 'th');
        return th && textContent(th).trim() === label;
      });
      if (!row) return null;

      const td = row.children?.find(c => c.name === 'td');
      if (!td) return null;

      const rawText = textContent(td).replace(/\s+/g, ' ').trim();
      return rawText;
    };

    const ownerRow = rows.find(tr => {
      const th = tr.children?.find(c => c.name === 'th');
      return th && textContent(th).trim() === 'Owner';
    });

    const owner = ownerRow
      ? getAttributeValue(findAll(el => el.name === 'a', ownerRow)[0], 'href')
      : null;

    const footer = findAll(el => el.attribs?.class === 'footer', dom)[0];
    const signature = footer
      ? textContent(footer).split(' with the comment “')[1]?.replace(/”$/, '').trim()
      : null;

    return res.status(200).json({
      owner,
      model: extractWithMark('Model'),
      backdrop: extractWithMark('Backdrop'),
      symbol: extractWithMark('Symbol'),
      signature
    });

  } catch (err) {
    console.error('Fetch/parsing error:', err);
    return res.status(500).json({ error: 'Failed to parse NFT page', detail: err.message });
  }
}
