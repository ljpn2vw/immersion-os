// ==UserScript==
// @name         Immersion OS - YouTube Tracker
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Defense-in-depth scraping, Offline Vault, TM Menu Commands, Instant State
// @match        *://*.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function() {
    'use strict';

    // --- SETTINGS & STATE ---
    const MIN_WATCH_SECONDS = 120; // Anything under this time will not be recorded

    // Read instant global states from Tampermonkey
    let state = {
        globalTracking: GM_getValue("ios_global_tracking", true),
        whitelistMode: GM_getValue("ios_whitelist_mode", false)
    };

    let playStartTime = 0;
    let accumulatedSeconds = 0;
    let isPlaying = false;
    let currentChannel = "Unknown Channel";
    let isOsOnline = false;

    // --- INSTANT STATE LISTENERS ---
    GM_addValueChangeListener("ios_global_tracking", function(name, old_val, new_val, remote) {
        state.globalTracking = new_val;
        updateButtonUI();
        if (!new_val) { accumulatedSeconds = 0; isPlaying = false; }
    });

    GM_addValueChangeListener("ios_whitelist_mode", function(name, old_val, new_val, remote) {
        state.whitelistMode = new_val;
        updateButtonUI();
    });

    // --- NATIVE TAMPERMONKEY MENU COMMANDS ---
    GM_registerMenuCommand("📦 Check Vault", function() {
        let vault = JSON.parse(localStorage.getItem('ios_yt_vault') || '{}');
        let channels = Object.keys(vault);

        if (channels.length === 0) {
            alert("📦 Vault is empty!\n\nEverything has been synced to Immersion OS.");
            return;
        }

        let msg = "📦 CURRENT VAULT STATUS\n" + (!isOsOnline ? "(Waiting for Immersion OS to come online)\n\n" : "(Online and syncing...)\n\n");
        let totalSec = 0;
        channels.forEach(ch => {
            msg += `• ${ch}: ${(vault[ch] / 60).toFixed(1)} mins\n`;
            totalSec += vault[ch];
        });
        msg += `\nTotal Pending: ${(totalSec / 60).toFixed(1)} minutes`;
        alert(msg);
    });

    GM_registerMenuCommand("🔄 Toggle Whitelist Mode", function() {
        let current = GM_getValue("ios_whitelist_mode", false);
        GM_setValue("ios_whitelist_mode", !current);
        alert(`🔄 Whitelist Mode is now: ${!current ? "ON" : "OFF"}\n\n(ON: Only explicitly added channels track.\nOFF: All channels track except blocked ones.)`);
    });

    GM_registerMenuCommand("⏯️ Toggle Global Tracking", function() {
        let current = GM_getValue("ios_global_tracking", true);
        GM_setValue("ios_global_tracking", !current);
    });

    // --- CSP-BYPASSING SERVER RADAR & VAULT LOGIC ---
    setInterval(() => {
        GM_xmlhttpRequest({
            method: "OPTIONS",
            url: "http://localhost:55002/log-yt",
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    if (!isOsOnline) { isOsOnline = true; flushVault(); }
                    isOsOnline = true; updateButtonUI();
                } else {
                    isOsOnline = false; updateButtonUI();
                }
            },
            onerror: function() {
                isOsOnline = false; updateButtonUI();
            }
        });
    }, 5000);

    function saveToVault(channel, seconds) {
        let vault = JSON.parse(localStorage.getItem('ios_yt_vault') || '{}');
        vault[channel] = (vault[channel] || 0) + seconds;
        localStorage.setItem('ios_yt_vault', JSON.stringify(vault));
        console.log(`[Immersion OS] 📦 Vaulted ${Math.round(seconds)}s for ${channel}`);
    }

    function flushVault() {
        let vault = JSON.parse(localStorage.getItem('ios_yt_vault') || '{}');
        let channels = Object.keys(vault);
        if (channels.length === 0) return;

        let payload = channels.map(c => ({ channel: c, seconds: vault[c] }));

        GM_xmlhttpRequest({
            method: "POST",
            url: "http://localhost:55002/log-yt",
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(payload),
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    localStorage.removeItem('ios_yt_vault');
                    console.log("[Immersion OS] Vault flushed successfully.");
                }
            }
        });
    }

    // --- SMART TRACKING LOGIC ---
    function isChannelTracked(channelName) {
        if (!state.globalTracking) return false;

        let listName = state.whitelistMode ? 'ios_whitelist' : 'ios_blacklist';
        let list = JSON.parse(localStorage.getItem(listName) || '[]');
        return state.whitelistMode ? list.includes(channelName) : !list.includes(channelName);
    }

    // --- BULLETPROOF CHANNEL SCRAPER ---
    function updateChannelName() {
        let domElem = document.querySelector("#upload-info .yt-formatted-string") ||
                      document.querySelector("ytd-page-header-renderer .ytd-channel-name");
        if (domElem && domElem.innerText && domElem.innerText.trim() !== "") {
            currentChannel = domElem.innerText.trim(); return;
        }

        try {
            if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails && window.ytInitialPlayerResponse.videoDetails.author) {
                currentChannel = window.ytInitialPlayerResponse.videoDetails.author; return;
            }
        } catch(e) {}

        let metaElem = document.querySelector('span[itemprop="author"] link[itemprop="name"]');
        if (metaElem && metaElem.getAttribute('content')) {
            currentChannel = metaElem.getAttribute('content').trim(); return;
        }
    }

    // --- OS DATA PUSHER ---
    function flushDataToOS() {
        if (isPlaying) {
            accumulatedSeconds += (Date.now() - playStartTime) / 1000;
            isPlaying = false;
        }

        if (!isChannelTracked(currentChannel) || accumulatedSeconds < MIN_WATCH_SECONDS) {
            accumulatedSeconds = 0; return;
        }

        saveToVault(currentChannel, accumulatedSeconds);
        if (isOsOnline) flushVault();
        accumulatedSeconds = 0;
    }

    // --- UI BUTTON INJECTOR ---
    function updateButtonUI() {
        let btn = document.getElementById('ios-blacklist-btn');
        if (!btn) return;

        if (!state.globalTracking) {
            btn.innerText = "🛑 Tracking PAUSED";
            btn.style.background = "#555"; btn.style.color = "#aaa";
            return;
        }

        let isTracked = isChannelTracked(currentChannel);
        let modeStr = state.whitelistMode ? "(WL)" : "(BL)";
        btn.innerText = (isTracked ? `✅ Tracking ${modeStr}` : `❌ Ignoring ${modeStr}`) + (!isOsOnline ? " ⚠️" : "");

        if (!isTracked) { btn.style.background = "#333"; btn.style.color = "#aaa"; }
        else if (!isOsOnline) { btn.style.background = "#ffaa00"; btn.style.color = "#000"; }
        else { btn.style.background = "#4cc9f0"; btn.style.color = "#000"; }
    }

    setInterval(() => {
        updateChannelName();

        let targetContainer = document.querySelector("#owner") || document.querySelector("#top-row") ||
                              document.querySelector("#buttons.ytd-page-header-renderer") || document.querySelector("#inner-header-container");

        if (targetContainer && currentChannel !== "Unknown Channel" && !document.getElementById('ios-blacklist-btn')) {
            let btn = document.createElement('button');
            btn.id = 'ios-blacklist-btn';
            btn.style.cssText = "margin-left: 15px; padding: 6px 14px; border: none; border-radius: 18px; font-weight: bold; cursor: pointer; font-size: 13px; font-family: 'Roboto', sans-serif; transition: 0.2s;";

            btn.onclick = () => {
                if (!state.globalTracking) return alert("Global Tracking is currently paused. Use the Tampermonkey menu to turn it back on.");

                let listName = state.whitelistMode ? 'ios_whitelist' : 'ios_blacklist';
                let list = JSON.parse(localStorage.getItem(listName) || '[]');

                if (list.includes(currentChannel)) list = list.filter(c => c !== currentChannel);
                else list.push(currentChannel);

                localStorage.setItem(listName, JSON.stringify(list));
                updateButtonUI();

                if (!isChannelTracked(currentChannel)) { accumulatedSeconds = 0; isPlaying = false; }
            };

            targetContainer.appendChild(btn);
            updateButtonUI();
        }
    }, 1500);

    // --- THE STOPWATCH ENGINE ---
    setInterval(() => {
        if (!window.location.pathname.startsWith('/watch') || !isChannelTracked(currentChannel)) return;

        let video = document.querySelector('video');
        if (video && !video.hasAttribute('data-ios-hooked')) {
            video.setAttribute('data-ios-hooked', 'true');

            if (!video.paused) { playStartTime = Date.now(); isPlaying = true; }

            video.addEventListener('play', () => {
                if (!isChannelTracked(currentChannel)) return;
                playStartTime = Date.now(); isPlaying = true;
            });

            video.addEventListener('pause', () => {
                if (isPlaying) {
                    accumulatedSeconds += (Date.now() - playStartTime) / 1000;
                    isPlaying = false;
                }
            });
        }
    }, 2000);

    window.addEventListener('yt-navigate-start', () => {
        flushDataToOS();
        let oldBtn = document.getElementById('ios-blacklist-btn');
        if (oldBtn) oldBtn.remove(); // Forces UI to redraw cleanly on next video
    });

    window.addEventListener('beforeunload', flushDataToOS);

})();