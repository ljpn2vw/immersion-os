// ==UserScript==
// @name         Immersion OS - Mokuro Reader Tracker
// @namespace    http://tampermonkey.net/
// @version      4.0
// @match        https://reader.mokuro.app/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // --- UI DISPLAY TOGGLES ---
    const styleOptions = [
        { name: "🙈 Hide Characters", css: '#page-num p:nth-child(1) { display: none !important; }' },
        { name: "🌫️ Blur Characters (Hover to reveal)", css: '#page-num p:nth-child(1) { filter: blur(5px) !important; transition: 0.2s; } #page-num p:nth-child(1):hover { filter: blur(0px) !important; }' },
        { name: "👀 Show Everything", css: '' },
        { name: "👻 Hide Entire Button", css: '#page-num { opacity: 0 !important; pointer-events: none !important; }' }
    ];

    let currentStyleIdx = GM_getValue("ios_mokuro_style_idx", 0);

    function applyCSS() {
        let oldStyle = document.getElementById("ios-mokuro-style");
        if (oldStyle) oldStyle.remove();
        let s = document.createElement("style");
        s.id = "ios-mokuro-style";
        s.innerHTML = styleOptions[currentStyleIdx].css;
        document.head.appendChild(s);
    }
    applyCSS();

    GM_registerMenuCommand("🎨 Toggle Counter Display Mode", () => {
        currentStyleIdx = (currentStyleIdx + 1) % styleOptions.length;
        GM_setValue("ios_mokuro_style_idx", currentStyleIdx);
        applyCSS();
        // Give a little native alert so you know which mode you swapped to
        alert(`UI Mode changed to:\n${styleOptions[currentStyleIdx].name}`);
    });

    // --- TRACKING LOGIC ---
    let maxChars = 0;
    let maxPage = 0;
    let isFirstLoad = true; // Prevents the massive jump on page load!
    let lastPageText = "";

    const observer = new MutationObserver((mutations) => {
        const pageNumBtn = document.getElementById('page-num');
        if (!pageNumBtn) return;

        const pTags = pageNumBtn.querySelectorAll('p');
        if (pTags.length < 2) return;

        const charText = pTags[0].innerText;
        const pageText = pTags[1].innerText;

        if (pageText === lastPageText) return;

        const charMatch = charText.match(/(\d+)\s*\//);
        const pageMatch = pageText.match(/^([0-9,]+)\s*\//);

        if (charMatch && pageMatch) {
            const currentChar = parseInt(charMatch[1], 10);

            // Extract the highest page currently on screen (e.g., "80,81" -> 81)
            const pageNums = pageMatch[1].split(',').map(n => parseInt(n.trim(), 10));
            const currentPageMax = Math.max(...pageNums);

            if (currentChar > maxChars) {
                const charDelta = currentChar - maxChars;
                let pageDelta = 0;

                if (currentPageMax > maxPage) {
                    pageDelta = currentPageMax - maxPage;
                }

                if (isFirstLoad) {
                    // Silently absorb the current page as the baseline without sending it
                    console.log(`[Mokuro] Initial load absorbed. Baseline set to ${currentChar} chars, Page ${currentPageMax}.`);
                } else {
                    // Send exact deltas to Immersion OS
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: "http://localhost:55002/log-mokuro",
                        headers: { "Content-Type": "application/json" },
                        data: JSON.stringify({
                            app: "mokuro",
                            title: document.title,
                            chars: charDelta,
                            pages: pageDelta
                        }),
                        onload: function(res) {
                            if (res.status >= 200 && res.status < 300) {
                                console.log(`[Mokuro] Sent +${charDelta} chars, +${pageDelta} pages`);
                            }
                        }
                    });
                }

                // Update high scores
                maxChars = currentChar;
                if (currentPageMax > maxPage) maxPage = currentPageMax;
            }

            lastPageText = pageText;
            if (isFirstLoad) isFirstLoad = false;
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();