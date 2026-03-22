const puppeteer = require('puppeteer');
const path = require('path');

const memes = [
  'meme-own-healer.html',
  'meme-crystals.html',
  'meme-center.html',
  'meme-space.html'
];

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const file of memes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.goto('file://' + path.resolve(__dirname, file), { waitUntil: 'load' });
    const element = await page.$('.meme');
    const outName = file.replace('.html', '.png');
    await element.screenshot({ path: path.resolve(__dirname, outName), type: 'png' });
    console.log('✅ ' + outName);
    await page.close();
  }

  await browser.close();
  console.log('All done!');
})();
