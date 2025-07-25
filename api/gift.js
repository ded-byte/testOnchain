import axios from 'axios';
import cheerio from 'cheerio';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Only POST allowed' });

  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'Missing slug' });

  const url = `https://t.me/nft/${slug}`;
  console.log('Fetching URL:', url);

  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 1000,
      validateStatus: () => true,
    });

    const $ = cheerio.load(html);
    const rows = $('tr');

    const attrMap = new Map();

    rows.each((_, el) => {
      const th = $(el).find('th').first();
      const td = $(el).find('td').first();

      const label = th.text().trim();
      if (!label) return;

      const mark = td.find('mark').first();
      const value = mark.length ? mark.text().trim() : null;

      // Удаляем <mark> и берём оставшийся текст
      mark.remove();
      const name = td.text().trim() || null;

      attrMap.set(label, { name, value });
    });

    // Owner
    const ownerTr = rows.filter((_, el) => {
      return $(el).find('th').text().trim() === 'Owner';
    });

    let owner = null;
    if (ownerTr.length) {
      const a = ownerTr.find('a[href^="https://t.me/"]').first();
      const name = a.find('span').text().trim() || null;
      const link = a.attr('href') || null;

      if (name || link) {
        owner = { name, link };
      }
    }

    // Signature
    const footer = $('th.footer').first();
    const signature = footer.length ? footer.text().trim() : null;

    return res.status(200).json({
      owner,
      model: attrMap.get('Model') || null,
      backdrop: attrMap.get('Backdrop') || null,
      symbol: attrMap.get('Symbol') || null,
      signature,
    });
  } catch (err) {
    console.error('Parse error:', err.message);
    return res.status(500).json({
      error: 'Failed to fetch or parse',
      detail: err.message,
    });
  }
}
