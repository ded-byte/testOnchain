import axios from 'axios';
import htmlparser2 from 'htmlparser2';

function buildAttrsParams({ backdrop, model, symbol }) {
  const encode = (str) => str.replace(/\s+/g, '+');
  const normalize = (v) => typeof v === 'string' ? v.trim().toLowerCase() : '';

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

  const allowedProviders = ['Marketapp', 'Getgems', 'Fragment'];
  const nftResults = [];

  return new Promise((resolve, reject) => {
    const parser = new htmlparser2.Parser({
      onopentag(name, attributes) {
        if (name === 'tr') {
          this.currentRow = {};
        } else if (name === 'div' && attributes.class === 'table-cell-value tm-value') {
          this.insideNameDiv = true;
        } else if (name === 'span' && 'data-nft-price' in attributes) {
          this.currentRow.price = parseFloat(attributes['data-nft-price']);
        } else if (name === 'span' && 'data-nft-address' in attributes) {
          this.currentRow.nftAddress = attributes['data-nft-address'];
        } else if (name === 'div' && attributes.class === 'table-cell-status-thin tm-status-market') {
          this.insideProviderDiv = true;
        }
      },
      ontext(text) {
        if (this.insideNameDiv) {
          this.currentRow.name = text.trim();
        } else if (this.insideProviderDiv) {
          this.currentRow.provider = text.trim();
        }
      },
      onclosetag(name) {
        if (name === 'tr' && this.currentRow) {
          const { name, price, nftAddress, provider } = this.currentRow;
          if (name && price && nftAddress && allowedProviders.includes(provider)) {
            const slug = name.toLowerCase()
              .replace(/[^a-z0-9\s#]/g, '')
              .replace(/\s+/g, '')
              .replace(/#/g, '-')
              .replace(/-+/g, '-')
              .trim();
            nftResults.push({ name, slug, price, nftAddress, provider });
            if (nftResults.length >= limit) {
              parser.end();
              resolve(nftResults);
            }
          }
          this.currentRow = null;
        } else if (name === 'div') {
          this.insideNameDiv = false;
          this.insideProviderDiv = false;
        }
      },
      onerror(error) {
        reject(new Error(`Failed to parse NFTs: ${error.message}`));
      }
    }, { decodeEntities: true });

    axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://marketapp.ws/',
        'Accept': 'text/html'
      },
      responseType: 'stream'
    }).then(response => {
      response.data.pipe(parser);
    }).catch(error => {
      reject(new Error(`Failed to fetch NFTs: ${error.message}`));
    });
  });
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
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
}