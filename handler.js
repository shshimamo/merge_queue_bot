'use strict';

const Slack = require('slack');
const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');

module.exports.run = async ( event ) =>
{
  const dataObject = JSON.parse( event.body );

  let response = {
    statusCode: 200,
    body      : {},
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

function verifyCall( data )
{
  if (data.token === process.env.VERIFICATION_TOKEN) {
    return data.challenge;
  } else {
    throw 'Verification failed';
  }
}

async function handleMessage(message) {
  if (message.bot_id) {
    return;
  }

  let command = parseMessage(message.text);

  if (!['stop', 'start', 'status'].includes(command)) {
    await sendSlackMessage(message.channel, 'stop, start, status を指定してください');
    return;
  }

  const active = await isActive();
  switch (command) {
    case 'stop':
      if (active) {
        await sendSlackMessage(message.channel, 'stop called');
      } else {
        await sendSlackMessage(message.channel, '既に停止しています');
      }
      break;
    case 'start':
      if (active) {
        await sendSlackMessage(message.channel, '既に稼働しています');
      } else {
        await sendSlackMessage(message.channel, 'start called');
      }
      break;
    case 'status':
      await sendSlackMessage(message.channel, active ? '稼働しています' : '停止しています');
      break;
    default:
      break;
  }
}

function sendSlackMessage(channel, message) {
  const params = {
    token: process.env.BOT_TOKEN,
    channel: channel,
    text: message

  };

  return Slack.chat.postMessage(params);
}

function parseMessage(message) {
  return message.split(' ', 2).pop();
}

async function newPage() {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  return await browser.newPage();
}

async function login(page) {
  await page.goto('https://mergequeue.com/dashboard', {waitUntil: "domcontentloaded"});
  await page.type("input[name=username]", process.env.MERGE_QUEUE_EMAIL);
  await page.type("input[name=password]", process.env.MERGE_QUEUE_PASSWORD);
  page.click('button[type=submit]');
  await page.waitForNavigation({timeout: 60000, waitUntil: "domcontentloaded"});
}

async function isActive() {
  let page = await newPage();
  await login(page);
  let text = await page.$eval('.main .repo', item => {
    return item.textContent;
  });
  if(text.includes("YES")) {
    return true
  } else {
    return false
  }
}
