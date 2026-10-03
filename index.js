const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 7270;
const BASE_URL = "https://ytdl.lol";

// Base headers 
// NOTE: "Accept-Encoding" is intentionally removed so axios can automatically 
// decompress gzip/deflate responses behind the scenes.
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
  "Accept-Language": "en-US,en;q=0.9"
};

// Helper function for polling delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to get a fresh session and CSRF token
async function getFreshSession() {
  const homeRes = await axios.get(BASE_URL, { headers: BASE_HEADERS });
  const setCookies = homeRes.headers['set-cookie'] || [];
  
  let csrfToken = null;
  let cookiesArray = [];

  // Extract all cookies and find the CSRF token
  for (const cookie of setCookies) {
    const keyValue = cookie.split(';')[0]; // e.g., csrftoken=abc123
    cookiesArray.push(keyValue);
    
    if (keyValue.startsWith('csrftoken=')) {
      csrfToken = keyValue.split('=')[1];
    }
  }

  // Fallback: If the token isn't in the cookies, try to extract it from the HTML body
  if (!csrfToken && homeRes.data) {
    const match = homeRes.data.match(/name="csrfmiddlewaretoken" value="([^"]+)"/);
    if (match) csrfToken = match[1];
  }

  if (!csrfToken) {
    throw new Error("Could not extract a fresh CSRF token from the homepage.");
  }

  return {
    csrfToken,
    cookieString: cookiesArray.join('; ')
  };
}

app.get('/dl', async (req, res) => {
  const ytUrl = req.query.url;

  if (!ytUrl) {
    return res.status(400).json({ error: "Missing 'url' query parameter. Use ?url=<YT_URL>" });
  }

  try {
    // ==========================================
    // STEP 0: Get Fresh Session & CSRF Token
    // ==========================================
    const { csrfToken, cookieString } = await getFreshSession();

    // ==========================================
    // STEP 1: Initiate Download
    // ==========================================
    const form = new FormData();
    form.append('csrfmiddlewaretoken', csrfToken);
    form.append('yt_link', ytUrl);
    form.append('theme_val', '0');
    form.append('video_quality', 'medium');
    form.append('audio_quality', 'medium');
    form.append('action', 'video');

    const initHeaders = {
      ...BASE_HEADERS,
      "X-CSRFToken": csrfToken,
      "Cookie": cookieString,
      ...form.getHeaders() 
    };

    const initResponse = await axios.post(`${BASE_URL}/initiate_download/`, form, {
      headers: initHeaders
    });

    const taskId = initResponse.data?.task_id;
    if (!taskId) {
      throw new Error(`Failed to get task_id. Server responded with: ${JSON.stringify(initResponse.data)}`);
    }

    // ==========================================
    // STEP 2: Poll for Task Status
    // ==========================================
    const statusUrl = `${BASE_URL}/task_status/${taskId}/`;
    const statusHeaders = { 
      ...BASE_HEADERS,
      "Cookie": cookieString // Keep the session alive for the GET request
    };
    
    const maxRetries = 60; // Timeout after ~2 minutes

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
    console.error("❌ Error processing request:", error.message);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`🚀 YT Downloader API is running on http://localhost:${PORT}`);
});
