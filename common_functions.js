const {TimeoutError} = require('puppeteer/Errors');
const request = require('request');
const fs = require('fs');
let config;

module.exports = {
  goto: async function (page, url, options = {}, retry = 3) {
    const defaultOptions = {waitUntil: 'domcontentloaded'};
    console.log('my.goto()');
    try {
      await Promise.all([
        Promise.race([
          page.waitForNavigation({waitUntil: 'load'}),
          page.waitForNavigation({waitUntil: 'networkidle0'})
        ]),
        page.goto(url, Object.assign({}, defaultOptions, options))
      ])
    } catch (e) {
      if ((e instanceof TimeoutError) && retry > 0) {
        // タイムアウトならリトライ
        console.log(e.message);
        const browser = await page.browser();
        return await module.exports.goto(page, url, options, retry - 1);
      } else {
        // タイムアウト以外なら再スロー
        throw e;
      }
    }

  },
  waitForFrame: function (page, func) {
    let fulfill;
    const promise = new Promise(x => fulfill = x);
    checkFrame();
    return promise;

    function checkFrame() {
      const frame = page.frames().find(func);
      if (frame) {
        fulfill(frame);
      } else {
        page.once('framenavigated', checkFrame);
      }
    }
  },
  // Puppeteerのscreenshot関数を受け取ってSlackにアップロード
  postError: function (err) {
    const msg = `\`\`\`${err.stack}\`\`\``;
    module.exports.postMessageToSlack(msg, `Error: ${err.message}`);
  },
  postUrls: async function (browser) {
    let msg = '';
    const pages = await browser.pages();
    for (const page of pages) {
      msg += `\n${page.url()}`
    }
    module.exports.postMessageToSlack(msg, 'URL list');
  },
  // Puppeteerのobjcetを受け取ってscreenshotをSlackにアップロード
  uploadScreenShot: async function (obj, imagePath) {
    if (typeof(obj.screenshot) !== 'function') {
      throw new Error('1st argument must have "screenshot()" function');
      return;
    }
    await obj.screenshot({path: imagePath});
    module.exports.uploadToSlack(imagePath);
    fs.unlinkSync(imagePath);
  },
  // 稼いだポイントの情報をSlackに通知
  postEarnedSummary: function (siteName, prevPoint, currPoint, rate) {
    // どちらも小数第2位まで有効という前提
    const earnedPoint = +((currPoint - prevPoint).toFixed(2));
    const earnedYen = +((earnedPoint * rate).toFixed(2));
    let text;
    if (earnedPoint === 0.0) {
      text = `${siteName}の現在のポイント: ${currPoint}pt`;
    } else {
      text = `${siteName}で${earnedPoint}pt（${earnedYen}円）を獲得しました。\n`;
      text = text + `（${prevPoint}pt → ${currPoint}pt）`;
    }
    module.exports.postMessageToSlack(text);
  },
  postMessageToSlack: function (text, username = 'bot') {
    const data = {
      url: 'https://slack.com/api/chat.postMessage',
      formData: {
        token: config['slack']['token'],
        channel: config['slack']['channel'],
        text: text,
        username: username,
        icon_emoji: ':ghost:',
      }
    };
    request.post(data, function(error, response, body) {
      if (!error && response.statusCode == 200) {
        // do nothing
      } else {
        console.log('Upload failure :(');
      }
    });
  },
  uploadToSlack: function (path) {
    const data = {
      url: 'https://slack.com/api/files.upload',
      formData: {
        token: config['slack']['token'],
        file: fs.createReadStream(path),
        channels: config['slack']['channel'],
      }
    };
    request.post(data, function(error, response, body) {
      if (!error && response.statusCode == 200) {
        // do nothing
      } else {
        console.log('Upload failure :(');
      }
    });
  },
  loadConfig: function (configName) {
    config = require(__dirname + '/../config/config.json');
    for (i of [configName, 'options', 'slack']) {
      if (!config[i]) {
        throw new Error(`ERROR: config["${i}"] not found`);
      }
    }
    Object.assign(config, config[configName]);
    return config;
  },
};
