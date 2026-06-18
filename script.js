// --- JEDNOLITA PALETA KOLORÓW TOŻSAMOŚCIOWYCH ---
const COLORS = {
    btc: '#ffffff',
    sth: '#ff5722',         
    lth: '#00d2ff',         
    text_profit: '#2aef18', 
    text_loss: '#ff3b30'    
};

const ZONES = {
    h1: Date.UTC(2012, 10, 28) / 1000, c1e: Date.UTC(2013, 10, 30) / 1000,
    c1b: Date.UTC(2015, 0, 14) / 1000, c2e: Date.UTC(2017, 11, 17) / 1000,
    c2b: Date.UTC(2018, 11, 16) / 1000, c3e: Date.UTC(2021, 10, 10) / 1000,
    c3b: Date.UTC(2022, 10, 21) / 1000, h4: Date.UTC(2024, 3, 20) / 1000,
    koniecZielonej: Date.UTC(2025, 9, 6) / 1000, koniecCzerwonej: Date.UTC(2026, 9, 6) / 1000 
};

function getZoneColor(t) {
    if ((t >= ZONES.h1 && t < ZONES.c1e) || (t >= ZONES.c1b && t < ZONES.c2e) || (t >= ZONES.c2b && t < ZONES.c3e) || (t >= ZONES.c3b && t < ZONES.koniecZielonej) || (t >= ZONES.koniecCzerwonej)) return 'rgba(42, 239, 24, 0.04)';
    return 'rgba(238, 23, 23, 0.05)';
}

async function fetchBitstampData() {
    let allCandles = []; let currentStartUnix = 1313625600; let isFetching = true;
    while (isFetching) {
        if (currentStartUnix > Math.floor(Date.now() / 1000)) break;
        const response = await fetch(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${currentStartUnix}`);
        const json = await response.json();
        if (!json.data || !json.data.ohlc || json.data.ohlc.length === 0) break;
        const candles = json.data.ohlc;
        for (let i = 0; i < candles.length; i++) {
            allCandles.push({ time: parseInt(candles[i].timestamp), open: parseFloat(candles[i].open), high: parseFloat(candles[i].high), low: parseFloat(candles[i].low), close: parseFloat(candles[i].close) });
        }
        currentStartUnix = parseInt(candles[candles.length - 1].timestamp) + 86400;
        if (candles.length < 1000) isFetching = false;
    }
    return allCandles;
}

async function loadLocalJson(file) {
    const r = await fetch(`./data/${file}`);
    const j = await r.json();
    return j.map(i => ({ time: Math.floor(Date.parse(i.date) / 1000), value: i.value })).sort((a,b) => a.time - b.time);
}

function setupModals() {
    const sM = document.getElementById('sth-modal'); const lM = document.getElementById('lth-modal');
    document.getElementById('card-sth').addEventListener('click', () => sM.style.display = 'flex');
    document.getElementById('card-lth').addEventListener('click', () => lM.style.display = 'flex');
    document.getElementById('close-sth-modal').addEventListener('click', () => sM.style.display = 'none');
    document.getElementById('close-lth-modal').addEventListener('click', () => lM.style.display = 'none');
    window.addEventListener('click', (e) => { if(e.target===sM) sM.style.display='none'; if(e.target===lM) lM.style.display='none'; });
}

async function init() {
    setupModals();
    try {
        const [seriesBTC, sthPriceRaw, lthPriceRaw, sthSopr, lthSopr] = await Promise.all([
            fetchBitstampData(), loadLocalJson('sth-realised-price.json'), loadLocalJson('lth-realised-price.json'),
            loadLocalJson('sth-sopr.json'), loadLocalJson('lth-sopr.json')
        ]);

        // KLUCZOWA ZMIANA: Wyrównanie lewej krawędzi danych On-Chain z danymi BTC (blokuje buga przy cofaniu)
        const btcStart = seriesBTC[0].time;
        const alignData = (arr) => {
            if (arr.length > 0 && arr[0].time > btcStart) {
                return [{ time: btcStart }, ...arr];
            }
            return arr;
        };

        const sthPriceAligned = alignData(sthPriceRaw);
        const lthPriceAligned = alignData(lthPriceRaw);
        const sthSoprAligned = alignData(sthSopr);
        const lthSoprAligned = alignData(lthSopr);

        const btcMap = new Map(seriesBTC.map(c => [c.time, c.close]));

        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const latestBTC = seriesBTC[seriesBTC.length - 1].close;
        const latestSTH = sthPriceRaw[sthPriceRaw.length - 1].value;
        const latestLTH = lthPriceRaw[lthPriceRaw.length - 1].value;

        document.getElementById('val-btc').innerText = formatUSD.format(latestBTC);
        document.getElementById('val-sth').innerText = formatUSD.
