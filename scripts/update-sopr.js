const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
const DATA_PATH = path.join(__dirname, '../data/sth-sopr.json');

async function main() {
    console.log(`[LOG] Uruchamianie wirtualnej przeglądarki Chrome...`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        console.log(`[LOG] Nawiązywanie połączenia z: ${URL}`);
        
        await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
        console.log(`[LOG] Strona załadowana. Wyciąganie pełnej historii wskaźnika...`);

        const result = await page.evaluate(() => {
            let plotDiv = document.querySelector('.js-plotly-plot');
            
            if (!plotDiv || !plotDiv._fullData) {
                const allDivs = document.querySelectorAll('div');
                for (let div of allDivs) {
                    if (div._fullData && Array.isArray(div._fullData)) {
                        plotDiv = div;
                        break;
                    }
                }
            }

            if (!plotDiv || !plotDiv._fullData) return { error: "Brak wyrenderowanych danych (_fullData)." };

            const traces = plotDiv._fullData;
            let historyMap = {};

            traces.forEach(trace => {
                let name = (trace.name || "").toUpperCase();
                
                // Szukamy wszystkich linii SOPR
                if (name.includes('SOPR')) {
                    let xArr = trace.x;
                    let yArr = trace.y;
                    
                    if (xArr && yArr) {
                        // Pobieramy absolutnie każdy punkt historyczny (bez zatrzymywania pętli)
                        for (let i = 0; i < yArr.length; i++) {
                            let y = yArr[i];
                            if (y !== null && y !== undefined && !isNaN(y)) {
                                let dateStr = String(xArr[i]).split('T')[0].split(' ')[0]; 
                                historyMap[dateStr] = parseFloat(y);
                            }
                        }
                    }
                }
            });

            let historyArray = Object.keys(historyMap).map(date => {
                return { date: date, value: historyMap[date] };
            });

            if (historyArray.length > 0) {
                // Sortujemy chronologicznie (od najstarszej do najnowszej)
                historyArray.sort((a, b) => new Date(a.date) - new Date(b.date));
                return { history: historyArray };
            }

            return { error: "Nie odnaleziono liczb historycznych." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] Pobrano pełną historię! Liczba pobranych dni: ${result.history.length}`);
        
        const latest = result.history[result.history.length - 1];
        console.log(`[SUCCESS] Najnowszy punkt z giełdy: Dzień = ${latest.date} | Wartość = ${latest.value}`);

        // Tworzymy finalną bazę danych ze wszystkimi pobranymi punktami
        const now = new Date().toISOString();
        const finalDatabase = result.history.map(item => ({
            date: item.date,
            value: item.value,
            updatedAt: now
        }));

        // Zapis i nadpisanie pliku JSON kompletną historią
        fs.writeFileSync(DATA_PATH, JSON.stringify(finalDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON wypełniona kompletną historią.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
