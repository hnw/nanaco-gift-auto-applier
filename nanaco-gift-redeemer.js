require('dotenv').config();
const yargs = require('yargs')
      .usage('Usage: $0 [options]')
      .boolean('debug')
      .describe('debug', 'Force headful')
      .help()
      .version('0.0.1')
      .locale('en');
const argv = yargs.argv;

let log4js_appenders;
if (argv.debug) {
  log4js_appenders = ['console_raw', 'result', 'debug'];
} else {
  log4js_appenders = ['console', 'result'];
}

const log4js = require('log4js');
log4js.configure({
  appenders: {
    debug: { type: 'dateFile', filename: 'log/debug', alwaysIncludePattern: true, layout: { type: 'pattern', pattern: '[%d] [%p] %m' } },
    result_raw: { type: 'dateFile', filename: 'log/result', alwaysIncludePattern: true, layout: { type: 'pattern', pattern: '[%d] [%p] %m' } },
    console_raw: { type: 'console', layout: { type: 'messagePassThrough' } },
    console: { type: 'logLevelFilter', appender: 'console_raw', level: 'info' },
    result: { type: 'logLevelFilter', appender: 'result_raw', level: 'info' },
  },
  categories: { default: { appenders: log4js_appenders, level: 'debug' } }
});
const logger = log4js.getLogger();

const puppeteer = require('puppeteer');
const {TimeoutError} = require('puppeteer/Errors');
const path = require('path');
const scriptName = path.basename(__filename);
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
    page.on('console', msg => logger.debug('PAGE LOG:', msg.text()));
  }

  try {
    let totalPoint = 0;
    let nGift = 0;
    for (let giftId of argv._) {
      if (!giftId.match(/^[A-Za-z0-9]{16}$/)) {
        logger.warn(`与えられた引数はnanacoギフトのIDではないため無視しました: ${giftId}`);
        continue;
      }
      await login(page, giftId);
      await top(page);
      let addedPoint = await applyNanacoGift(page);
      if (addedPoint > 0) {
        nGift++;
        totalPoint += addedPoint;
      }
    }
    if (nGift <= 0) {
      logger.error('有効なnanacoギフトIDが1つも指定されませんでした。');
    } else {
      logger.info(`計 ${nGift} 個、${totalPoint} 円分のnanacoギフトを登録しました。`);
    }

    // ログインページ
    async function login(page, giftId) {
      logger.debug('login()');
      await page.goto('https://www.nanaco-net.jp/pc/emServlet?gid='+giftId);

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
        throw new Error('ログインに失敗しました。.envを確認してください。');
      }
    }
    // topページ
    async function top(page) {
      logger.debug('top()');
      page.waitForSelector('a[href*="_ActionID=ACBS_do_NNC_GIFT_REG"]', {visible: true}).then(el => el.click());
    }

    // nanacoギフトtopページ
    async function applyNanacoGift(page) {
      logger.debug('nanacoGiftTop()');
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
      let alreadyRedeemed = false; // 登録済み
      if (th.length == 2) {
        // ギフトID登録内容確認
        logger.debug('ギフトID登録内容確認');
        const button = await newPage.$('form#registerForm input[type="image"]');
        await Promise.all([
          newPage.waitForNavigation({waitUntil: "domcontentloaded"}),
          button.click()
        ]);
        table = await newPage.waitForSelector('table.form', {visible: true})
      } else if (th.length == 5) {
        logger.debug('ギフトID登録済み');
        alreadyRedeemed = true;
      } else {
        throw new Error('ギフトID情報の行数がおかしい');
      }
      // ギフトID登録完了ページ
      logger.debug('ギフトID登録完了');
      let addedPoints = 0;
      if (!alreadyRedeemed) {
        addedPoints = await table.$eval('tr:nth-child(3) td', el => parseInt(el.textContent.replace(/円$/g, ' '), 10));
      }
      let result = await table.$eval('tbody', el => el.textContent.replace(/[,\s]+/g, ' '));
      if (alreadyRedeemed) {
        logger.warn('[登録済]' + result);
      } else {
        logger.info('[登録成功]' + result);
      }
      await newPage.close(); // 新ウインドウを消す
      return addedPoints;
    }
  } catch (e) {
    logger.error(e);
  } finally {
    logger.debug('The script is finished.');
    if (!argv.debug) {
      await browser.close();
    }
  }
})();
