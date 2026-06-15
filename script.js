// --- USTAWIENIA PALETY KOLORÓW ---
const COLORS = {
    btc: '#ffffff',
    sopr: '#9ff321' // Identyczny neonowy zielony z Twojego pierwotnego szablonu
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
            allCandles.push({
                time: parseInt(candles[i].timestamp),
                value: parseFloat(candles[i].close)
            });
        }

        currentStartUnix = parseInt(candles[candles.length - 1].timestamp) + 86400;
        
        if (candles.length < 1000) {
            isFetching = false;
        }
    }
    return allCandles;
}

// --- POBIERANIE WSKAŹNIKA STH-SOPR Z TWOJEGO PLIKU JSON ---
async function fetchSoprData() {
    const response = await fetch('./data/sth-sopr.json');
    if (!response.ok) throw new Error("Nie znaleziono pliku bazy danych STH-SOPR.");
    const json = await response.json();
    
    // Konwersja formatu daty "YYYY-MM-DD" na Unix Timestamp (sekundy) dla dopasowania osi czasu
    return json.map(item => ({
        time: Math.floor(Date.parse(item.date) / 1000),
        value: item.value
    })).sort((a, b) => a.time - b.time);
}

async function init() {
    try {
        // Równoległe pobieranie danych
        const [seriesBTC, seriesSOPR] = await Promise.all([
            fetchBitstampData(),
            fetchSoprData()
        ]);

        if (seriesBTC.length === 0 || seriesSOPR.length === 0) throw new Error("Błąd ładowania serii danych.");

        // Formatowanie i podstawianie nagłówków statystyk
        const formatUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        const latestBTC = seriesBTC[seriesBTC.length - 1].value;
        const latestSOPR = seriesSOPR[seriesSOPR.length - 1].value;

        document.getElementById('val-btc').innerText = formatUSD.format(latestBTC);
        document.getElementById('val-sopr').innerText = latestSOPR.toFixed(4);
        
        // Dynamiczny stan rynku na podstawie poziomu 1.0 wskaźnika SOPR
        const statusElement = document.getElementById('val-status');
        if (latestSOPR > 1.0) {
            statusElement.innerText = "ZYSK (Bullish)";
            statusElement.style.color = "#2aef18";
        } else {
            statusElement.innerText = "STRATA (Bearish)";
            statusElement.style.color = "#ff3b30";
        }

        // Przełączenie widoków ładowania
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
                leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.2 } },
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

            // --- SERIA 1: CENA BTC (Prawa oś) ---
            const lineBTC = chart.addLineSeries({ priceScaleId: 'right', color: COLORS.btc, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineBTC.setData(seriesBTC);

            // --- SERIA 2: WSKAŹNIK STH-SOPR (Lewa oś) ---
            const lineSOPR = chart.addLineSeries({ priceScaleId: 'left', color: COLORS.sopr, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            lineSOPR.setData(seriesSOPR);

            // Dodanie linii horyzontalnej punktu neutralnego 1.0 dla SOPR
            lineSOPR.createPriceLine({
                price: 1.0,
                color: 'rgba(255, 255, 255, 0.3)',
                lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                axisLabelVisible: true,
                title: 'BAZA 1.0',
            });

            chart.timeScale().fitContent();

            // --- OBSŁUGA INTERAKTYWNEGO TOOLTIPA ---
            const toolTip = document.getElementById('tv-tooltip');
            const mapBTC = new Map(seriesBTC.map(p => [p.time, p.value]));
            const mapSOPR = new Map(seriesSOPR.map(p => [p.time, p.value]));

            chart.subscribeCrosshairMove(param => {
                if (param.point === undefined || !param.time || param.point.x < 0 || param.point.x > chartContainer.clientWidth || param.point.y < 0 || param.point.y > chartContainer.clientHeight) {
                    toolTip.style.display = 'none'; return;
                }

                const timeSec = param.time;
                const d = new Date(timeSec * 1000);
                const dateStr = `${d.getUTCDate()}.${(d.getUTCMonth()+1).toString().padStart(2, '0')}.${d.getUTCFullYear()}`;
                let html = `<div class="tooltip-date">${dateStr}</div>`;
                let showTooltip = false;

                if (lineBTC.options().visible && mapBTC.has(timeSec)) {
                    html += `<div class="tooltip-row"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.btc};"></span><span class="tooltip-label">Cena BTC</span></span> <span class="tooltip-value">${formatUSD.format(mapBTC.get(timeSec))}</span></div>`;
                    showTooltip = true;
                }
                if (lineSOPR.options().visible && mapSOPR.has(timeSec)) {
                    html += `<div class="tooltip-row" style="margin-top: 6px;"><span style="display:flex; align-items:center;"><span class="tooltip-color-dot" style="background: ${COLORS.sopr};"></span><span class="tooltip-label">STH-SOPR</span></span> <span class="tooltip-value">${mapSOPR.get(timeSec).toFixed(4)}</span></div>`;
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
            const controls = { 'btc': [lineBTC], 'sopr': [lineSOPR] };

            document.querySelectorAll('.toggle-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const key = this.getAttribute('data-series');
                    const isActive = this.classList.contains('active');
                    if (isActive) {
                        this.classList.remove('active'); controls[key].forEach(l => l.applyOptions({ visible: false }));
                    } else {
                        this.classList.add('active'); controls[key].forEach(l => l.applyOptions({ visible: true }));
                    }
                });
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