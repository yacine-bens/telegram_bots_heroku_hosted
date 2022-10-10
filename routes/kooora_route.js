// Main modules
require('dotenv').config();
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const axios = require('axios');
const { MongoClient, ServerApiVersion } = require('mongodb');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

router.use(bodyParser.json());

// Set appropriate Token
const TOKEN = process.env.TOKEN_KOOORA;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;
const URI = `/webhook/${TOKEN}`;

// Set webhook
router.get('/setWebhook', async (req, res) => {
    // req.baseUrl : route endpoint
    const SERVER_URL = 'https://' + req.get('host') + req.baseUrl;
    const WEBHOOK_URL = SERVER_URL + URI;
    const response = await axios.get(`${TELEGRAM_API}/setWebhook?url=${WEBHOOK_URL}`)
    return res.send(response.data);
});

// MongoDB
const { DB_URI } = process.env;
const client = new MongoClient(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

// Receive messages
router.post(URI, async (req, res) => {
    console.log(req.body);

    // Check if update is a message
    if (!req.body.message || !req.body.message.text) return res.send();
    
    // Get bot name from endpoint
    const botName = req.baseUrl.replace('/', '');

    const updateId = req.body.update_id;
    const chatId = req.body.message.chat.id;
    const messageText = req.body.message.text;

    const database = await client.connect();
    const db = database.db(botName);
    
    // Check if update is repeated
    const repeatedUpdate = await isRepeatedUpdate(chatId, updateId, db);
    if (repeatedUpdate) return res.send();

    // To be sent to the user
    let response_message = '';

    try {
        // Check if message is a bot command
        if (isBotCommand(req.body.message)) {
            if (messageText === '/start') response_message = 'Please do something.'
            else if (messageText === '/matches') {
                // Send "Please wait" message
                await pleaseWait(TELEGRAM_API, chatId);

                // Send reponse to Telegram server (avoid resending update)
                res.send();

                let matches = await getMatches();
                if (matches.length) response_message = formatMatchesDetails(matches);
                else response_message = 'No matches today!';
            }
        }

        //Respond to user
        if (response_message != '') {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: chatId,
                text: response_message
            })
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

async function getMatches() {
    let matches = [];

    const res = await axios.get('https://www.kooora.com');

    const { document } = (new JSDOM(res.data)).window;
    let matchesScript = [...document.querySelectorAll('script')].filter(el => el.innerHTML.includes('match_box'))[0];
    if (matchesScript) {
        let matchesIDs = matchesScript.innerHTML.split('var match_box = new Array (')[1].split(')')[0].split('\n').map(el => el.length < 10 ? null : el.split(',')[1]).filter(e => e != null);
        for (let matchId of matchesIDs) {
            let match = await getMatch(matchId);
            matches.push(match);
        }
    }

    return matches;
}


async function getMatch(id) {
    let res = await axios.get('https://www.kooora.com/?m=' + id + '&ajax=true');
    let matchDetails = res.data.matches_list;
    let time = matchDetails[6].split('@')[0];
    let teamId1 = matchDetails[7];
    let teamId2 = matchDetails[12];
    let channels = matchDetails[19].split('~l|');
    // remove first element (referees and commentary details ...)
    channels.shift();
    channels = channels.map(channel => { return { id: channel.split('|')[0], name: channel.split('|')[1] } });
    let teamName1 = await getTeam(teamId1);
    let teamName2 = await getTeam(teamId2);

    const match = {
        time: time,
        team1: teamName1,
        team2: teamName2,
        channels: channels
    };

    return match;
}


async function getTeam(id) {
    let res = await axios.get('https://www.kooora.com/?team=' + id);
    let team = res.data.match(/var team_name_en = "(.*?)"/)[1];
    return team;
}


function formatMatchesDetails(matches) {
    let message = '';
    matches.forEach(match => {
        let time = cleanUpTime(match['time']);
        message += `${time}\n${match['team1']} -- ${match['team2']}\n\n`;
    });
    return message;
}


function cleanUpTime(time) {
    let cleanedUpTime = time;
    const allowed_chars = [":", "'"];
    let special_chars = time.match(/\D/g);
    if (special_chars) {
        special_chars.forEach(char => { if (!allowed_chars.includes(char)) cleanedUpTime = cleanedUpTime.replace(char, '').trim() });
    }
    return cleanedUpTime;
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

module.exports = router;