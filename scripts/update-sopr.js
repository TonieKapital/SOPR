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
        console.log(`[LOG] Strona załadowana. Izolowanie niezależnych śladów Plotly...`);

        const result = await page.evaluate(() => {
            let plotDiv = document.querySelector('.js-plotly-plot');
            if (!plotDiv || !plotDiv.data) {
                const allDivs = document.querySelectorAll('div');
                for (let div of allDivs) {
                    if (div.data && Array.isArray(div.data) && div.data.length > 0) {
                        plotDiv = div;
                        break;
                    }
                }
            }

            if (!plotDiv || !plotDiv.data) return { error: "Brak wykresu Plotly na stronie." };

            const traces = plotDiv.data;
            let candidates = [];

            // Przeszukujemy wszystkie dostępne linie na wykresie
            traces.forEach(trace => {
                if (trace.name && trace.name.includes('STH-SOPR')) {
                    const xArr = trace.x;
                    const yArr = trace.y;
                    
                    if (xArr && yArr) {
                        // Skanujemy każdą linię od jej własnego końca
                        for (let i = yArr.length - 1; i >= 0; i--) {
                            let y = yArr[i];
                            // Ignorujemy wszelkie puste rekordy i "śmieci"
                            if (y !== null && y !== 'null' && y !== undefined && y !== '') {
                                let parsedY = parseFloat(y);
                                if (!isNaN(parsedY)) {
                                    let dateStr = String(xArr[i]);
                                    let time = new Date(dateStr).getTime();
                                    
                                    if (!isNaN(time)) {
                                        // Zapisujemy najnowszą znalezioną wartość z tej konkretnej linii
                                        candidates.push({
                                            date: dateStr.split('T')[0].split(' ')[0],
                                            value: parsedY,
                                            time: time
                                        });
                                        break; // Przerywamy pętlę dla tej linii, bo mamy już jej szczyt
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (candidates.length > 0) {
                // Sortujemy znalezione wyniki z różnych linii po czasie (od najnowszego)
                candidates.sort((a, b) => b.time - a.time);
                // Zwracamy absolutnie najświeższy punkt z całego wykresu
                return { date: candidates[0].date, value: candidates[0].value };
            }

            return { error: "Nie odnaleziono powiązanych punktów x/y w śladach STH-SOPR." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] Dane wyodrębnione i zsynchronizowane!`);
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
        console.log(`[SUCCESS] Baza danych JSON została zaktualizowana.`);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
