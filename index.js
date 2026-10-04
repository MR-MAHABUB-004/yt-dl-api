const express = require('express');
const ytdl = require('ytdl-core');
const app = express();

app.get('/api/dl', async (req, res) => {
    const url = req.query.url;
    if (!ytdl.validateURL(url)) {
        return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
    }

    try {
        const info = await ytdl.getInfo(url);
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
        
        res.json({
            success: true,
            data: {
                title: info.videoDetails.title,
                video_id: info.videoDetails.videoId,
                duration: info.videoDetails.lengthSeconds,
                download_url: format.url // Direct, unencrypted download link
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(7270, () => console.log('Server running on port 7270'));
