// Main modules
require('dotenv').config();
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const axios = require('axios');
const { MongoClient, ServerApiVersion } = require('mongodb');
const FormData = require('form-data');
const puppeteer = require('puppeteer');

router.use(bodyParser.json());

// Set appropriate Token
const TOKEN = process.env.TOKEN_PUPPETEER_SCREENSHOT;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const URI = `/webhook/${TOKEN}`;

// Set webhook
router.get('/setWebhook', async (req, res) => {
    // req.baseUrl : route endpoint
    const SERVER_URL = 'https://' + req.get('host') + req.baseUrl;
    const WEBHOOK_URL = SERVER_URL + URI;
    const response = await axios.get(`${TELEGRAM_API}/setWebhook?url=${WEBHOOK_URL}`)
    return res.send(response.data);
})

// MongoDB
const { DB_URI } = process.env;
const client = new MongoClient(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const settings = {
    device: {
        values: {
            android: 'Mozilla/5.0 (Linux; Android 13; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.5249.79 Mobile Safari/537.36',
            windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
            ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/106.0.5249.92 Mobile/15E148 Safari/604.1',
            mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36'
        },
        keyboard: {
            text: 'Choose Device',
            inlineKeyboard: [
                [{ text: 'Windows', callback_data: 'device_windows' }, { text: 'Mac', callback_data: 'device_mac' }],
                [{ text: 'Android', callback_data: 'device_android' }, { text: 'iOS', callback_data: 'device_ios' }],
                [{ text: 'Back to menu', callback_data: 'menu' }]
            ]
        }
    },
    resolution: {
        values: {
            '800': { width: 800, height: 600 },
            '1280': { width: 1280, height: 800 },
            '1440': { width: 1440, height: 900 },
            '1920': { width: 1920, height: 1080 }
        },
        keyboard: {
            text: 'Set Resolution',
            inlineKeyboard: [
                [{ text: '800x600', callback_data: 'resolution_800' }, { text: '1280x800', callback_data: 'resolution_1280' }],
                [{ text: '1440x900', callback_data: 'resolution_1440' }, { text: '1920x1080', callback_data: 'resolution_1920' }],
                [{ text: 'Back to menu', callback_data: 'menu' }]
            ]
        }
    },
    fullPage: {
        values: {
            'yes': true,
            'no': false
        },
        keyboard: {
            text: 'Capture Full Page ?',
            inlineKeyboard: [
                [{ text: 'Yes', callback_data: 'fullPage_yes' }, { text: 'No', callback_data: 'fullPage_no' }],
                [{ text: 'Back to menu', callback_data: 'menu' }]
            ]
        }
    },
    format: {
        values: {
            'image': 'image',
            'pdf': 'pdf'
        },
        keyboard: {
            text: 'Choose Format',
            inlineKeyboard: [
                [{ text: 'Image', callback_data: 'format_image' }, { text: 'PDF', callback_data: 'format_pdf' }],
                [{ text: 'Back to menu', callback_data: 'menu' }]
            ]
        }
    },
    menu: {
        values: {},
        keyboard: {
            text: 'Screenshot settings',
            inlineKeyboard: [
                [{ text: 'Full Page', callback_data: 'fullPage' }],
                [{ text: 'Resolution', callback_data: 'resolution' }],
                [{ text: 'Device', callback_data: 'device' }],
                [{ text: 'Format', callback_data: 'format' }],
                [{ text: 'Exit', callback_data: 'exit' }]
            ]
        }
    }
};

// Receive messages
router.post(URI, async (req, res) => {
    console.log(JSON.stringify(req.body, null, 2));

    // Get bot name from endpoint
    const botName = req.baseUrl.replace('/', '');

    const database = await client.connect();
    const db = database.db(botName);

    // Update is a callback query
    if (req.body.callback_query) {
        const cbQueryId = req.body.callback_query.id;
        const cbQueryData = req.body.callback_query.data;
        const msgId = req.body.callback_query.message.message_id;
        const chatId = req.body.callback_query.message.chat.id;

        // Menu queries (fullPage , resolution)
        if (!cbQueryData.includes('_')) {
            if (cbQueryData === 'exit') {
                await deleteMessage(chatId, msgId);
            }
            else {
                const keyboard = inlineKeyboard(cbQueryData);
                await sendInlineKeyboard(chatId, msgId, cbQueryId, keyboard);
            }
        }
        // Value queries (fullPage_no , resolution_800...)
        else {
            // Set settings
            const settingsName = cbQueryData.split('_')[0];
            const settingsKey = cbQueryData.split('_')[1];
            const settingsValue = settings[settingsName]['values'][settingsKey];

            const newSettings = {
                name: settingsName,
                value: settingsValue
            }

            await setUserSettings(chatId, newSettings, db);

            await answerCallback(cbQueryId, 'Settings successfully changed.', true);

            // Go back to main menu
            const keyboard = inlineKeyboard('menu');
            await sendInlineKeyboard(chatId, msgId, cbQueryId, keyboard);
        }
        return res.send();
    }
    // Update is not a message
    else if (!req.body.message || !req.body.message.text) return res.send();

    const updateId = req.body.update_id;
    const chatId = req.body.message.chat.id;
    const messageText = req.body.message.text;
    const msgId = req.body.message.message_id;

    // Check if update is repeated
    const repeatedUpdate = await isRepeatedUpdate(chatId, updateId, db);
    if (repeatedUpdate) return res.send();

    // To be sent to the user
    let msg = '';
    let screenshot = '';

    // User settings
    const userSettings = await getUserSettings(chatId, db);

    try {
        // Check if message is a bot command
        if (isBotCommand(req.body.message)) {
            if (messageText === '/start') msg = 'Please enter an URL.';
            else if (messageText === '/settings') {
                await deleteMessage(chatId, msgId);
                await sendSettingsMenu(chatId);
                return res.send();
            }
        }
        else {
            // validate URL
            const url = validateUrl(messageText);
            if (url.length) {
                // Send please wait message
                await pleaseWait(TELEGRAM_API, chatId);

                // Take screenshot
                screenshot = await takeScreenshot(url, userSettings);
            }
            else {
                msg = 'Please enter a valid URL.'
            }
        }

        //Respond to user
        if (screenshot != '') {
            await sendPhoto(chatId, screenshot, userSettings.format);
        }
        else {
            await sendMessage(chatId, msg);
        }
    }
    catch (err) {
        console.log(err);
    }

    // Respond to Telegram server
    return res.send();
})

async function pleaseWait(api, chat_id) {
    axios.post(`${api}/sendMessage`, {
        chat_id: chat_id,
        text: 'Please wait...'
    })
}

function isBotCommand(msg) {
    if (msg.text.startsWith('/') && msg.entities) {
        for (let entity of msg.entities) {
            if (entity.type === "bot_command") return true;
        }
    }
    return false;
}

async function takeScreenshot(url, settings) {
    let screenshotBase64 = '';
    let browser;

    const options = {
        args: ['--no-sandbox', '--hide-scrollbars', '--disable-web-security', '--disable-setuid-sandbox'],
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        headless: true
    };

    try {
        browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        await page.setViewport({
            ...settings.resolution,
            deviceScaleFactor: 1
        });
        await page.setUserAgent(settings.device);
        await page.goto(url, { waitUntil: 'networkidle0' });
        if (settings.format === 'image') {
            screenshotBase64 = await page.screenshot({
                type: 'png',
                fullPage: settings.fullPage,
                encoding: 'base64'
            })
        }
        else {
            screenshotBase64 = await page.pdf({
                ...settings.resolution,
                printBackground: true
            })
        }

        await browser.close();

        return screenshotBase64;
    }
    catch (err) {
        console.log(err);
        await browser.close();
        return '';
    }
}

async function sendPhoto(chat_id, screenshot_base64, format) {
    const extension = format === 'image' ? '.png' : '.pdf';
    const buffer = Buffer.from(screenshot_base64, 'base64');
    const formData = new FormData();
    formData.append('chat_id', chat_id);
    // must specify filename (screenshot.png / screenshot.pdf)
    formData.append('document', buffer, 'screenshot' + extension);

    await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
        headers: formData.getHeaders()
    });
}

