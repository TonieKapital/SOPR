// --- USTAWIENIA PALETY KOLORÓW ---
const COLORS = {
    btc: '#ffffff',
    sth: '#ff5722' // Pomarańczowo-czerwony kolor
};

// --- LOGIKA STREF HALVINGOWYCH/CYKLI (Pine Script) ---
const ZONES = {
    h1: Date.UTC(2012, 10, 28) / 1000,
    c1e: Date.UTC(2013, 10, 30) / 1000,
    c1b: Date.UTC(2015, 0, 14) / 1000,
    c2e: Date.UTC(2017, 11, 17) / 1000,
    c2b: Date.UTC(2018, 11, 16) / 1000,
    c3e: Date.UTC(2021, 10, 10) / 1000,
    c3b: Date.UTC(2022, 10, 21) / 1000,
    h4: Date.UTC(2024, 3, 20) / 1000,
    koniecZielonej: Date.UTC(2025, 9, 6) / 1000,
    koniecCzerwonej: Date.UTC(2026, 9, 6) / 1000 
};

function getZoneColor(t) {
    const greenZone = 'rgba(42, 239, 24, 0.04)';
    const redZone = 'rgba(238, 23, 23, 0.05)';

    if (t >= ZONES.h1 && t < ZONES.c1e) return greenZone; 
    if (t >= ZONES.c1e && t < ZONES.c1b) return redZone; 
    if (t >= ZONES.c1b && t < ZONES.c2e) return greenZone; 
    if (t >= ZONES.c2e && t < ZONES.c2b) return redZone; 
    if (t >= ZONES.c2b && t < ZONES.c3e) return greenZone; 
    if (t >= ZONES.c3e && t < ZONES.c3b) return redZone; 
    if (t >= ZONES.c3b && t < ZONES.koniecZielonej) return greenZone; 
    if (t >= ZONES.koniecZielonej && t < ZONES.koniecCzerwonej) return redZone; 
    if (t >= ZONES.koniecCzerwonej) return greenZone; 
    return 'transparent';
}

// --- POBIERANIE DANYCH BTC Z BITSTAMP API ---
async function fetchBitstampData() {
    let allCandles = [];
    let currentStartUnix = 1313625600; // Dane od 2011 r.
    let isFetching = true;

    while (isFetching) {
        if (currentStartUnix > Math.floor(Date.now() / 1000)) break; 

        const url = `https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000&start=${currentStartUnix}`;
        const response = await fetch(url);
        const json = await response.json();

        if (!json.data || !json.data.ohlc || json.data.ohlc.length === 0) {
            isFetching = false;
            break;
        }

        const candles = json.data.ohlc;

        for (let i = 0; i < candles.length; i++) {
            // Zapisujemy pełne dane OHLC dla świec
            allCandles.push({
                time: parseInt(candles[i].timestamp),
                open: parseFloat(candles[i].open),
                high: parseFloat(candles[i].high),
                low: parseFloat(candles[i].low),
                close: parseFloat(candles[i].close)
            });
        }

        currentStartUnix = parseInt(candles[candles.length - 1].timestamp) + 86400;
        
        if (candles.length < 1000) {
            isFetching = false;
        }
    }
    return allCandles;
}

// --- POBIERANIE NOWEGO WSKAŹNIKA Z TWOJEGO PLIKU JSON ---
async function fetchSthData() {
    const response = await fetch('./data/sth-realised-price.json');
    if (!response.ok) throw new Error("Nie znaleziono pliku bazy danych sth-realised-price.json.");
    const json = await response.json();
    
    return json.map(item => ({
        time: Math.floor(Date.parse(item.date) / 1000),
        value: item.value
    })).sort((a, b) => a.time - b.time);
}

// --- OBSŁUGA MODALA (POPUPU) EDUKACYJNEGO ---
function setupModal() {
    const modal = document.getElementById('sth-modal');
    const card = document.getElementById('card-sth');
    const closeBtn = document.getElementById('close-modal');

    card.addEventListener('click', () => { modal.style.display = 'flex'; });
    closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.style.display = 'none';
    });
}

