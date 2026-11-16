// Instruments tradable on DSX. Everything is quoted in USD.
// source: 'coinbase' => live websocket ticks; 'yahoo' => polled quotes.

const MARKETS = [
  // Crypto (24/7, live via Coinbase)
  { symbol: 'BTC',  name: 'Bitcoin',   category: 'crypto', source: 'coinbase', feed: 'BTC-USD',  qtyDecimals: 6, priceDecimals: 2 },
  { symbol: 'ETH',  name: 'Ethereum',  category: 'crypto', source: 'coinbase', feed: 'ETH-USD',  qtyDecimals: 5, priceDecimals: 2 },
  { symbol: 'SOL',  name: 'Solana',    category: 'crypto', source: 'coinbase', feed: 'SOL-USD',  qtyDecimals: 4, priceDecimals: 2 },
  { symbol: 'XRP',  name: 'XRP',       category: 'crypto', source: 'coinbase', feed: 'XRP-USD',  qtyDecimals: 2, priceDecimals: 4 },
  { symbol: 'DOGE', name: 'Dogecoin',  category: 'crypto', source: 'coinbase', feed: 'DOGE-USD', qtyDecimals: 1, priceDecimals: 5 },
  { symbol: 'ADA',  name: 'Cardano',   category: 'crypto', source: 'coinbase', feed: 'ADA-USD',  qtyDecimals: 2, priceDecimals: 4 },
  { symbol: 'AVAX', name: 'Avalanche', category: 'crypto', source: 'coinbase', feed: 'AVAX-USD', qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'LINK', name: 'Chainlink', category: 'crypto', source: 'coinbase', feed: 'LINK-USD', qtyDecimals: 3, priceDecimals: 3 },

  // Metals (COMEX futures via Yahoo)
  { symbol: 'XAU', name: 'Gold',      category: 'metals', source: 'yahoo', feed: 'GC=F', unit: 'oz', qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'XAG', name: 'Silver',    category: 'metals', source: 'yahoo', feed: 'SI=F', unit: 'oz', qtyDecimals: 2, priceDecimals: 3 },
  { symbol: 'XPT', name: 'Platinum',  category: 'metals', source: 'yahoo', feed: 'PL=F', unit: 'oz', qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'XCU', name: 'Copper',    category: 'metals', source: 'yahoo', feed: 'HG=F', unit: 'lb', qtyDecimals: 1, priceDecimals: 4 },

  // Stocks
  { symbol: 'AAPL',  name: 'Apple',      category: 'stocks', source: 'yahoo', feed: 'AAPL',  qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'NVDA',  name: 'NVIDIA',     category: 'stocks', source: 'yahoo', feed: 'NVDA',  qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'TSLA',  name: 'Tesla',      category: 'stocks', source: 'yahoo', feed: 'TSLA',  qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'MSFT',  name: 'Microsoft',  category: 'stocks', source: 'yahoo', feed: 'MSFT',  qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'AMZN',  name: 'Amazon',     category: 'stocks', source: 'yahoo', feed: 'AMZN',  qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'GOOGL', name: 'Alphabet',   category: 'stocks', source: 'yahoo', feed: 'GOOGL', qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'META',  name: 'Meta',       category: 'stocks', source: 'yahoo', feed: 'META',  qtyDecimals: 3, priceDecimals: 2 },

  // Index ETFs
  { symbol: 'SPY', name: 'S&P 500 ETF',    category: 'indices', source: 'yahoo', feed: 'SPY', qtyDecimals: 3, priceDecimals: 2 },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', category: 'indices', source: 'yahoo', feed: 'QQQ', qtyDecimals: 3, priceDecimals: 2 },

  // Forex (base currency priced in USD)
  { symbol: 'EUR', name: 'Euro',              category: 'forex', source: 'yahoo', feed: 'EURUSD=X', qtyDecimals: 2, priceDecimals: 5 },
  { symbol: 'GBP', name: 'British Pound',     category: 'forex', source: 'yahoo', feed: 'GBPUSD=X', qtyDecimals: 2, priceDecimals: 5 },
  { symbol: 'AUD', name: 'Australian Dollar', category: 'forex', source: 'yahoo', feed: 'AUDUSD=X', qtyDecimals: 2, priceDecimals: 5 },
];

const BY_SYMBOL = Object.fromEntries(MARKETS.map((m) => [m.symbol, m]));

const CATEGORIES = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'metals', label: 'Metals' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'indices', label: 'Indices' },
  { id: 'forex', label: 'Forex' },
];

module.exports = { MARKETS, BY_SYMBOL, CATEGORIES };
