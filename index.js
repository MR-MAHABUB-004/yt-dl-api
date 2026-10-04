const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 7270;

// Configure axios with a 120-second (2 minute) timeout as requested
const apiClient = axios.create({
    timeout: 120000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36',
        'Origin': 'https://audiocleaner.ai',
        'Referer': 'https://audiocleaner.ai/'
    }
});

/**
 * TODO: REVERSE-ENGINEER THIS FUNCTION
 * Extract the actual algorithm from the Chrome Extension or Website's obfuscated JS.
 * It likely uses CryptoJS, WebCrypto API, or a custom HMAC hash combining the payload, timestamp, and nonce.
 */
function generateSign(payload, timestamp, nonce) {
    return 'PLACEHOLDER_SIGN_REPLACE_ME';
}

/**
 * TODO: REVERSE-ENGINEER THIS FUNCTION
 * Extract the actual algorithm from the Chrome Extension or Website's obfuscated JS.
 */
function generateSecretKey(payload, timestamp, nonce) {
    return 'PLACEHOLDER_SECRET_KEY_REPLACE_ME';
}

app.get('/api/dl', async (req, res) => {
    const { url: youtubeUrl } = req.query;

    if (!youtubeUrl) {
        return res.status(400).json({ error: 'YouTube URL is required. Usage: /api/dl?url=<youtube_url>' });
    }

    try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        
        // ==========================================
        // STEP 1: Initialize task on audiocleaner.ai
        // ==========================================
        const step1Url = 'https://audiocleaner.ai/audio/api/v1/youtube-to-mp3/task/create';
        await apiClient.post(step1Url, {
            input_url: youtubeUrl,
            uuid: uuidv4(),
            model_type: 2,
            show_yt403_dialog: "0"
        });

        // ==========================================
        // STEP 2: Get video info & encrypted URLs
        // ==========================================
        const step2Url = 'https://vapi.extensiondock.com/api/youtube/v4/info';
        const step2Payload = {
            youtube_url: youtubeUrl,
            cgeo: "BD" // Change to your preferred geo-code if needed
        };
        
        const nonce2 = uuidv4();
        const step2Response = await apiClient.post(step2Url, step2Payload, {
            params: {
                app_id: 'ai_external',
                t: timestamp,
                nonce: nonce2,
                sign: generateSign(step2Payload, timestamp, nonce2),
                secret_key: generateSecretKey(step2Payload, timestamp, nonce2)
            }
        });

        if (step2Response.data.code !== 200) {
            throw new Error(`Step 2 Failed: ${step2Response.data.msg}`);
        }

        // Find the best audio-only format (since the endpoint is youtube-to-mp3)
        const qualities = step2Response.data.data.quality || [];
        const targetQuality = qualities.find(q => q.is_audio === true) || qualities[0];

        if (!targetQuality || !targetQuality.url) {
            throw new Error('No downloadable quality found in response');
        }

        // ==========================================
        // STEP 3: Resolve encrypted URL to final download link
        // ==========================================
        const step3Url = 'https://vapi.extensiondock.com/api/youtube/v4/download';
        const step3Payload = {
            url: targetQuality.url,
            quality: targetQuality.quality_label || ""
        };

        const timestamp3 = Math.floor(Date.now() / 1000).toString();
        const nonce3 = uuidv4();
        
        const step3Response = await apiClient.post(step3Url, step3Payload, {
            params: {
                app_id: 'ai_external',
                t: timestamp3,
                nonce: nonce3,
                sign: generateSign(step3Payload, timestamp3, nonce3),
                secret_key: generateSecretKey(step3Payload, timestamp3, nonce3)
            }
        });

        if (step3Response.data.code !== 200) {
            throw new Error(`Step 3 Failed: ${step3Response.data.msg}`);
        }

        // ==========================================
        // FINAL RESPONSE TO USER
        // ==========================================
        res.json({
            success: true,
            data: {
                title: step2Response.data.data.title,
                video_id: step2Response.data.data.video_id,
                duration: step2Response.data.data.duration,
                download_url: step3Response.data.data // The final resolved URL
            }
        });

    } catch (error) {
        console.error('Download API Error:', error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to process the download', 
            details: error.response?.data?.msg || error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`YouTube Downloader API running on http://localhost:${PORT}`);
});
