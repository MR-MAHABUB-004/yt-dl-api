const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Helper Functions ---

/**
 * Extracts the 11-character video ID from various YouTube URL formats.
 */
function extractYoutubeId(url) {
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

/**
 * Executes the reverse-engineered dlsrv.online API flow.
 */
async function getDownloadLinks(videoId, formatType = "mp3", quality = "320") {
    // Create an axios instance to act as a session (persists headers)
    const session = axios.create({
        headers: {
            "User-Agent": "Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36",
            "sec-ch-ua-platform": "\"Android\"",
            "sec-ch-ua-mobile": "?1",
            "X-Requested-With": "mark.via.gq",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://embed.dlsrv.online",
            "Referer": `https://embed.dlsrv.online/v2/full?videoId=${videoId}`
        }
    });

    try {
        // 1. Fetch Challenge (Anti-bot)
        const challengeUrl = "https://check.dlsrv.online/30bb427100/challenge";
        await session.post(challengeUrl);

        // 2. Verify Token to get JWT
        // IMPORTANT: In a production environment, you must solve the 'instrumentation' 
        // payload from step 1 to generate a valid capToken.
        const capToken = "30bb427100:23c071092a584d4f:2179cba9d7b996d30f82c4212e6cc7";
        
        const verifyRes = await session.post("https://embed.dlsrv.online/api/verify", { 
            capToken 
        });
        
        const authToken = verifyRes.data.token;
        if (!authToken) {
            throw new Error("Failed to retrieve auth token. The capToken might have expired.");
        }

        // Update session headers with the new auth token
        session.defaults.headers.common["Authorization"] = `Bearer ${authToken}`;

        // 3. Touch Session
        await session.post("https://embed.dlsrv.online/api/session/touch", { 
            videoId 
        });

        // 4. Get Download URL
        const downloadEndpoint = formatType === "mp3" 
            ? "https://embed.dlsrv.online/api/download/mp3" 
            : "https://embed.dlsrv.online/api/download/mp4";
            
        const downloadRes = await session.post(downloadEndpoint, {
            videoId,
            format: formatType,
            quality
        });

        return downloadRes.data;

    } catch (error) {
        // Map errors to match the Python HTTPException behavior
        if (error.response) {
            const err = new Error(`Upstream API error: ${error.message}`);
            err.status = 502;
            throw err;
        } else {
            const err = new Error(error.message);
            err.status = 500;
            throw err;
        }
    }
}

// --- API Endpoints ---

app.get('/dl', async (req, res) => {
    try {
        const { url, format = 'mp3', quality = '320' } = req.query;

        if (!url) {
            return res.status(400).json({ error: "Missing 'url' query parameter." });
        }

        // 1. Validate and extract Video ID
        const videoId = extractYoutubeId(url);
        if (!videoId) {
            return res.status(400).json({ error: "Invalid YouTube URL. Could not extract Video ID." });
        }

        // 2. Fetch download data
        const result = await getDownloadLinks(videoId, format, quality);

        // 3. Return clean JSON response
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
        const statusCode = error.status || 500;
        res.status(statusCode).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({ message: "YouTube Downloader API is running. Use /dl?url=<youtube_url>" });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
