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
        
        // Wchodzimy na stronę i czekamy, aż wykres się załaduje i rozpakuje dane
        await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
        
        console.log(`[LOG] Strona załadowana. Wyciąganie rozpakowanych danych prosto z pamięci RAM Plotly...`);

        const result = await page.evaluate(() => {
            const plotDiv = document.querySelector('.js-plotly-plot');
            if (!plotDiv || !plotDiv.data) return { error: "Nie odnaleziono instancji wyrenderowanego wykresu na stronie." };

            const traces = plotDiv.data;
            let latestDate = null;
            let latestValue = null;
            let maxTimestamp = -1;

            traces.forEach(trace => {
                if (trace.name && trace.name.includes('STH-SOPR')) {
                    const xArr = trace.x;
                    const yArr = trace.y;
                    
                    if (xArr && yArr && xArr.length === yArr.length) {
                        for (let i = yArr.length - 1; i >= 0; i--) {
                            if (yArr[i] !== null && yArr[i] !== undefined && !isNaN(yArr[i])) {
                                let dateStr = xArr[i];
                                let time = new Date(dateStr).getTime();
                                
                                if (time > maxTimestamp) {
                                    maxTimestamp = time;
                                    latestDate = dateStr.split('T')[0];
                                    latestValue = yArr[i];
                                }
                                break;
                            }
                        }
                    }
                }
            });

            if (latestDate) {
                return { date: latestDate, value: latestValue };
            }
            return { error: "Algorytm nie odnalazł odpowiedniej linii danych STH-SOPR." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] Dane wyekstrahowane bezbłędnie z przeglądarki!`);
        console.log(`[SUCCESS] Najnowszy punkt: Dzień = ${result.date} | Wartość STH-SOPR = ${result.value}`);

        let localDatabase = [];
        if (fs.existsSync(DATA_PATH)) {
            try {
                localDatabase = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
            } catch (e) {
                localDatabase = [];
            }
        }

        const existingIndex = localDatabase.findIndex(item => item.date === result.date);

        if (existingIndex !== -1) {
            if (localDatabase[existingIndex].value !== result.value) {
                localDatabase[existingIndex].value = result.value;
                localDatabase[existingIndex].updatedAt = new Date().toISOString();
                console.log(`[LOG] Zaktualizowano wartość dla dnia ${result.date}.`);
            } else {
                console.log(`[LOG] Dane dla dnia ${result.date} są aktualne. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: result.date,
                value: result.value,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Dodano nowy rekord historyczny dla daty: ${result.date}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
        console.log(`[SUCCESS] Baza danych JSON została pomyślnie zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
