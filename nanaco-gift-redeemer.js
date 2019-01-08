const puppeteer = require('puppeteer');
const {TimeoutError} = require('puppeteer/Errors');
const path = require('path');
const os = require('os');
const my = require(__dirname + '/common_functions.js');
const scriptName = path.basename(__filename);
const yargs = require('yargs')
      .usage('Usage: $0 [options]')
      .boolean('debug')
      .describe('debug', 'Force headful')
      .help()
      .version('0.0.1')
      .locale('en');
const argv = yargs.argv;
require('dotenv').config();
const options = {
  "headless" : !(argv.debug),
  "slowMo" : 'SLOWMO' in process.env ? parseInt(process.env.SLOWMO, 10) : 200,
  "defaultViewport" : {
    "width": 'VIEWPORT_WIDTH' in process.env ? parseInt(process.env.VIEWPORT_WIDTH, 10) : 1024,
    "height": 'VIEWPORT_HEIGHT' in process.env ? parseInt(process.env.VIEWPORT_HEIGHT, 10) : 768
  },
};

(async () => {
  const browser = await puppeteer.launch(options);
  let page = await browser.newPage();
  if (argv.debug) {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  }

  try {
    let addedPoint = 0;
    for (let giftId of argv._) {
      if (!giftId.match(/^[A-Za-z0-9]{16}$/)) {
        console.log('Ignored nanaco Gift ID: '+giftId);
        continue;
      }
      await login(page, giftId);
      await top(page);
      addedPoint += await applyNanacoGift(page);
    }
    console.log('累計 '+addedPoint+' 円分のnanacoギフトを登録しました。');

    // ログインページ
    async function login(page, giftId) {
      console.log('login()');
      await my.goto(page, 'https://www.nanaco-net.jp/pc/emServlet?gid='+giftId);

      const number = process.env.NANACO_NUMBER;
      const seccode = process.env.NANACO_SECCODE;
      const password = process.env.NANACO_PASSWORD;
      if (number != null && seccode != null) {
        await page.type('input#nanacoNumber02', number);
        await page.type('input[name="SECURITY_CD"]', seccode);
        await page.click('input[name="ACT_ACBS_do_LOGIN2"]');
      } else if (number != null && password != null) {
        await page.type('input#nanacoNumber01', number);
        await page.type('input[name="LOGIN_PWD"]', password);
        await page.click('input[name="ACT_ACBS_do_LOGIN1"]');
      } else {
        console.log('error');
      }
    }
    // topページ
    async function top(page) {
      console.log('top()');
      page.waitForSelector('a[href*="_ActionID=ACBS_do_NNC_GIFT_REG"]', {visible: true}).then(el => el.click());
    }

    // nanacoギフトtopページ
    async function applyNanacoGift(page) {
      console.log('nanacoGiftTop()');
      const button = await page.waitForSelector('input[type="image"]', {visible: true});

      let newPage;
      [newPage] = await Promise.all([
        new Promise(resolve => browser.once('targetcreated', target => resolve(target.page()))),
        button.click()
      ]);
      // ギフトID登録フォーム
      await Promise.all([
        newPage.waitForNavigation({waitUntil: "domcontentloaded"}),
        newPage.waitForSelector('input[type="image"]', {visible: true}).then(el => el.click())
      ]);
      // ギフトID登録内容確認（ID登録済みの場合は表示されない）
      let table = await newPage.waitForSelector('table.form', {visible: true})
      const th = await table.$$('th');
      let alreadyApplied = false; // 登録済み
      if (th.length == 2) {
        // ギフトID登録内容確認
        console.log('ギフトID登録内容確認');
        const button = await newPage.$('form#registerForm input[type="image"]');
        await Promise.all([
          newPage.waitForNavigation({waitUntil: "domcontentloaded"}),
          button.click()
        ]);
        table = await newPage.waitForSelector('table.form', {visible: true})
      } else if (th.length == 5) {
        console.log('ギフトID登録済み');
        alreadyApplied = true;
      } else {
        throw new Error('ギフトID情報の行数がおかしい');
      }
      // ギフトID登録完了ページ
      console.log('ギフトID登録完了');
      let addedPoints = 0;
      if (!alreadyApplied) {
        addedPoints = await table.$eval('tr:nth-child(3) td', el => parseInt(el.textContent.replace(/円$/g, ' '), 10));
        console.log(addedPoints);
      }
      let result = await table.$eval('tbody', el => el.textContent.replace(/[,\s]+/g, ' '));
      console.log(result);
      await newPage.close(); // 新ウインドウを消す
      return addedPoints;
    }
  } catch (e) {
    console.log(e);
    my.postError(e);
    await my.postUrls(browser);
    await my.uploadScreenShot(page, 'error.png');
  } finally {
    if (argv.debug) {
      console.log('The script is finished.');
    } else {
      await browser.close();
    }
  }
})();
