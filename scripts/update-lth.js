const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'https://charts.checkonchain.com/btconchain/realised/lthsopr_indicator/lthsopr_indicator_light.html';
const PRICE_PATH = path.join(__dirname, '../data/lth-realised-price.json');
const SOPR_PATH = path.join(__dirname, '../data/lth-sopr.json');

async function main() {
    console.log(`[LOG] Uruchamianie Chrome dla LTH...`);
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'] });

    try {
        const page = await browser.newPage();
        await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
        console.log(`[LOG] Wyciąganie kompletnych danych LTH (Cena + SOPR)...`);

        const result = await page.evaluate(() => {
            let plotDiv = document.querySelector('.js-plotly-plot');
            if (!plotDiv || !plotDiv._fullData) {
                const allDivs = document.querySelectorAll('div');
                for (let div of allDivs) { if (div._fullData) { plotDiv = div; break; } }
            }
            if (!plotDiv || !plotDiv._fullData) return { error: "Brak danych _fullData." };

            const traces = plotDiv._fullData;
            let priceHistory = [];
            let soprMap = {};

            traces.forEach(trace => {
                let name = (trace.name || "").toUpperCase();
                let xArr = trace.x;
                let yArr = trace.y;

                if (xArr && yArr) {
                    if (name.includes('LTH REALISED PRICE')) {
                        for (let i = 0; i < yArr.length; i++) {
                            if (yArr[i] !== null && !isNaN(yArr[i])) {
                                priceHistory.push({ date: String(xArr[i]).split('T')[0], value: parseFloat(yArr[i]) });
                            }
                        }
                    }
                    if (name.includes('SOPR')) {
                        for (let i = 0; i < yArr.length; i++) {
                            if (yArr[i] !== null && !isNaN(yArr[i])) {
                                let dateStr = String(xArr[i]).split('T')[0];
                                let val = parseFloat(yArr[i]);
                                
                                // NAPRAWA: Zapobiegamy nadpisywaniu struktury przez bazy 1.0 dla LTH
                                if (soprMap[dateStr] === undefined || val !== 1.0) {
                                    soprMap[dateStr] = val;
                                }
                            }
                        }
                    }
                }
            });

            let soprHistory = Object.keys(soprMap).map(d => ({ date: d, value: soprMap[d] }));
            priceHistory.sort((a,b) => new Date(a.date) - new Date(b.date));
            soprHistory.sort((a,b) => new Date(a.date) - new Date(b.date));

            return { priceHistory, soprHistory };
        });

        if (result.error) throw new Error(result.error);

        fs.mkdirSync(path.dirname(PRICE_PATH), { recursive: true });
        fs.writeFileSync(PRICE_PATH, JSON.stringify(result.priceHistory, null, 2), 'utf-8');
        fs.writeFileSync(SOPR_PATH, JSON.stringify(result.soprHistory, null, 2), 'utf-8');
        console.log(`[SUCCESS] Zapisano pliki dla LTH (Cena: ${result.priceHistory.length} pkt, SOPR: ${result.soprHistory.length} pkt)`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}
main();
