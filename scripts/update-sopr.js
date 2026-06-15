const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const URL = 'https://charts.checkonchain.com/btconchain/realised/sthsopr_indicator/sthsopr_indicator_light.html';
// Zmiana nazwy pliku wyjściowego na sth-realised-price.json
const DATA_PATH = path.join(__dirname, '../data/sth-realised-price.json');

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
        console.log(`[LOG] Strona załadowana. Wyciąganie linii "STH Realised Price"...`);

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
            let historyArray = [];

            traces.forEach(trace => {
                let name = (trace.name || "").toUpperCase();
                
                // Szukamy konkretnie linii STH Realised Price (czerwonej)
                if (name.includes('STH REALISED PRICE')) {
                    let xArr = trace.x;
                    let yArr = trace.y;
                    
                    if (xArr && yArr) {
                        for (let i = 0; i < yArr.length; i++) {
                            let y = yArr[i];
                            // Pobieramy wszystkie niepuste punkty na osi czasu
                            if (y !== null && y !== undefined && !isNaN(y)) {
                                let dateStr = String(xArr[i]).split('T')[0].split(' ')[0]; 
                                historyArray.push({
                                    date: dateStr,
                                    value: parseFloat(y)
                                });
                            }
                        }
                    }
                }
            });

            if (historyArray.length > 0) {
                // Sortujemy chronologicznie od najstarszej do najnowszej daty
                historyArray.sort((a, b) => new Date(a.date) - new Date(b.date));
                return { history: historyArray };
            }

            return { error: "Nie odnaleziono danych dla STH Realised Price." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] Znaleziono linię STH Realised Price! Liczba punktów: ${result.history.length}`);
        
        const latest = result.history[result.history.length - 1];
        // Wyświetlanie wartości jako ceny w dolarach
        console.log(`[SUCCESS] Najnowsza wycena (STH Realised Price): Dzień = ${latest.date} | Wartość = $${latest.value.toFixed(2)}`);

        const now = new Date().toISOString();
        const finalDatabase = result.history.map(item => ({
            date: item.date,
            value: item.value,
            updatedAt: now
        }));

        // Upewniamy się, że folder data istnieje zanim zapiszemy nowy plik
        const dir = path.dirname(DATA_PATH);
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }

        // Zapis do nowego pliku JSON
        fs.writeFileSync(DATA_PATH, JSON.stringify(finalDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON zapisana bezbłędnie.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
