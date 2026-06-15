// --- USTAWIENIA PALETY KOLORÓW ---
const COLORS = {
    btc: '#ffffff',
    sth_profit: '#2aef18', // Neonowy zielony zysk dla STH
    sth_loss: '#ff3b30',   // Czerwona strata dla STH
    lth_profit: '#00d2ff', // Jasnoniebieski zysk dla LTH
    lth_loss: '#0042a5'    // Ciemnoniebieski/granatowa strata dla LTH
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
    let currentStartUnix = 1313625600; 
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

// --- POBIERANIE WSKAŹNIKA STH Z PLIKU JSON ---
async function fetchSthData() {
    const response = await fetch('./data/sth-realised-price.json');
    if (!response.ok) throw new Error("Nie znaleziono pliku sth-realised-price.json.");
    const json = await response.json();
    return json.map(item => ({ time: Math.floor(Date.parse(item.date) / 1000), value: item.value })).sort((a, b) => a.time - b.time);
}

// --- POBIERANIE WSKAŹNIKA LTH Z PLIKU JSON ---
async function fetchLthData() {
    const response = await fetch('./data/lth-realised-price.json');
    if (!response.ok) throw new Error("Nie znaleziono pliku lth-realised-price.json.");
    const json = await response.json();
    return json.map(item => ({ time: Math.floor(Date.parse(item.date) / 1000), value: item.value })).sort((a, b) => a.time - b.time);
}

// --- OBSŁUGA OKIENEK POPUP ---
function setupModals() {
    const sthModal = document.getElementById('sth-modal');
    const lthModal = document.getElementById('lth-modal');

    document.getElementById('card-sth').addEventListener('click', () => { sthModal.style.display = 'flex'; });
    document.getElementById('card-lth').addEventListener('click', () => { lthModal.style.display = 'flex'; });

    document.getElementById('close-sth-modal').addEventListener('click', () => { sthModal.style.display = 'none'; });
    document.getElementById('close-lth-modal').addEventListener('click', () => { lthModal.style.display = 'none'; });

    window.addEventListener('click', (e) => {
        if (e.target === sthModal) sthModal.style.display = 'none';
        if (e.target === lthModal) lthModal.style.display = 'none';
    });
}

async function init() {
    setupModals();

    try {
        // Pobieramy 3 serie danych równolegle
        const [seriesBTC, seriesSTH_raw, seriesLTH_raw] = await Promise.all([
            fetchBitstampData(),
            fetchSthData(),
            fetchLthData()
        ]);

        if (seriesBTC.length === 0 || seriesSTH_raw.length === 0 || seriesLTH_raw.length === 0) throw new Error("Błąd ładowania serii danych.");

        const btcMap = new Map(seriesBTC.map(c => [c.time, c.close]));

        // Dynamiczne kolorowanie serii STH (Zieleń / Czerwień)
        const seriesSTH = seriesSTH_raw.map(pt => {
            let col = '#ff5722';
            if (btcMap.has(pt.time)) {
                col = pt.value < btcMap.get(pt.time) ? COLORS.sth_profit : COLORS.sth_loss;
            }
            return { time: pt.time, value: pt.value, color: col };
        });

        // Dynamiczne kolorowanie serii LTH (Jasnoniebieski / Ciemnoniebieski)
        const seriesLTH = seriesLTH_raw.map(pt => {
            let col = '#00d2ff';
            if (btcMap.has(pt.time)) {
                col = pt.value < btcMap.get(pt.time) ? COLORS.lth_profit : COLORS.lth_loss;
            }
            return { time: pt.time, value: pt.value, color: col };
        });

        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const latestBTC = seriesBTC[seriesBTC.length - 1].close;
        const latestSTH = seriesSTH[seriesSTH.length - 1].value;
        const latestLTH = seriesLTH[seriesLTH.length - 1].value;

        // Przypisanie wartości i kolorów do górnych kafelków
        document.getElementById('val-btc').innerText = formatUSD.format(latestBTC);
        
        document.getElementById('val-sth').innerText = formatUSD.format(latestSTH);
        document.getElementById('val-sth').style.color = latestSTH < latestBTC ? COLORS.sth_profit : COLORS.sth_loss;

        document.getElementById('val-lth').innerText = formatUSD.format(latestLTH);
        document.getElementById('val-lth').style.color = latestLTH < latestBTC ? COLORS.lth_profit : COLORS.lth_loss;

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
            const zoneSeries = chart.addHistogramSeries({ priceScaleId: 'zones', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            chart.priceScale('zones').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });

            let zoneData = seriesBTC.map(pt => ({ time: pt.time, value: 1, color: getZoneColor(pt.time) }));
            let lastTime = seriesBTC[seriesBTC.length - 1].time;
            const targetFutureDate = Date.UTC(2028, 0, 1) / 1000;
            for (let t = lastTime + 86400; t <= targetFutureDate; t += 86400) { zoneData.push({ time: t, value: 1, color: getZoneColor(t) }); }
            zoneSeries.setData(zoneData);
            zoneSeries.applyOptions({ visible: false }); 

            // --- SERIE: BITCOIN (LINIA I ŚWIECE) ---
            const lineBTC = chart.addLineSeries({ priceScaleId: 'right', color: COLORS.btc, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineBTC.setData(seriesBTC.map(c => ({ time: c.time, value: c.close })));

            const candleBTC = chart.addCandlestickSeries({ priceScaleId: 'right', upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', visible: false });
            candleBTC.setData(seriesBTC);

            // --- SERIA: STH REALISED PRICE ---
            const lineSTH = chart.addLineSeries({ priceScaleId: 'right', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineSTH.setData(seriesSTH);

            // --- SERIA: LTH REALISED PRICE ---
            const lineLTH = chart.addLineSeries({ priceScaleId: 'right', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineLTH.setData(seriesLTH);

            chart.timeScale().fitContent();

            // --- TOOLTIP INTERAKTYWNY ---
            const toolTip = document.getElementById('tv-tooltip');
            const mapSTH = new Map(seriesSTH.map(p => [p.time, p]));
            const mapLTH = new Map(seriesLTH.map(p => [p.time, p]));

            chart.subscribeCrosshairMove(param => {
                if (param.point === undefined || !param.time || param.point.x < 0 || param.point.x > chartContainer.clientWidth || param.point.y < 0 || param.point.y > chartContainer.clientHeight) {
                    toolTip.style.display = 'none'; return;
                }

                const timeSec = param.time;
                const d = new Date(timeSec * 1000);
                const dateStr = `${d.getUTCDate()}.${(d.getUTCMonth()+1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
                let html = `<div class="tooltip-date">${dateStr}</div>`;
                let showTooltip = false;

                if ((lineBTC.options().visible || candleBTC.options().visible) && btcMap.has(timeSec)) {
                    html += `<div class="tooltip-row"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.btc};"></span><span class="tooltip-label">Cena BTC</span></span> <span class="tooltip-value">${formatUSD.format(btcMap.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }
                if (lineSTH.options().visible && mapSTH.has(timeSec)) {
                    const sData = mapSTH.get(timeSec);
                    html += `<div class="tooltip-row" style="margin-top: 5px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${sData.color};"></span><span class="tooltip-label">STH Realised</span></span> <span class="tooltip-value">${formatUSD.format(sData.value)}</span></div>`;
                    showTooltip = true;
                }
                if (lineLTH.options().visible && mapLTH.has(timeSec)) {
                    const lData = mapLTH.get(timeSec);
                    html += `<div class="tooltip-row" style="margin-top: 5px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${lData.color};"></span><span class="tooltip-label">LTH Realised</span></span> <span class="tooltip-value">${formatUSD.format(lData.value)}</span></div>`;
                    showTooltip = true;
                }

                if (!showTooltip && !zoneSeries.options().visible) { toolTip.style.display = 'none'; return; }

                toolTip.innerHTML = html; toolTip.style.display = 'block';
                let xPos = param.point.x + 20; if (xPos + toolTip.offsetWidth > chartContainer.clientWidth - 20) xPos = param.point.x - toolTip.offsetWidth - 20;
                toolTip.style.left = xPos + 'px'; toolTip.style.top = param.point.y + 'px';
            });

            // --- PANEL KONTROLNY PANELU DOLNEGO ---
            const btnBtc = document.querySelector('[data-series="btc"]');
            btnBtc.addEventListener('click', function() {
                const act = this.classList.toggle('active');
                if (isCandleMode) candleBTC.applyOptions({ visible: act }); else lineBTC.applyOptions({ visible: act });
            });

            document.querySelector('[data-series="sth"]').addEventListener('click', function() {
                lineSTH.applyOptions({ visible: this.classList.toggle('active') });
            });

            document.querySelector('[data-series="lth"]').addEventListener('click', function() {
                lineLTH.applyOptions({ visible: this.classList.toggle('active') });
            });

            let isCandleMode = false;
            document.getElementById('toggle-candle').addEventListener('click', function() {
                isCandleMode = !isCandleMode; this.innerText = isCandleMode ? 'Wykres: Linia' : 'Wykres: Świece';
                if (btnBtc.classList.contains('active')) {
                    lineBTC.applyOptions({ visible: !isCandleMode }); candleBTC.applyOptions({ visible: isCandleMode });
                }
            });

            document.getElementById('toggle-zones').addEventListener('click', function() {
                zoneSeries.applyOptions({ visible: this.classList.toggle('active') });
            });

            document.getElementById('toggle-log').addEventListener('click', function() {
                const log = this.classList.toggle('active');
                chart.applyOptions({ rightPriceScale: { mode: log ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal } });
            });

        }, 50);
    } catch (err) { console.error("Błąd wykresu:", err); }
}

window.addEventListener('DOMContentLoaded', init);
