const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });
  await page.goto('file://' + path.resolve(__dirname, 'meme-nervous-system.html'), { waitUntil: 'load' });

  const element = await page.$('.meme');
  await element.screenshot({ path: path.resolve(__dirname, 'meme-nervous-system.png'), type: 'png' });

  console.log('Screenshot saved to meme-nervous-system.png');
  await browser.close();
})();
