const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 7270;

// --- Configuration ---
const BASE_URL = "https://ytdl.lol";

const COOKIES = {
  csrftoken: "bltPTuaGWcwGqUXIMWbSxEsngQwUgFz0",
  dom3ic8zudi28v8lr6fgphwffqoz0j6c: "01a0fbe7-0d44-727c-a537-daf07d93b329%3A3%3A1"
};

// Format cookies into a single header string
const cookieString = Object.entries(COOKIES).map(([k, v]) => `${k}=${v}`).join('; ');

// Base headers shared across requests
const BASE_HEADERS = {
  "Host": "ytdl.lol",
  "Connection": "keep-alive",
  "sec-ch-ua-platform": "\"Android\"",
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; TECNO BG7 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Mobile Safari/537.36",
  "sec-ch-ua": "\"Android WebView\";v=\"153\", \"Not_A Brand\";v=\"8\", \"Chromium\";v=\"153\"",
  "sec-ch-ua-mobile": "?1",
  "Accept": "*/*",
  "Origin": "https://ytdl.lol",
  "X-Requested-With": "mark.via.gp",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Referer": "https://ytdl.lol/",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
  "Cookie": cookieString
};

// Helper function for polling delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- API Endpoint ---
app.get('/dl', async (req, res) => {
  const ytUrl = req.query.url;

  if (!ytUrl) {
    return res.status(400).json({ error: "Missing 'url' query parameter. Use ?url=<YT_URL>" });
  }

  try {
    // ==========================================
    // STEP 1: Initiate Download
    // ==========================================
    const form = new FormData();
    form.append('csrfmiddlewaretoken', 'S5DtMKyDICkKemK8hER5VPnX0PMMgrlATgW8v4y9uEGgu6xGTqSNijFa6v8wmWKq');
    form.append('yt_link', ytUrl);
    form.append('theme_val', '0');
    form.append('video_quality', 'medium');
    form.append('audio_quality', 'medium');
    form.append('action', 'video');

    // Merge base headers with CSRF token and dynamically generated Form headers (Content-Type + boundary)
    const initHeaders = {
      ...BASE_HEADERS,
      "X-CSRFToken": "S5DtMKyDICkKemK8hER5VPnX0PMMgrlATgW8v4y9uEGgu6xGTqSNijFa6v8wmWKq",
      ...form.getHeaders() 
    };

    const initResponse = await axios.post(`${BASE_URL}/initiate_download/`, form, {
      headers: initHeaders
    });

    const taskId = initResponse.data.task_id;
    if (!taskId) {
      throw new Error("Failed to get task_id from initiate request.");
    }

    // ==========================================
    // STEP 2: Poll for Task Status
    // ==========================================
    const statusUrl = `${BASE_URL}/task_status/${taskId}/`;
    const statusHeaders = { ...BASE_HEADERS }; // No need for CSRF or Form headers for GET
    const maxRetries = 60; // Timeout after 2 minutes (60 * 2s)

    for (let i = 0; i < maxRetries; i++) {
      const statusResponse = await axios.get(statusUrl, { headers: statusHeaders });
      const statusData = statusResponse.data;

      if (statusData.state === "SUCCESS") {
        return res.json({
          status: "success",
          task_id: taskId,
          metadata: statusData.result,
          // Note: Construct the actual download URL based on how the remote server serves files
          download_url_hint: `${BASE_URL}/download/${taskId}/` 
        });
      } else if (statusData.state === "FAILURE") {
        throw new Error("Download task failed on the remote server.");
      }

      // Wait 2 seconds before the next poll
      await sleep(2000);
    }

    throw new Error("Timeout: Video processing took too long.");

  } catch (error) {
    console.error("Error processing request:", error.message);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🚀 YT Downloader API is running on http://localhost:${PORT}`);
  console.log(`👉 Try it: http://localhost:${PORT}/dl?url=https://youtu.be/yamydvwqA_k`);
});