function validateUrl(urlString) {
    var urlPattern = new RegExp('^(https?:\\/\\/)?' + // validate protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // validate domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // validate OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // validate port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // validate query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // validate fragment locator

    if (!urlPattern.test(urlString)) return '';

    return (!urlString.startsWith('http')) ? 'https://' + urlString : urlString;
}

async function isRepeatedUpdate(chat_id, update_id, db) {
    const updatesCollection = db.collection('updates');
    const result = await updatesCollection.findOne({ chat_id: chat_id }, { projection: { _id: 0 } });

    // First time
    if (!result) {
        await updatesCollection.insertOne({ chat_id: chat_id, last_update: update_id });
    }
    else {
        if (parseInt(update_id) <= parseInt(result.last_update)) return true;
        await updatesCollection.updateOne({ chat_id: chat_id }, { $set: { last_update: update_id } });
        return false;
    }
}

async function getUserSettings(chat_id, db) {
    let userSettings = {
        fullPage: settings.fullPage.values['no'],
        resolution: settings.resolution.values['800'],
        device: settings.device.values['windows'],
        format: settings.format.values['image']
    };

    const userSettingsCollection = db.collection('user_settings');
    const result = await userSettingsCollection.findOne({ chat_id: chat_id }, { projection: { _id: 0 } });

    // First time
    if (!result) {
        await userSettingsCollection.insertOne({ chat_id: chat_id, ...userSettings });
    }
    else {
        userSettings.fullPage = result.fullPage;
        userSettings.resolution = result.resolution;
        userSettings.device = result.device;
        userSettings.format = result.format;
    }

    return userSettings;
}

async function setUserSettings(chat_id, settings, db) {
    const userSettingsCollection = db.collection('user_settings');
    await userSettingsCollection.updateOne({ chat_id: chat_id }, { $set: { [settings.name]: settings.value } });
}

function inlineKeyboard(cb_query_data) {
    let keyboard = {
        text: '',
        inlineKeyboard: []
    }
    keyboard.text = settings[cb_query_data]['keyboard']['text'];
    keyboard.inlineKeyboard = settings[cb_query_data]['keyboard']['inlineKeyboard'];

    return keyboard;
}

async function sendInlineKeyboard(chat_id, msg_id, cb_query_id, keyboard) {
    await axios.post(`${TELEGRAM_API}/editMessageText`, {
        chat_id: chat_id,
        message_id: msg_id,
        text: keyboard.text,
        reply_markup: {
            inline_keyboard: keyboard.inlineKeyboard
        }
    })

    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
        callback_query_id: cb_query_id
    })
}

async function deleteMessage(chat_id, msg_id) {
    await axios.post(`${TELEGRAM_API}/deleteMessage`, {
        chat_id: chat_id,
        message_id: msg_id
    })
}

async function sendSettingsMenu(chat_id) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chat_id,
        text: settings['menu']['keyboard']['text'],
        reply_markup: {
            inline_keyboard: settings['menu']['keyboard']['inlineKeyboard']
        }
    })
}

async function sendMessage(chat_id, msg) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chat_id,
        text: msg.length ? msg : 'Something went wrong, please try again.'
    });
}

async function answerCallback(cb_query_id, msg, show_alert) {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
        callback_query_id: cb_query_id,
        text: msg,
        show_alert: show_alert
    });
}

module.exports = router;