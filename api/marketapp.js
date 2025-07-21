import fetch from 'node-fetch';

const GIFTASSET_API = 'https://giftasset.pro/api/v1/gifts/get_gifts_on_sale';
const API_KEY = '8Hj5Kp2Rn9Xc7LwQ3Yv6Tz4Bb1Nm9Fs2D';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'The method is not allowed.' });
  }

  const { nft, model, backdrop, symbol } = req.body;

  if (!nft) {
    return res.status(400).json({ error: 'NFT field is mandatory.' });
  }

  const normalize = (str) => str?.trim();
  const isValidAttr = (attr) => attr && attr.value && attr.value !== 'All';

  const queryParams = new URLSearchParams();
  queryParams.append('provider_name', 'tonnel');
  queryParams.append('gift_name', normalize(nft));

  if (isValidAttr(model)) {
    queryParams.append('gift_model', normalize(model.value));
  }
  if (isValidAttr(backdrop)) {
    queryParams.append('gift_backdrop', normalize(backdrop.value));
  }
  if (isValidAttr(symbol)) {
    queryParams.append('gift_symbol', normalize(symbol.value));
  }

  const url = `${GIFTASSET_API}?${queryParams.toString()}`;

  const headers = {
    'accept': '*/*',
    'x-api-key': API_KEY
  };

  const sendRequest = async (attempt = 1) => {
    try {
      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const result = await response.json();
      return result;
    } catch (err) {
      if (attempt < 3) {
        console.warn(`Attempt ${attempt} failed. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        return sendRequest(attempt + 1);
      } else {
        throw new Error('Failed to fetch after 3 attempts');
      }
    }
  };

  try {
    const data = await sendRequest();
    return res.status(200).json(data);
  } catch (err) {
    console.error('Request error:', err);
    return res.status(500).json({ error: 'Error fetching data from GiftAsset API', detail: err.message });
  }
}
