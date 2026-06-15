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
        console.log(`[LOG] Strona załadowana. Wyciąganie czystych buforów z _fullData...`);

        const result = await page.evaluate(() => {
            let plotDiv = document.querySelector('.js-plotly-plot');
            
            // Szukamy wyrenderowanego obiektu z właściwością _fullData (rozpakowane tablice)
            if (!plotDiv || !plotDiv._fullData) {
                const allDivs = document.querySelectorAll('div');
                for (let div of allDivs) {
                    if (div._fullData && Array.isArray(div._fullData)) {
                        plotDiv = div;
                        break;
                    }
                }
            }

            if (!plotDiv || !plotDiv._fullData) return { error: "Brak wyrenderowanych danych (_fullData) w pamięci Plotly." };

            const traces = plotDiv._fullData;
            let candidates = [];

            traces.forEach(trace => {
                let name = (trace.name || "").toUpperCase();
                
                // Szukamy linii wskaźnika STH-SOPR
                if (name.includes('SOPR')) {
                    let xArr = trace.x;
                    let yArr = trace.y;
                    
                    if (xArr && yArr) {
                        // Skanujemy od końca odszukując najświeższą narysowaną na ekranie wartość
                        for (let i = yArr.length - 1; i >= 0; i--) {
                            let y = yArr[i];
                            if (y !== null && y !== undefined && !isNaN(y)) {
                                candidates.push({
                                    date: String(xArr[i]).split('T')[0].split(' ')[0], // czyszczenie daty
                                    value: parseFloat(y),
                                    time: new Date(String(xArr[i])).getTime()
                                });
                                break;
                            }
                        }
                    }
                }
            });

            if (candidates.length > 0) {
                // Wybieramy najświeższy punkt ze wszystkich znalezionych fragmentów linii
                candidates.sort((a, b) => b.time - a.time);
                return { date: candidates[0].date, value: candidates[0].value };
            }

            return { error: "W rozpakowanych danych _fullData nadal brak liczb." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] BINGO! Pobrano wyrenderowane piksele z pamięci karty graficznej!`);
        console.log(`[SUCCESS] Najnowszy punkt z giełdy: Dzień = ${result.date} | Wartość STH-SOPR = ${result.value}`);

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
        console.log(`[SUCCESS] Baza danych JSON zapisana bezbłędnie. Zakończono pełnym sukcesem!`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
