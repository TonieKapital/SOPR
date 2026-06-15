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
        console.log(`[LOG] Strona załadowana. Odszyfrowywanie rzadkich tablic słownikowych...`);

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

            if (!plotDiv || !plotDiv.data) return { error: "Brak wykresu Plotly w pamięci." };

            const traces = plotDiv.data;

            // 1. Zabezpieczamy oś czasu z głównego wykresu (Cena posiada pełną tablicę X)
            let masterX = [];
            traces.forEach(t => {
                if (t.x && Array.isArray(t.x) && t.x.length > masterX.length) {
                    masterX = t.x;
                }
            });

            if (masterX.length === 0) return { error: "Nie odnaleziono osi dat." };

            // 2. Łapiemy obie części rozbitego wskaźnika STH-SOPR
            const traceHigh = traces.find(t => t.name && t.name.includes('STH-SOPR > 1'));
            const traceLow = traces.find(t => t.name && t.name.includes('STH-SOPR < 1'));

            if (!traceHigh && !traceLow) return { error: "Nie odnaleziono linii STH-SOPR." };

            let latestDate = null;
            let latestValue = null;

            // 3. PĘTLA KLUCZOWA: Iterujemy po długości osi X!
            // Oś Y to Obiekt (słownik), wyciągamy z niego wartości podając indeks klucza
            for (let i = masterX.length - 1; i >= 0; i--) {
                let valHigh = (traceHigh && traceHigh.y && traceHigh.y[i] !== undefined) ? traceHigh.y[i] : null;
                let valLow = (traceLow && traceLow.y && traceLow.y[i] !== undefined) ? traceLow.y[i] : null;

                let val = null;
                // Wybieramy wartość z tej linii (słownika), która przechowuje wpis na dany dzień
                if (valHigh !== null && !isNaN(valHigh)) val = valHigh;
                else if (valLow !== null && !isNaN(valLow)) val = valLow;

                if (val !== null) {
                    let dateStr = String(masterX[i]);
                    latestDate = dateStr.split('T')[0].split(' ')[0]; // Zostawiamy czyste YYYY-MM-DD
                    latestValue = parseFloat(val);
                    break;
                }
            }

            if (latestDate) return { date: latestDate, value: latestValue };
            return { error: "Słowniki Y nie zawierały żadnych pasujących liczb." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] BINGO! Odszyfrowano słowniki w pamięci RAM!`);
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
