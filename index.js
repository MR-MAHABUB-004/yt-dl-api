const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Helper Functions ---

/**
 * Extracts the 11-character YouTube video ID from various URL formats.
 */
function extractYoutubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Uses a headless browser to solve the JS challenge and intercept the fresh cap_token.
 */
async function getFreshCapToken(videoId) {
    // Launch headless Chrome. 
    // Note: --no-sandbox is required if deploying to Linux servers (Heroku, Render, AWS, etc.)
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    const page = await browser.newPage();
    
    // Set a mobile user agent to match the target site's expectations
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36');

    let capToken = null;

    // Intercept network requests to catch the /api/verify payload
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (req.url().includes('/api/verify') && req.method() === 'POST') {
            const postData = req.postData();
            if (postData) {
                try {
                    const json = JSON.parse(postData);
                    if (json.capToken) {
                        capToken = json.capToken;
                    }
                } catch (e) {
                    // Ignore JSON parse errors for non-JSON payloads
                }
            }
        }
        req.continue();
    });

    try {
        // Navigate to the embed page. The frontend JS will automatically 
        // solve the challenge and call /api/verify.
        await page.goto(`https://embed.dlsrv.online/v2/full?videoId=${videoId}`, { 
            waitUntil: 'networkidle2', 
            timeout: 20000 
        });
        
        // Wait specifically for the verify request to ensure the token is captured
        await page.waitForRequest(req => req.url().includes('/api/verify'), { timeout: 15000 });
    } catch (error) {
        console.error("Puppeteer navigation/wait error:", error.message);
    }

    await browser.close();

    if (!capToken) {
        throw new Error("Failed to extract cap_token. The site's anti-bot protection may have changed.");
    }
    
    return capToken;
}

/**
 * Executes the API flow using Axios and the fresh cap_token.
 */
async function getDownloadLinks(videoId, capToken, format = 'mp3', quality = '320') {
    const instance = axios.create({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36',
            'Origin': 'https://embed.dlsrv.online',
            'Referer': `https://embed.dlsrv.online/v2/full?videoId=${videoId}`,
            'X-Requested-With': 'mark.via.gq'
        }
    });

    // 1. Verify Token to get JWT
    const verifyRes = await instance.post('https://embed.dlsrv.online/api/verify', { capToken });
    const authToken = verifyRes.data.token;
    if (!authToken) throw new Error("Failed to retrieve auth token.");
    
    instance.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

    // 2. Touch Session
    await instance.post('https://embed.dlsrv.online/api/session/touch', { videoId });

    // 3. Get Download URL
    const endpoint = format === 'mp3' ? 'mp3' : 'mp4';
    const dlRes = await instance.post(`https://embed.dlsrv.online/api/download/${endpoint}`, {
        videoId,
        format,
        quality
    });

    return dlRes.data;
}

// --- API Endpoints ---

app.get('/dl', async (req, res) => {
    const { url, format = 'mp3', quality = '320' } = req.query;

    if (!url) {
        return res.status(400).json({ success: false, error: "Missing 'url' query parameter." });
    }

    const videoId = extractYoutubeId(url);
    if (!videoId) {
        return res.status(400).json({ success: false, error: "Invalid YouTube URL. Could not extract Video ID." });
    }

    try {
        console.log(`[Request] Processing video: ${videoId} | Format: ${format} | Quality: ${quality}`);
        
        // Step 1: Get a fresh token using the headless browser
        const capToken = await getFreshCapToken(videoId);
        
        // Step 2: Use the fresh token to get the download link
        const result = await getDownloadLinks(videoId, capToken, format, quality);

        // Step 3: Return clean JSON response
        res.json({
            success: true,
            video_id: videoId,
            format: format,
            quality: quality,
            filename: result.filename,
            download_url: result.url,
            status: result.status
        });

    } catch (error) {
        console.error("Error processing request:", error.message);
        res.status(500).json({ 
            success: false, 
            error: "Failed to generate download link.", 
            details: error.message 
        });
    }
});

app.get('/', (req, res) => {
    res.json({ 
        message: "YouTube Downloader API is running.", 
        usage: "/dl?url=<youtube_url>&format=mp3&quality=320" 
    });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📖 Try it: http://localhost:${PORT}/dl?url=https://www.youtube.com/watch?v=7WPiaHjl8AE`);
});
