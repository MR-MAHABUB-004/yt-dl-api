const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 7270;

// Configure axios with realistic browser headers to bypass basic bot detection
const apiClient = axios.create({
    timeout: 120000, // 2 minutes
    headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json;charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36',
        'sec-ch-ua': '"Android WebView";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'Origin': 'https://audiocleaner.ai',
        'Referer': 'https://audiocleaner.ai/youtube-video-download',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty'
    }
});

/**
 * TODO: Replace this with the actual algorithm extracted from the website's JS.
 * Without the correct signature, the API will reject the request.
 */
function generateSign(payload, timestamp, nonce) {
    // Example placeholder: return crypto.createHmac('sha256', 'secret').update(timestamp + nonce).digest('hex');
    return 'PLACEHOLDER_SIGN_REPLACE_ME';
}

function generateSecretKey(payload, timestamp, nonce) {
    return 'PLACEHOLDER_SECRET_KEY_REPLACE_ME';
}

app.get('/api/dl', async (req, res) => {
    // 1. Fix URL parsing: Reconstruct the URL if Express split it at the '?'
    let youtubeUrl = req.query.url;
    if (req.query.si) {
        youtubeUrl = `${youtubeUrl}?si=${req.query.si}`;
    }

    if (!youtubeUrl || (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be'))) {
        return res.status(400).json({ 
            success: false,
            error: 'Valid YouTube URL is required. Usage: /api/dl?url=https://youtu.be/...' 
        });
    }

    try {
        console.log(`[INFO] Processing download for: ${youtubeUrl}`);
        const timestamp = Math.floor(Date.now() / 1000).toString();
        
        // ==========================================
        // STEP 1: Initialize task
        // ==========================================
        const step1Url = 'https://audiocleaner.ai/audio/api/v1/youtube-to-mp3/task/create';
        const step1Res = await apiClient.post(step1Url, {
            input_url: youtubeUrl,
            uuid: uuidv4(),
            model_type: 2,
            show_yt403_dialog: "0"
        });
        console.log('[INFO] Step 1 completed:', step1Res.status);

        // ==========================================
        // STEP 2: Get video info & encrypted URLs
        // ==========================================
        const step2Url = 'https://vapi.extensiondock.com/api/youtube/v4/info';
        const step2Payload = { youtube_url: youtubeUrl, cgeo: "US" };
        const nonce2 = uuidv4();
        
        const step2Res = await apiClient.post(step2Url, step2Payload, {
            params: {
                app_id: 'ai_external',
                t: timestamp,
                nonce: nonce2,
                sign: generateSign(step2Payload, timestamp, nonce2),
                secret_key: generateSecretKey(step2Payload, timestamp, nonce2)
            }
        });

        if (step2Res.data.code !== 200) {
            throw new Error(`Step 2 Failed: ${step2Res.data.msg || 'Unknown error'}`);
        }

        // Find the best audio-only format
        const qualities = step2Res.data.data.quality || [];
        const targetQuality = qualities.find(q => q.is_audio === true) || qualities[0];

        if (!targetQuality || !targetQuality.url) {
            throw new Error('No downloadable quality found in response');
        }

        // ==========================================
        // STEP 3: Resolve encrypted URL to final link
        // ==========================================
        const step3Url = 'https://vapi.extensiondock.com/api/youtube/v4/download';
        const step3Payload = { url: targetQuality.url, quality: targetQuality.quality_label || "" };
        const timestamp3 = Math.floor(Date.now() / 1000).toString();
        const nonce3 = uuidv4();
        
        const step3Res = await apiClient.post(step3Url, step3Payload, {
            params: {
                app_id: 'ai_external',
                t: timestamp3,
                nonce: nonce3,
                sign: generateSign(step3Payload, timestamp3, nonce3),
                secret_key: generateSecretKey(step3Payload, timestamp3, nonce3)
            }
        });

        if (step3Res.data.code !== 200) {
            throw new Error(`Step 3 Failed: ${step3Res.data.msg || 'Unknown error'}`);
        }

        // ==========================================
        // FINAL RESPONSE
        // ==========================================
        res.json({
            success: true,
            data: {
                title: step2Res.data.data.title,
                video_id: step2Res.data.data.video_id,
                duration: step2Res.data.data.duration,
                download_url: step3Res.data.data
            }
        });

    } catch (error) {
        // Detailed logging to help you debug the exact failure point
        console.error('=== DOWNLOAD API ERROR ===');
        console.error('Message:', error.message);
        console.error('Status:', error.response?.status);
        console.error('Response Data:', error.response?.data);
        console.error('==========================');
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process the download', 
            details: error.response?.data?.msg || error.response?.data || error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`YouTube Downloader API running on http://localhost:${PORT}`);
});