async function init() {
    setupModal(); // Uruchomienie obsługi okienka

    try {
        const [seriesBTC, seriesSTH] = await Promise.all([
            fetchBitstampData(),
            fetchSthData()
        ]);

        if (seriesBTC.length === 0 || seriesSTH.length === 0) throw new Error("Błąd ładowania serii danych.");

        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const latestBTC = seriesBTC[seriesBTC.length - 1].close;
        const latestSTH = seriesSTH[seriesSTH.length - 1].value;

        document.getElementById('val-btc').innerText = formatUSD.format(latestBTC);
        document.getElementById('val-sth').innerText = formatUSD.format(latestSTH);

        document.getElementById('loading').style.display = 'none';
        document.getElementById('controls-bar').style.display = 'flex';
        document.getElementById('chart-wrapper').style.display = 'flex';

        setTimeout(() => {
            const chartContainer = document.getElementById('chart-main');
            const chart = LightweightCharts.createChart(chartContainer, {
                autoSize: true,
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter, sans-serif' },
                grid: { vertLines: { color: 'rgba(255, 255, 255, 0.04)' }, horzLines: { color: 'rgba(255, 255, 255, 0.04)' } },
                rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Normal, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
                leftPriceScale: { visible: false }, 
                timeScale: { borderVisible: false, timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 3 }, horzLine: { color: 'rgba(255, 255, 255, 0.2)', width: 1, style: 3 } }
            });

            new ResizeObserver(entries => {
                if (entries.length === 0 || entries[0].target !== chartContainer) return;
                const newRect = entries[0].contentRect;
                chart.applyOptions({ height: newRect.height, width: newRect.width });
            }).observe(chartContainer);

            // --- STRONA GRAFICZNA: TŁA CYKLI ---
            const zoneSeries = chart.addHistogramSeries({
                priceScaleId: 'zones',
                priceFormat: { type: 'volume' },
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });

            chart.priceScale('zones').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });

            let zoneData = seriesBTC.map(pt => ({ time: pt.time, value: 1, color: getZoneColor(pt.time) }));
            let lastTime = seriesBTC[seriesBTC.length - 1].time;
            const targetFutureDate = Date.UTC(2028, 0, 1) / 1000;
            
            for (let t = lastTime + 86400; t <= targetFutureDate; t += 86400) {
                zoneData.push({ time: t, value: 1, color: getZoneColor(t) });
            }
            zoneSeries.setData(zoneData);
            zoneSeries.applyOptions({ visible: false }); 

            // --- SERIA 1A: CENA BTC JAKO LINIA ---
            const lineBTC = chart.addLineSeries({ priceScaleId: 'right', color: COLORS.btc, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            // Mapowanie OHLC do prostej linii (wykorzystujemy cenę zamknięcia)
            lineBTC.setData(seriesBTC.map(c => ({ time: c.time, value: c.close })));

            // --- SERIA 1B: CENA BTC JAKO ŚWIECE ---
            const candleBTC = chart.addCandlestickSeries({
                priceScaleId: 'right',
                upColor: '#26a69a',
                downColor: '#ef5350',
                borderVisible: false,
                wickUpColor: '#26a69a',
                wickDownColor: '#ef5350',
                visible: false // Domyslnie wyłączone
            });
            candleBTC.setData(seriesBTC);

            // --- SERIA 2: STH REALISED PRICE ---
            const lineSTH = chart.addLineSeries({ priceScaleId: 'right', color: COLORS.sth, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineSTH.setData(seriesSTH);

            chart.timeScale().fitContent();

            // --- OBSŁUGA INTERAKTYWNEGO TOOLTIPA ---
            const toolTip = document.getElementById('tv-tooltip');
            const mapBTC = new Map(seriesBTC.map(p => [p.time, p.close])); // Używamy ceny Close do tooltipa
            const mapSTH = new Map(seriesSTH.map(p => [p.time, p.value]));

            chart.subscribeCrosshairMove(param => {
                if (param.point === undefined || !param.time || param.point.x < 0 || param.point.x > chartContainer.clientWidth || param.point.y < 0 || param.point.y > chartContainer.clientHeight) {
                    toolTip.style.display = 'none'; return;
                }

                const timeSec = param.time;
                const d = new Date(timeSec * 1000);
                const dateStr = `${d.getUTCDate()}.${(d.getUTCMonth()+1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
                let html = `<div class="tooltip-date">${dateStr}</div>`;
                let showTooltip = false;

                // Pokazujemy cenę z mapy, niezależnie czy włączone są świece czy linia
                const isBtcVisible = lineBTC.options().visible || candleBTC.options().visible;

                if (isBtcVisible && mapBTC.has(timeSec)) {
                    html += `<div class="tooltip-row"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.btc};"></span><span class="tooltip-label">Cena BTC</span></span> <span class="tooltip-value">${formatUSD.format(mapBTC.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }
                if (lineSTH.options().visible && mapSTH.has(timeSec)) {
                    html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.sth};"></span><span class="tooltip-label">STH Realised Price</span></span> <span class="tooltip-value">${formatUSD.format(mapSTH.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }

                if (!showTooltip && !zoneSeries.options().visible) {
                    toolTip.style.display = 'none'; return;
                }

                toolTip.innerHTML = html;
                toolTip.style.display = 'block';

                let xPos = param.point.x + 20; 
                if (xPos + toolTip.offsetWidth > chartContainer.clientWidth - 20) xPos = param.point.x - toolTip.offsetWidth - 20;
                toolTip.style.left = xPos + 'px'; toolTip.style.top = param.point.y + 'px';
            });

            // --- OBSŁUGA PANELU KONTROLNEGO ---
            
            // Logika dla włączania/wyłączania całego Bitcoina z panelu dolnego (gdy użytkownik ma włączone świece i klika 'Cena BTC')
            const btnBtc = document.querySelector('[data-series="btc"]');
            btnBtc.addEventListener('click', function() {
                const isActive = this.classList.contains('active');
                if (isActive) {
                    this.classList.remove('active'); 
                    lineBTC.applyOptions({ visible: false });
                    candleBTC.applyOptions({ visible: false });
                } else {
                    this.classList.add('active'); 
                    if (isCandleMode) candleBTC.applyOptions({ visible: true });
                    else lineBTC.applyOptions({ visible: true });
                }
            });

            // Logika dla STH
            const btnSth = document.querySelector('[data-series="sth"]');
            btnSth.addEventListener('click', function() {
                const isActive = this.classList.contains('active');
                if (isActive) {
                    this.classList.remove('active'); lineSTH.applyOptions({ visible: false });
                } else {
                    this.classList.add('active'); lineSTH.applyOptions({ visible: true });
                }
            });

            // PRZEŁĄCZNIK: LINIA / ŚWIECE
            let isCandleMode = false;
            document.getElementById('toggle-candle').addEventListener('click', function() {
                isCandleMode = !isCandleMode;
                // Zamieniamy tekst przycisku
                this.innerText = isCandleMode ? 'Wykres: Linia' : 'Wykres: Świece';
                
                // Jeśli wykres BTC jest w ogóle włączony, przełączamy warstwy
                if (btnBtc.classList.contains('active')) {
                    if (isCandleMode) {
                        this.classList.add('active');
                        lineBTC.applyOptions({ visible: false });
                        candleBTC.applyOptions({ visible: true });
                    } else {
                        this.classList.remove('active');
                        candleBTC.applyOptions({ visible: false });
                        lineBTC.applyOptions({ visible: true });
                    }
                }
            });

            let isZonesOn = false;
            document.getElementById('toggle-zones').addEventListener('click', function() {
                isZonesOn = !isZonesOn;
                if(isZonesOn) {
                    this.classList.add('active'); zoneSeries.applyOptions({ visible: true });
                } else {
                    this.classList.remove('active'); zoneSeries.applyOptions({ visible: false });
                }
            });

            let isLogScale = false; 
            document.getElementById('toggle-log').addEventListener('click', function() {
                isLogScale = !isLogScale;
                if(isLogScale) {
                    this.classList.add('active'); chart.applyOptions({ rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Logarithmic } });
                } else {
                    this.classList.remove('active'); chart.applyOptions({ rightPriceScale: { mode: LightweightCharts.PriceScaleMode.Normal } });
                }
            });

        }, 50);
    } catch (err) {
        console.error("Krytyczny błąd inicjalizacji wykresu:", err);
    }
}

window.addEventListener('DOMContentLoaded', init);
