const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
require('dotenv').config(); 

const app = express();
const port = 3000;

// Configuration
const config = {
  youtubeUrl: process.env.YOUTUBE_URL || "https://youtu.be/KVrwGtV0cSo", // Fallback to example URL  
  segmentDuration: 10, // Segment duration 
  windowSize: 150, // Sliding window size
  ramPath: "/dev/shm", // Path to store DASH segments in RAM
};

// Ensure RAM directory exists
if (!fs.existsSync(config.ramPath)) {
  console.error(`RAM path ${config.ramPath} does not exist. Exiting.`);
  process.exit(1);
}

// Serve static files
app.use(express.static("public"));
app.use("/dash", express.static(config.ramPath)); // Serve DASH segments from RAM

function getYoutubeStreamUrl(youtubeUrl) {
  return new Promise((resolve, reject) => {
    const command = `yt-dlp -f best -g "${youtubeUrl}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("Error getting YouTube stream URL:", error);
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function startFFmpeg(streamUrl) {
  console.log("Starting FFmpeg process...");

  const ffmpegProcess = spawn("ffmpeg", [
    "-i",
    streamUrl,

    // Output for 720p
    "-map", "0:v:0",
    "-c:v:0", "libx264",
    "-b:v:0", "3000k",
    "-maxrate:v:0", "3500k",
    "-bufsize:v:0", "6000k",
    "-s:v:0", "1280x720",

    // Output for 480p
    "-map", "0:v:0",
    "-c:v:1", "libx264",
    "-b:v:1", "1500k",
    "-maxrate:v:1", "2000k",
    "-bufsize:v:1", "3000k",
    "-s:v:1", "854x480",

    // Audio
    "-map", "0:a:0",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",

    // DASH settings
    "-f", "dash",
    "-window_size", config.windowSize,
    "-remove_at_exit", "1",
    "-adaptation_sets", "id=0,streams=v id=1,streams=a",
    "-seg_duration", config.segmentDuration,
    "-use_template", "1",
    "-use_timeline", "1",
    "-init_seg_name", "init_$RepresentationID$.m4s",
    "-media_seg_name", "chunk_$RepresentationID$_$Number%05d$.m4s",
    path.join(config.ramPath, "manifest.mpd"), // Write DASH files to RAM
  ]);

  ffmpegProcess.stdout.on("data", (data) => {
    console.log(`FFmpeg stdout: ${data}`);
  });

  ffmpegProcess.stderr.on("data", (data) => {
    console.log(`FFmpeg stderr: ${data}`);
  });

  ffmpegProcess.on("error", (error) => {
    console.error("FFmpeg error:", error);
  });

  ffmpegProcess.on("close", (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    if (code !== 0) {
      console.log("Restarting FFmpeg...");
      getYoutubeStreamUrl(config.youtubeUrl).then((newStreamUrl) => {
        setTimeout(() => startFFmpeg(newStreamUrl), 5000);
      });
    }
  });

  return ffmpegProcess;
}

const playerHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>YouTube DASH Streaming Player</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.0/dash.all.min.js"></script>
    <style>
        .debug-info { margin-top: 20px; padding: 10px; background: #f0f0f0; }
    </style>
</head>
<body>
    <div>
        <video id="videoPlayer" controls style="width: 640px; height: 360px;"></video>
    </div>
    <div class="debug-info">
        <h3>Debug Information</h3>
        <div id="debugInfo"></div>
    </div>
    <script>
        (function() {
            var url = "dash/manifest.mpd";
            var player = dashjs.MediaPlayer().create();
            player.initialize(document.querySelector("#videoPlayer"), url, true);

            player.updateSettings({
                'streaming': {
                    'lowLatencyEnabled': true,
                    'liveDelay': 3,
                    'liveCatchup': {
                        'enabled': true,
                        'maxDrift': 0.5
                    }
                }
            });

            function updateDebugInfo() {
                var debugInfo = document.getElementById('debugInfo');
                var info = {
                    'Playback Rate': player.getPlaybackRate(),
                    'Buffer Length': player.getBufferLength() + ' seconds',
                    'Live Delay': player.getCurrentLiveLatency() + ' seconds',
                    'Video Width': player.getVideoWidth() + 'px',
                    'Video Height': player.getVideoHeight() + 'px'
                };
                var html = '';
                for (var key in info) {
                    if (info.hasOwnProperty(key)) {
                        html += '<p>' + key + ': ' + info[key] + '</p>';
                    }
                }
                debugInfo.innerHTML = html;
            }
            setInterval(updateDebugInfo, 1000);
        })();
    </script>
</body>
</html>
`;

// Write the player HTML file
fs.writeFileSync("./public/index.html", playerHtml);

// Start the server and FFmpeg process
function startServer() {
  getYoutubeStreamUrl(config.youtubeUrl)
    .then((streamUrl) => {
      console.log("Successfully obtained YouTube stream URL");

      const server = app.listen(port, () => {
        console.log(`Streaming server running at http://localhost:${port}`);
        console.log("Waiting for FFmpeg to generate DASH segments...");
      });

      const ffmpegProcess = startFFmpeg(streamUrl);

      // Handle cleanup on exit
      process.on("SIGINT", () => {
        console.log("Shutting down...");
        ffmpegProcess.kill();
        server.close();
        process.exit();
      });
    })
    .catch((error) => {
      console.error("Error starting server:", error);
      process.exit(1);
    });
}

startServer();
