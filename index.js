require('dotenv').config();
const express = require('express');
const axios = require('axios');

const kooora_route = require('./routes/kooora_route');
const puppeteer_screenshot_route = require('./routes/puppeteer_screenshot_route');

const routes = {
    '/kooora': kooora_route,
    '/puppeteer_screenshot': puppeteer_screenshot_route
}

const app = express();

// app.use('/first', first_route);
for (let route of Object.keys(routes)) {
    app.use(route, routes[route]);
}

const SERVER_URL = validateURL(process.env.SERVER_URL);

// Set webhook manually (case of serverless functions, ex: Vercel)
app.get('/setWebhooks', async (req, res) => {
    let response = await setWebhooks(routes);
    return res.send(response.data);
})

app.listen(process.env.PORT || 5000, async () => {
    console.log('App is running on port:', process.env.PORT || 5000);
    setWebhooks(routes);
});


async function setWebhooks(routes) {
    let response = {};

    for (let route of Object.keys(routes)) {
        let res = await axios.get(SERVER_URL + route + '/setWebhook');
        response[route] = res.data;
        console.log(res.data);
    }
    return response;
}


function validateURL(url) {
    let result = url;
    if (!url.startsWith('https')) {
        if (url.startsWith('http')) result = url.replace('http', 'https');
        else result = `https://${url}`;
    }
    // Remove additional slashes
    result = result.replace(/([^:]\/)\/+/g, "$1");
    // Remove trailing slash
    if (result.endsWith('/')) result = result.slice(0, result.length - 1);

    return result;
}