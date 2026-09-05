// HTML skeleton verbatim từ ref-item/playable-ads/OneClick_..._applovin.html — chỉ 5 điểm nội
// suy: <title>, extraHead (script riêng cho Google), downloadBody (hàm download() riêng từng
// network), base64Video, states/url (trong _states/_url của handlerLogic()). Phần còn lại
// (CSS, showVideo/handleSize/isTablet, máy trạng thái handlerLogic, eventClick) copy nguyên văn —
// không sửa tay logic timing.

const NETWORKS = {
  applovin: {
    extraHead: '',
    downloadBody:
      'console.log("IKAME: Download function called");\n\n' +
      '            if (window.mraid) {\n' +
      '                window.mraid.open(url);\n' +
      '            } else {\n' +
      '                window.open(url, "_blank");\n' +
      '            }',
  },
  unity: {
    extraHead: '',
    downloadBody:
      'console.log("IKAME: Download function called");\n\n' +
      '            if (window.mraid) {\n' +
      '                window.mraid.open(url);\n' +
      '            } else {\n' +
      '                window.open(url, "_blank");\n' +
      '            }',
  },
  google: {
    extraHead:
      '    <script type="text/javascript" src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"> </script>\n',
    downloadBody:
      'console.log("IKAME: Download function called");\n            ExitApi.exit();',
  },
  mintegral: {
    extraHead: '',
    downloadBody:
      'window.install && window.install()\n            window.gameEnd && window.gameEnd();',
  },
  moloco: {
    extraHead: '',
    downloadBody:
      'console.log("IKAME: Download function called");\n            FbPlayableAd.onCTAClick()',
  },
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtml({ title, url, states, base64Video, extraHead, downloadBody }) {
  return `<!DOCTYPE html>
<html>
<head>
    <meta name="ad.size" content="width=100%,height=100%">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true">
    <title>${escapeHtml(title)}</title>
    <style>
        body, html {
            padding: 0;
            margin: 0;
            height: 100%;
            overflow: hidden;
            background-color: #000;
        }
        video {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 100vw;
            height: 100vh;
            object-fit: cover;
            display: none;
            /* z-index: 1; */
        }
        .blur-background {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(1);
            filter: blur(25px);
            width: 100vw;
            height: 100vh;
            /* z-index: 0; */
            display: none;
        }

        #overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0);
            z-index: 9999;
        }
    </style>
${extraHead}    <script>
        // Network specific download logic
        function download(url) {
            ${downloadBody}
        }
    </script>

    <script>
        let mp4_portrait = "data:video/mp4;base64,${base64Video}";let currentOrientation = "";
    </script>
    <script>
        function isTablet() {
            const userAgent = navigator.userAgent.toLowerCase();
            const isTablet = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|(puffin(?!.*(IP|AP|WP))))/.test(userAgent);
            return isTablet;
        }

        function handleSize() {
            const video = document.getElementById('video');
            const bgVideo = document.getElementById('background-video');

            // Portrait
            if (window.innerWidth < window.innerHeight) {
                if (currentOrientation !== "portrait") {
                    currentOrientation = "portrait";

                    video.style.display = "initial";
                    bgVideo.style.display = "initial"; //none

                    if (isTablet()) {
                        video.style.width = "auto";
                        video.style.height = "100vh";
                    } else {
                        video.style.width = "100vw";
                        video.style.height = "auto";

                        bgVideo.style.width = "auto";
                        bgVideo.style.height = "100vh";
                    }
                }
            }
            else {
                if (currentOrientation !== "landscape") {
                    currentOrientation = "landscape";
                    video.style.display = "initial";
                    bgVideo.style.display = "initial";

                    video.style.width = "auto";
                    video.style.height = "100vh";

                    bgVideo.style.width = "100vw";
                    bgVideo.style.height = "auto";
                }
            }
        }

        function showVideo() {
            const video = document.getElementById('video');
            const bgVideo = document.getElementById('background-video');

            function safePlay(v) {
                try {
                    const p = v.play();
                    if (p && typeof p.catch === "function") {
                        p.catch(function() {
                            // Ignore autoplay/power-saver AbortError and similar play() rejections.
                        });
                    }
                } catch (e) {
                    // Ignore.
                }
            }

            video.src = mp4_portrait;
            bgVideo.src = mp4_portrait;

            video.load();
            safePlay(video);

            bgVideo.load();
            safePlay(bgVideo);

            if (!window.__BUILDER_PREVIEW__) {
                handlerLogic();
            } else {
                // In builder preview mode, avoid state-machine loops.
                video.loop = false;
                bgVideo.loop = false;
            }
        }

        const frameRate = 30;
        let state = 0;
        let totalFrames = 0
        let currentFrame = 0;

        window.addEventListener("change-state", function() {
            state++;
        });

        // @@BUILDER_HANDLER_START@@
        function handlerLogic() {
            var _v = document.getElementById('video');
            var _bg = document.getElementById('background-video');
          var _cursor = document.getElementById('builderCursor');
            // Disable native loop — state machine controls all looping.
            _v.loop = false;
            _bg.loop = false;
            var _states = ${JSON.stringify(states, null, 4)};
            var _url = ${JSON.stringify(url || '')};
            var _idx = 0;
            var _unlocked = false;
            var _thr = 1 / 30;
            var _pauseDone = _states.map(function () { return false; });
          function _clamp(n, lo, hi) {
            n = Number(n);
            if (!isFinite(n)) return lo;
            return Math.min(Math.max(n, lo), hi);
          }
          function _applyCursor() {
            if (!_cursor || !_v) return;
            var c = _states[_idx];
            if (!c || !c.cursorOn) { _cursor.style.display = 'none'; return; }
            var rect = _v.getBoundingClientRect();
            if (!rect || !rect.width || !rect.height) { _cursor.style.display = 'none'; return; }

            var xPct = _clamp(c.cursorX, 0, 100);
            var yPct = _clamp(c.cursorY, 0, 100);
            var x = rect.left + (xPct / 100) * rect.width;
            var y = rect.top + (yPct / 100) * rect.height;
            var sc = _clamp(c.cursorScale, 10, 300) / 100;
            _cursor.style.display = 'block';
            _cursor.style.left = x + 'px';
            _cursor.style.top = y + 'px';
            _cursor.style.transform = 'translate(-50%, -50%) scale(' + sc + ')';
          }
            function _open() {
                if (!_url) return;
                download(_url);
            }
            window.__bClick = function () {
                var c = _states[_idx];
                if (!c) return;
                // exitOnClick: skip to the next state immediately.
                if (c.exitOnClick && _idx < _states.length - 1) {
                    _idx++;
                    _unlocked = false;
                    state = _idx + 1;
                    _v.currentTime = _bg.currentTime = _states[_idx].start;
                    if (_states[_idx].openOnEnter) _open();
              _applyCursor();
                // If we were paused (e.g. pauseBeforeExit), resume on user gesture.
                try { if (_v && _v.paused) _v.play(); } catch (e) {}
                try { if (_bg && _bg.paused) _bg.play(); } catch (e) {}
                    return;
                }
                if (c.openOnClick) _open();
                // Unlock a looping state so it can advance to the next state after
                // the current loop iteration finishes naturally.
                if (c.loop && !_unlocked && _idx < _states.length - 1) _unlocked = true;
            };
            _v.addEventListener('loadedmetadata', function () {
                state = 1;
                if (_states.length && _states[0].openOnEnter) _open();
            _applyCursor();
                requestAnimationFrame(_tick);
            });
            try { window.addEventListener('resize', _applyCursor); } catch (e) {}
            function _tick() {
                var t = _v.currentTime;
                var c = _states[_idx];
                if (c) {
                if (c.pauseBeforeExit && !_pauseDone[_idx]) {
                  if (t >= c.end - _thr) {
                    _pauseDone[_idx] = true;
                    var last = Math.max(c.start, c.end - _thr);
                    try { _v.pause(); } catch (e) {}
                    try { _bg.pause(); } catch (e) {}
                    _v.currentTime = _bg.currentTime = last;
                    _applyCursor();
                    requestAnimationFrame(_tick);
                    return;
                  }
                }
                    if (c.loop && !_unlocked) {
                        // Loop back to state start.
                        if (t >= c.end - _thr) { _v.currentTime = _bg.currentTime = c.start; }
                    } else if (_idx < _states.length - 1 && t >= c.end - _thr) {
                        // Advance to next state.
                        _idx++;
                        _unlocked = false;
                        state = _idx + 1;
                        if (_states[_idx].openOnEnter) _open();
                _applyCursor();
                    }
                }
                requestAnimationFrame(_tick);
            }
        }
        // @@BUILDER_HANDLER_END@@

        window.onresize = function(event) {
            handleSize();
        };

        window.onload = function() {
            handleSize();
            showVideo();
        };
    </script>
    <script>
        // @@BUILDER_CLICK_START@@
        function eventClick(event) {
            if (window.__bClick) window.__bClick();
        }
        // @@BUILDER_CLICK_END@@
    </script>
</head>
<body>
    <video id="background-video" class="blur-background" muted autoplay playsinline loop></video>
    <video id="video" playsinline autoplay muted loop></video>
    <div id="overlay" ontouchstart="eventClick(event)" onmousedown="eventClick(event)"></div>
</body>
</html>`;
}

module.exports = { NETWORKS, buildHtml, escapeHtml };
