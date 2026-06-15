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
        
        // Zmiana taktyki: czekamy na wyciszenie sieci, a następnie wymuszamy 5 sekund twardego snu
        // Daje to pewność, że ciężkie skrypty Plotly zdążą rozpakować binarne wartości
        await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log(`[LOG] Sieć wyciszona. Oczekiwanie 5 sekund na wewnętrzną dekompresję JS...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log(`[LOG] Uruchamianie SONDY PAMIĘCI RAM...`);

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

            if (!plotDiv || !plotDiv.data) return { error: "Brak wykresu Plotly w pamięci DOM." };

            const traces = plotDiv.data;
            let report = [];

            traces.forEach((t, i) => {
                let name = t.name || `Trace_${i}`;
                // Interesują nas tylko główne linie, w tym cena i SOPR
                if (name.includes('SOPR') || name.includes('Price')) {
                    let xLen = t.x ? t.x.length : 0;
                    let yLen = t.y ? t.y.length : 0;
                    let xType = t.x ? t.x.constructor.name : 'Brak osi X';
                    let yType = t.y ? t.y.constructor.name : 'Brak osi Y';

                    let lastValidY = [];
                    let lastValidX = [];

                    // Próbujemy wyciągnąć 3 ostatnie fizyczne liczby z osi Y i dopasowane do nich daty
                    if (t.y && t.y.length > 0) {
                        for(let j = t.y.length - 1; j >= 0; j--) {
                            if(t.y[j] !== null && t.y[j] !== undefined) {
                                lastValidY.push(t.y[j]);
                                if (t.x && t.x[j]) {
                                    lastValidX.push(t.x[j]);
                                } else {
                                    lastValidX.push("UNDEFINED");
                                }
                                if (lastValidY.length === 3) break;
                            }
                        }
                    }

                    report.push(`[${name}] X: (typ: ${xType}, len: ${xLen}) | Y: (typ: ${yType}, len: ${yLen}) | Ost. daty: ${JSON.stringify(lastValidX)} | Ost. wart: ${JSON.stringify(lastValidY)}`);
                }
            });

            return { dump: report };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`\n==================== [MEMORY DUMP] ====================`);
        result.dump.forEach(line => console.log(line));
        console.log(`=======================================================\n`);
        
        // Zatrzymujemy program z błędem celowo, aby zrzucić logi do ekranu Actions
        console.log(`[CRITICAL ERROR] Praca przerwana celowo. Algorytm zatrzymał się, by wyświetlić zrzut pamięci.`);
        process.exit(1);

    } catch (error) {
        console.error("[CRITICAL ERROR]", error.message);
        process.exit(1);
    } finally {
        await browser.close();
        console.log(`[LOG] Przeglądarka zamknięta.`);
    }
}

main();
