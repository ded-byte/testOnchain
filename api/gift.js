import axios from 'axios';
import { parseDocument } from 'htmlparser2';
import { DomUtils } from 'htmlparser2';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'Missing slug' });

  const url = `https://t.me/nft/${slug}`;
  console.log('Fetching URL:', url);

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 300,
      validateStatus: () => true,
    });

    const dom = parseDocument(html);

    const trs = DomUtils.findAll(el => el.name === 'tr', dom);

    const attrMap = new Map();

    for (const tr of trs) {
      const th = DomUtils.findOne(el => el.name === 'th', tr);
      const td = DomUtils.findOne(el => el.name === 'td', tr);
      if (!th || !td) continue;

      const label = DomUtils.textContent(th).replace(/\s+/g, ' ').trim();

      const mark = DomUtils.findOne(el => el.name === 'mark', td);
      const value = mark ? DomUtils.textContent(mark).trim() : null;

      const filteredChildren = td.children.filter(c => !(c.type === 'tag' && c.name === 'mark'));
      const name = DomUtils.getText(filteredChildren).replace(/\s+/g, ' ').trim() || null;

      attrMap.set(label, { name, value });
    }

    const ownerTr = trs.find(tr => {
      const th = DomUtils.findOne(el => el.name === 'th', tr);
      if (!th) return false;
      return DomUtils.textContent(th).replace(/\s+/g, ' ').trim() === 'Owner';
    });
    let owner = null;
    if (ownerTr) {
      const span = DomUtils.findOne(el => el.name === 'span', ownerTr);
      owner = span ? DomUtils.textContent(span).trim() : null;
    }

    const footerTh = DomUtils.findOne(el => el.name === 'th' && el.attribs?.class?.includes('footer'), dom);
    const signature = footerTh ? DomUtils.textContent(footerTh).trim() : null;

    const result = {
      owner,
      model: attrMap.get('Model') || null,
      backdrop: attrMap.get('Backdrop') || null,
      symbol: attrMap.get('Symbol') || null,
      signature,
    };

    return res.status(200).json(result);
  } catch (err) {
    console.error('Parse error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch or parse', detail: err.message });
  }
}
