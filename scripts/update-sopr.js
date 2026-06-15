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
        
        // Zwiększamy bufor czasowy na całkowite rozładowanie i rozpakowanie binarne przez Plotly
        await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
        
        console.log(`[LOG] Strona załadowana. Skanowanie wyrenderowanych obiektów Plotly...`);

        const result = await page.evaluate(() => {
            // Agresywne szukanie wykresu: szukamy domyślnej klasy, lub jakiegokolwiek div'a z danymi
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

            if (!plotDiv || !plotDiv.data) {
                return { error: "Krytyczny błąd: Wirtualna przeglądarka nie wykryła żadnego aktywnego wykresu Plotly w strukturze strony." };
            }

            const traces = plotDiv.data;
            let latestDate = null;
            let latestValue = null;
            let maxTimestamp = -1;

            // Zapisujemy nazwy wszystkich wykrytych linii na wypadek błędu diagnostycznego
            let availableNames = traces.map(t => t.name || 'unnamed_trace');

            traces.forEach(trace => {
                let name = trace.name ? trace.name.toUpperCase() : "";
                
                // Szerokie, niewrażliwe na wielkość liter wyszukiwanie słowa 'SOPR'
                if (name.includes('SOPR')) {
                    const xArr = trace.x;
                    const yArr = trace.y;
                    
                    if (xArr && yArr && xArr.length === yArr.length) {
                        // Skanujemy od końca, omijając puste miejsca rynkowe (nulle)
                        for (let i = yArr.length - 1; i >= 0; i--) {
                            if (yArr[i] !== null && yArr[i] !== undefined && !isNaN(yArr[i])) {
                                let dateStr = String(xArr[i]);
                                let time = new Date(dateStr).getTime();
                                
                                // Jeśli punkt jest prawidłowy chronologicznie, zapisujemy go
                                if (!isNaN(time) && time > maxTimestamp) {
                                    maxTimestamp = time;
                                    // Ucinamy formatowanie z daty zostawiając czyste YYYY-MM-DD
                                    latestDate = dateStr.split('T')[0].split(' ')[0];
                                    latestValue = parseFloat(yArr[i]);
                                }
                                break;
                            }
                        }
                    }
                }
            });

            if (latestDate) {
                return { date: latestDate, value: latestValue, debug: availableNames };
            }
            return { error: `Algorytm nie wyłapał liczb. Dostępne na wykresie linie to: [${availableNames.join(' | ')}]` };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] Dane wyciągnięte bezbłędnie z przeglądarki!`);
        console.log(`[SUCCESS] Znalezione linie na wykresie: ${result.debug.join(', ')}`);
        console.log(`[SUCCESS] Najnowszy punkt rynkowy: Dzień = ${result.date} | Wartość STH-SOPR = ${result.value}`);

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
