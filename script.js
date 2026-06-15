// --- JEDNOLITA PALETA KOLORÓW TOŻSAMOŚCIOWYCH ---
const COLORS = {
    btc: '#ffffff',
    sth: '#ff5722',         // Stały pomarańczowy dla grupy STH
    lth: '#00d2ff',         // Stały błękitny dla grupy LTH
    text_profit: '#2aef18', // Neonowa zieleń do akcentowania zysku w napisach
    text_loss: '#ff3b30'    // Czerwień do akcentowania straty w napisach
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

        const btcMap = new Map(seriesBTC.map(c => [c.time, c.close]));

        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const latestBTC = seriesBTC[seriesBTC.length - 1].close;
        const latestSTH = sthPriceRaw[sthPriceRaw.length - 1].value;
        const latestLTH = lthPriceRaw[lthPriceRaw.length - 1].value;

        // Pobieramy najświeższe wartości oscylatorów SOPR do wyliczenia tła panelu
        const latestSTH_sopr = sthSopr[sthSopr.length - 1].value;
        const latestLTH_sopr = lthSopr[lthSopr.length - 1].value;

        document.getElementById('val-btc').innerText = formatUSD.format(latestBTC);
        document.getElementById('val-sth').innerText = formatUSD.format(latestSTH);
        document.getElementById('val-sth').style.color = latestSTH < latestBTC ? COLORS.text_profit : COLORS.text_loss;
        document.getElementById('val-lth').innerText = formatUSD.format(latestLTH);
        document.getElementById('val-lth').style.color = latestLTH < latestBTC ? COLORS.text_profit : COLORS.text_loss;

        const controlsBar = document.getElementById('controls-bar');
        document.getElementById('loading').style.display = 'none';
        controlsBar.style.display = 'flex';
        document.getElementById('chart-wrapper').style.display = 'flex';

        // NAPRAWIONA FUNKCJA: Prawidłowe wywołanie classList.add()
        function updatePanelBackground(soprValue) {
            controlsBar.classList.remove('panel-profit', 'panel-loss');
            if (soprValue >= 1.0) {
                controlsBar.classList.add('panel-profit');
            } else {
                controlsBar.classList.add('panel-loss');
            }
        }

        // Domyślnie na starcie włączony jest LTH SOPR, więc ustawiamy jego stan tła
        updatePanelBackground(latestLTH_sopr);

        // --- WYKRES 1: WYKRES GŁÓWNY (CENA) ---
        const containerMain = document.getElementById('chart-main');
        const chartMain = LightweightCharts.createChart(containerMain, {
            autoSize: true,
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter, sans-serif' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
            rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
            leftPriceScale: { visible: false }, timeScale: { borderVisible: false, visible: false },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });

        const lineBTC = chartMain.addLineSeries({ priceScaleId: 'right', color: COLORS.btc, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        lineBTC.setData(seriesBTC.map(c => ({ time: c.time, value: c.close })));
        const candleBTC = chartMain.addCandlestickSeries({ priceScaleId: 'right', upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350', visible: false });
        candleBTC.setData(seriesBTC);

        const lineSTH_P = chartMain.addLineSeries({ priceScaleId: 'right', color: COLORS.sth, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        lineSTH_P.setData(sthPriceRaw);
        const lineLTH_P = chartMain.addLineSeries({ priceScaleId: 'right', color: COLORS.lth, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        lineLTH_P.setData(lthPriceRaw);

        const zoneSeries = chartMain.addHistogramSeries({ priceScaleId: 'zones', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        chartMain.priceScale('zones').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        zoneSeries.setData(seriesBTC.map(pt => ({ time: pt.time, value: 1, color: getZoneColor(pt.time) })));
        zoneSeries.applyOptions({ visible: false });

        // --- WYKRES 2: OSCYLATOR SOPR ---
        const containerSopr = document.getElementById('chart-sopr');
        const chartSopr = LightweightCharts.createChart(containerSopr, {
            autoSize: true,
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8e8e93', fontFamily: 'Inter, sans-serif' },
            grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
            rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
            leftPriceScale: { visible: false }, timeScale: { borderVisible: false, timeVisible: true },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
        });

        const lineSTH_S = chartSopr.addLineSeries({ priceScaleId: 'right', color: COLORS.sth, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false });
        lineSTH_S.setData(sthSopr);
        const lineLTH_S = chartSopr.addLineSeries({ priceScaleId: 'right', color: COLORS.lth, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: true });
        lineLTH_S.setData(lthSopr);

        const priceLineConfig = { price: 1.0, color: 'rgba(255, 255, 255, 0.25)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: true, title: '' };
        lineSTH_S.createPriceLine(priceLineConfig);
        lineLTH_S.createPriceLine(priceLineConfig);

        // --- SYNCHRONIZACJA OSI OSI CZASU ---
        let isSyncing = false;
        chartMain.timeScale().subscribeVisibleTimeRangeChange(range => {
            if (isSyncing || !range) return; isSyncing = true;
            chartSopr.timeScale().setVisibleRange(range); isSyncing = false;
        });
        chartSopr.timeScale().subscribeVisibleTimeRangeChange(range => {
            if (isSyncing || !range) return; isSyncing = true;
            chartMain.timeScale().setVisibleRange(range); isSyncing = false;
        });

        chartMain.timeScale().fitContent();

        // --- INTERAKTYWNY TOOLTIP SONDY ---
        const toolTip = document.getElementById('tv-tooltip');
        const mapSTH_P = new Map(sthPriceRaw.map(p => [p.time, p.value]));
        const mapLTH_P = new Map(lthPriceRaw.map(p => [p.time, p.value]));
        const mapSTH_S = new Map(sthSopr.map(p => [p.time, p.value]));
        const mapLTH_S = new Map(lthSopr.map(p => [p.time, p.value]));

        const handleCrosshairMove = (param) => {
            if (!param.point || !param.time || param.point.x < 0 || param.point.y < 0) { toolTip.style.display = 'none'; return; }
            const t = param.time; const d = new Date(t * 1000);
            let html = `<div class="tooltip-date">${d.getUTCDate()}.${(d.getUTCMonth()+1).toString().padStart(2,'0')}.${d.getUTCFullYear()}</div>`;
            let show = false;

            if (btcMap.has(t) && (lineBTC.options().visible || candleBTC.options().visible)) {
                html += `<div class="tooltip-row"><span><span class="tooltip-color-dot" style="background:${COLORS.btc};"></span>Cena BTC</span><span class="tooltip-value">${formatUSD.format(btcMap.get(t))}</span></div>`;
                show = true;
            }
            if (lineSTH_P.options().visible && mapSTH_P.has(t) && btcMap.has(t)) {
                const val = mapSTH_P.get(t); const isProfit = val < btcMap.get(t);
                const stateText = isProfit ? `<span style="color:${COLORS.text_profit}; font-size:11px;">(Zysk)</span>` : `<span style="color:${COLORS.text_loss}; font-size:11px;">(Strata)</span>`;
                html += `<div class="tooltip-row"><span><span class="tooltip-color-dot" style="background:${COLORS.sth};"></span>STH Price ${stateText}</span><span class="tooltip-value">${formatUSD.format(val)}</span></div>`;
                show = true;
            }
            if (lineLTH_P.options().visible && mapLTH_P.has(t) && btcMap.has(t)) {
                const val = mapLTH_P.get(t); const isProfit = val < btcMap.get(t);
                const stateText = isProfit ? `<span style="color:${COLORS.text_profit}; font-size:11px;">(Zysk)</span>` : `<span style="color:${COLORS.text_loss}; font-size:11px;">(Strata)</span>`;
                html += `<div class="tooltip-row"><span><span class="tooltip-color-dot" style="background:${COLORS.lth};"></span>LTH Price ${stateText}</span><span class="tooltip-value">${formatUSD.format(val)}</span></div>`;
                show = true;
            }
            if (lineSTH_S.options().visible && mapSTH_S.has(t)) {
                const val = mapSTH_S.get(t);
                const stateText = val > 1.0 ? `<span style="color:${COLORS.text_profit}; font-size:11px;">(Zysk)</span>` : `<span style="color:${COLORS.text_loss}; font-size:11px;">(Strata)</span>`;
                html += `<div class="tooltip-row" style="margin-top:4px; border-top:1px solid rgba(255,255,255,0.05); padding-top:4px;"><span><span class="tooltip-color-dot" style="background:${COLORS.sth};"></span>STH SOPR ${stateText}</span><span class="tooltip-value">${val.toFixed(4)}</span></div>`;
                show = true;
            }
            if (lineLTH_S.options().visible && mapLTH_S.has(t)) {
                const val = mapLTH_S.get(t);
                const stateText = val > 1.0 ? `<span style="color:${COLORS.text_profit}; font-size:11px;">(Zysk)</span>` : `<span style="color:${COLORS.text_loss}; font-size:11px;">(Strata)</span>`;
                html += `<div class="tooltip-row" style="margin-top:4px; border-top:1px solid rgba(255,255,255,0.05); padding-top:4px;"><span><span class="tooltip-color-dot" style="background:${COLORS.lth};"></span>LTH SOPR ${stateText}</span><span class="tooltip-value">${val.toFixed(4)}</span></div>`;
                show = true;
            }

            if (!show) { toolTip.style.display = 'none'; return; }
            toolTip.innerHTML = html; toolTip.style.display = 'block';
            
            let x = param.point.x + 20; if (x + toolTip.offsetWidth > containerMain.clientWidth - 20) x = param.point.x - toolTip.offsetWidth - 20;
            toolTip.style.left = x + 'px'; toolTip.style.top = (containerMain.getBoundingClientRect().top + window.scrollY + 50) + 'px';
        };

        chartMain.subscribeCrosshairMove(handleCrosshairMove);
        chartSopr.subscribeCrosshairMove(handleCrosshairMove);

        // --- KONTROLA PANELU GÓRNEGO (CENY) ---
        const btnBtc = document.querySelector('[data-series="btc"]');
        btnBtc.addEventListener('click', function() {
            const act = this.classList.toggle('active');
            if (isCandleMode) candleBTC.applyOptions({ visible: act }); else lineBTC.applyOptions({ visible: act });
        });

        document.querySelector('[data-series="sth"]').addEventListener('click', function() { lineSTH_P.applyOptions({ visible: this.classList.toggle('active') }); });
        document.querySelector('[data-series="lth"]').addEventListener('click', function() { lineLTH_P.applyOptions({ visible: this.classList.toggle('active') }); });
        
        // --- KONTROLA PANELU DOLNEGO (RADIO BUTTONS) ---
        document.getElementById('btn-sth-sopr').addEventListener('click', function() {
            this.classList.add('active');
            document.getElementById('btn-lth-sopr').classList.remove('active');
            lineSTH_S.applyOptions({ visible: true });
            lineLTH_S.applyOptions({ visible: false });
            updatePanelBackground(latestSTH_sopr);
        });

        document.getElementById('btn-lth-sopr').addEventListener('click', function() {
            this.classList.add('active');
            document.getElementById('btn-sth-sopr').classList.remove('active');
            lineLTH_S.applyOptions({ visible: true });
            lineSTH_S.applyOptions({ visible: false });
            updatePanelBackground(latestLTH_sopr);
        });

        // --- PRZYCISKI POMOCNICZE (ZAMKNIĘCIE KODU) ---
        let isCandleMode = false;
        document.getElementById('toggle-candle').addEventListener('click', function() {
            isCandleMode = !isCandleMode; this.innerText = isCandleMode ? 'Wykres: Linia' : 'Wykres: Świece';
            if (btnBtc.classList.contains('active')) { lineBTC.applyOptions({ visible: !isCandleMode }); candleBTC.applyOptions({ visible: isCandleMode }); }
        });

        document.getElementById('toggle-zones').addEventListener('click', function() { zoneSeries.applyOptions({ visible: this.classList.toggle('active') }); });
        document.getElementById('toggle-log').addEventListener('click', function() {
            const log = this.classList.toggle('active');
            chartMain.applyOptions({ rightPriceScale: { mode: log ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal } });
        });

    } catch (err) { console.error("Krytyczny błąd UI:", err); }
}
window.addEventListener('DOMContentLoaded', init);
