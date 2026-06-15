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
        console.log(`[LOG] Strona załadowana. Mapowanie wirtualnych osi Plotly...`);

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
            
            // 1. Zabezpieczamy "Master Axis" (najdłuższą oś czasu na całym wykresie)
            let masterX = [];
            traces.forEach(t => {
                if (t.x && t.x.length > masterX.length) {
                    masterX = t.x;
                }
            });

            if (masterX.length === 0) return { error: "Nie odnaleziono głównej osi czasu na wykresie." };

            // 2. Przeszukujemy linie SOPR i parujemy je z Master Axis
            traces.forEach(trace => {
                let name = trace.name ? trace.name.toUpperCase() : "";
                
                if (name.includes('SOPR')) {
                    const yArr = trace.y;
                    // Jeśli linia SOPR nie ma swoich dat (optymalizacja Plotly), używamy masterX
                    const xArr = (trace.x && trace.x.length > 0) ? trace.x : masterX;
                    
                    if (yArr && xArr) {
                        // Skanujemy od końca by ominąć przyszłe paddingi (nulle, NaN)
                        for (let i = yArr.length - 1; i >= 0; i--) {
                            let y = yArr[i];
                            // Akceptujemy tylko poprawne, niepuste liczby
                            if (y !== null && y !== undefined && y !== '' && !isNaN(y)) {
                                let dateStr = String(xArr[i]);
                                let time = new Date(dateStr).getTime();
                                
                                if (!isNaN(time)) {
                                    candidates.push({
                                        date: dateStr.split('T')[0].split(' ')[0], // Format YYYY-MM-DD
                                        value: parseFloat(y),
                                        time: time
                                    });
                                    break; // Mamy najnowszy punkt dla tej linii, idziemy do kolejnej
                                }
                            }
                        }
                    }
                }
            });

            if (candidates.length > 0) {
                // Sortujemy od najnowszego (najwyższy timestamp)
                candidates.sort((a, b) => b.time - a.time);
                return { date: candidates[0].date, value: candidates[0].value };
            }

            return { error: "Nie udało się sparować żadnych liczb SOPR z osią czasu." };
        });

        if (result.error) {
            throw new Error(result.error);
        }

        console.log(`[SUCCESS] BINGO! Dane pomyślnie zrekonstruowane i wyciągnięte!`);
        console.log(`[SUCCESS] Najnowszy punkt z giełdy: Dzień = ${result.date} | Wartość STH-SOPR = ${result.value}`);

        // Zapis do lokalnego JSON-a
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
                console.log(`[LOG] Dane dla dnia ${result.date} są całkowicie aktualne. Brak zmian.`);
            }
        } else {
            localDatabase.push({
                date: result.date,
                value: result.value,
                updatedAt: new Date().toISOString()
            });
            console.log(`[LOG] Dodano nowy rekord rynkowy dla daty: ${result.date}`);
        }

        fs.writeFileSync(DATA_PATH, JSON.stringify(localDatabase, null, 2), 'utf-8');
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
