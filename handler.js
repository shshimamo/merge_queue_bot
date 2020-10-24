'use strict';

const Slack = require('slack');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

module.exports.run = async ( event ) =>
{
  const dataObject = JSON.parse( event.body );

  // The response we will return to Slack
  let response = {
    statusCode: 200,
    body      : {},
    // Tell slack we don't want retries, to avoid multiple triggers of this lambda
    headers   : { 'x-slack-no-retry': 1 }
  };

  try {
    verify(dataObject);

    // If the Slack retry header is present, ignore the call to avoid triggering the lambda multiple times
    if (!('x-slack-retry-num' in event.headers)) {
      switch (dataObject.type) {
        case 'url_verification':
          response.body = verifyCall(dataObject);
          break;
        case 'event_callback':
          await handleMessage(dataObject.event);
          response.body = {ok: true};
          break;
        default:
          response.statusCode = 400;
          response.body = 'Empty request';
          break;
      }
    }
  } catch (err) {
    response.statusCode = 500;
    response.body = JSON.stringify(err);
  } finally {
    return response;
  }
}

function verify( data )
{
  if (data.token === process.env.VERIFICATION_TOKEN) {
    return;
  } else {
    throw 'Verification failed';
  }
}

/**
 * Verifies the URL with a challenge - https://api.slack.com/events/url_verification
 * @param  {Object} data The event data
 */
function verifyCall( data )
{
  if (data.token === process.env.VERIFICATION_TOKEN) {
    return data.challenge;
  } else {
    throw 'Verification failed';
  }
}

/**
 * Process the message and executes an action based on the message received
 * @async
 * @param {Object} message The Slack message object
 */
async function handleMessage(message) {
  // Makes sure the bot was actually mentioned
  if (!message.bot_id) {
    // Gets the command from the message
    let command = parseMessage(message.text);

    // Executes differend commands based in the specified instruction
    switch (command) {
      case 'stop':
        await sendSlackMessage(message.channel, 'stop called');
        break;
      case 'start':
        await sendSlackMessage(message.channel, 'start called');
        break;
      case 'status':
        const bool = await isActive();
        await sendSlackMessage(message.channel, bool ? '稼働しています' : '停止しています');
        break;
      default:
        await sendSlackMessage(message.channel, 'stop, start, status を指定してください');
        break;
    }
  }
}

/**
 * Sends a message to Slack
 * @param  {String} channel
 * @param  {String} message
 * @return {Promise}
 */
function sendSlackMessage(channel, message) {
  const params = {
    token: process.env.BOT_TOKEN,
    channel: channel,
    text: message

  };

  return Slack.chat.postMessage(params);
}

/**
 * Parses the command/intent from the text of a message received by the bot
 * @param  {String} message
 * @return {String}
 */
function parseMessage(message) {
  return message.split(' ', 2).pop();
}

async function isActive() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });

  let page = await browser.newPage();

  // pauseリンク
  await page.goto('https://mergequeue.com/dashboard', {waitUntil: "domcontentloaded"});
  await page.type("input[name=username]", process.env.MERGE_QUEUE_EMAIL);
  await page.type("input[name=password]", process.env.MERGE_QUEUE_PASSWORD);
  page.click('button[type=submit]');
  await page.waitForNavigation({timeout: 60000, waitUntil: "domcontentloaded"});

  let text = await page.$eval('.main .repo', item => {
    return item.textContent;
  });

  if(text.includes("YES")) {
    return true
  } else {
    return false
  }
}
