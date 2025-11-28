// ==UserScript==
// @name         Twitter/X Glass Great Wall
// @namespace    https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute
// @version      1.2.4
// @description  Auto-Mute CCP troll X (Twitter) accounts. 自动屏蔽 X (Twitter) 五毛账号。
// @author       OpenSource
// @match        https://x.com/*
// @match        https://twitter.com/*
// @connect      basedinchina.com
// @connect      archive.org
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @license      MIT
// @run-at       document-idle
// @homepageURL  https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute
// @supportURL   https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute/issues
// ==/UserScript==

(function() {
    'use strict';

    /**
     * 配置模块
     */
    class Config {
        static get TWITTER() {
            return {
                BEARER_TOKEN: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                API_MUTE_LIST: 'https://x.com/i/api/1.1/mutes/users/list.json',
                API_MUTE_CREATE: 'https://x.com/i/api/1.1/mutes/users/create.json',
            };
        }

        static get REMOTE_SOURCES() {
            return {
                FULL_LIST: "https://basedinchina.com/api/users/all",
                SECOND_LIST: "https://raw.githubusercontent.com/pluto0x0/X_based_china/main/china.jsonl"
            };
        }

        static get CACHE_KEYS() {
            return {
                LOCAL_MUTES: "gw_local_mutes_list",      // 完整列表
                LOCAL_MUTES_HEAD: "gw_local_mutes_head", // 头部指纹
                TEMP_CURSOR: "gw_temp_cursor",           // 断点游标
                TEMP_LIST: "gw_temp_list",               // 断点临时名单
                TEMP_TIME: "gw_temp_time",               // 断点时间戳
                PANEL_COLLAPSED: "gw_panel_collapsed"    // 面板状态
            };
        }

        static get DELAY() {
            return { MIN: 100, MAX: 1000 };
        }

        static get UI() {
            return {
                PANEL_ID: "gw-panel",
                LOG_ID: "gw-logs",
                BAR_ID: "gw-bar",
                TXT_ID: "gw-pct-txt",
                BTN_START_ID: "gw-btn",
                BTN_CLEAR_ID: "gw-btn-clear",
                TOGGLE_ID: "gw-toggle-btn",
                BODY_ID: "gw-content-body"
            };
        }
    }

    /**
     * 工具模块
     */
    class Utils {
        static shuffleArray(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }

        static getCsrfToken() {
            const match = document.cookie.match(/(^|;\s*)ct0=([^;]*)/);
            return match ? match[2] : null;
        }

        static sleep(ms) {
            return new Promise(r => setTimeout(r, ms));
        }

        static getRandomDelay() {
            return Math.floor(Math.random() * (Config.DELAY.MAX - Config.DELAY.MIN + 1) + Config.DELAY.MIN);
        }

        static getTimeString() {
            return new Date().toLocaleTimeString('en-GB', { hour12: false });
        }
    }

    /**
     * 存储管理模块 (Wrapper for GM_ functions)
     */
    class Storage {
        static get(key, defaultValue = null) {
            return GM_getValue(key, defaultValue);
        }

        static set(key, value) {
            GM_setValue(key, value);
        }

        static delete(key) {
            GM_deleteValue(key);
        }

        static clearCache() {
            const keys = Config.CACHE_KEYS;
            Storage.delete(keys.LOCAL_MUTES);
            Storage.delete(keys.LOCAL_MUTES_HEAD);
            Storage.delete(keys.TEMP_CURSOR);
            Storage.delete(keys.TEMP_LIST);
            Storage.delete(keys.TEMP_TIME);
            Storage.delete(keys.PANEL_COLLAPSED);
        }
    }

    /**
     * UI 管理模块
     */
    class UserInterface {
        constructor(coreDelegate) {
            this.core = coreDelegate; // 引用核心逻辑用于绑定事件
            this.isCollapsed = Storage.get(Config.CACHE_KEYS.PANEL_COLLAPSED, false);
        }

        init() {
            if (document.getElementById(Config.UI.PANEL_ID)) return;
            this.render();
            this.bindEvents();
        }

        render() {
            const panel = document.createElement('div');
            panel.id = Config.UI.PANEL_ID;
            
            // 样式设置
            Object.assign(panel.style, {
                position: "fixed",
                bottom: "5px",
                left: "0px",
                margin: "0px",
                zIndex: "99999",
                background: "rgba(0, 0, 0, 0.95)", color: "#fff", padding: "10px", borderRadius: "8px",
                width: "184px",
                fontSize: "12px", border: "1px solid #444", fontFamily: "monospace",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                boxSizing: "content-box"
            });

            const version = GM_info.script.version;
            const toggleIcon = this.isCollapsed ? "➕" : "➖";
            const displayStyle = this.isCollapsed ? "none" : "block";

            panel.innerHTML = `
                <div style="border-bottom:1px solid #444;margin-bottom:8px;padding-bottom:5px;display:flex;justify-content:space-between;align-items:center;user-select:none;">
                    <span style="font-weight:bold;color:#e0245e;">GlassWall v${version}</span>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <span id="${Config.UI.TXT_ID}" style="color:#aaa;font-size:10px;">Ready</span>
                        <span id="${Config.UI.TOGGLE_ID}" style="cursor:pointer;color:#6abbff;font-weight:bold;padding:0 4px;">${toggleIcon}</span>
                    </div>
                </div>
                
                <div id="${Config.UI.BODY_ID}" style="display:${displayStyle}">
                    <div id="${Config.UI.LOG_ID}" style="height:400px;overflow-y:auto;color:#ccc;margin-bottom:8px;font-size:11px;background:#111;padding:6px;border:1px solid #333;white-space:pre-wrap;">等待指令...\n--------------------\n<a href="https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute" target="_blank" style="color:#6abbff;text-decoration:none;">🔗 GitHub Repo</a>\nBy <a href="https://x.com/trailblaziger" target="_blank" style="color:#6abbff;text-decoration:none;">@trailblaziger</a></div>
                    <div style="background:#333;height:6px;margin-bottom:8px;border-radius:3px;overflow:hidden">
                        <div id="${Config.UI.BAR_ID}" style="width:0%;background:#e0245e;height:100%;transition:width 0.2s"></div>
                    </div>
                    <div style="display:flex;gap:5px">
                        <button id="${Config.UI.BTN_START_ID}" style="flex:1;display:flex;justify-content:center;align-items:center;background:#e0245e;color:white;border:none;padding:8px;cursor:pointer;font-weight:bold;border-radius:4px;">开始处理</button>
                        <button id="${Config.UI.BTN_CLEAR_ID}" style="flex:0.6;display:flex;justify-content:center;align-items:center;background:#555;color:white;border:none;padding:8px;cursor:pointer;border-radius:4px;">清除缓存</button>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);
        }

        bindEvents() {
            // 开始按钮
            document.getElementById(Config.UI.BTN_START_ID).onclick = () => this.core.startProcess();
            // 清除缓存按钮
            document.getElementById(Config.UI.BTN_CLEAR_ID).onclick = () => this.core.clearCache();
            // 折叠按钮
            document.getElementById(Config.UI.TOGGLE_ID).onclick = () => this.togglePanel();
        }

        togglePanel() {
            const body = document.getElementById(Config.UI.BODY_ID);
            const btn = document.getElementById(Config.UI.TOGGLE_ID);
            const isNowCollapsed = body.style.display !== "none"; 
            
            if (isNowCollapsed) {
                body.style.display = "none";
                btn.innerText = "➕";
                Storage.set(Config.CACHE_KEYS.PANEL_COLLAPSED, true);
            } else {
                body.style.display = "block";
                btn.innerText = "➖";
                Storage.set(Config.CACHE_KEYS.PANEL_COLLAPSED, false);
            }
        }

        log(text, isError = false) {
            const el = document.getElementById(Config.UI.LOG_ID);
            if(el) {
                const time = Utils.getTimeString();
                const color = isError ? "#ff5555" : "#cccccc";
                el.innerHTML = `<div style="color:${color}"><span style="color:#666">[${time}]</span> ${text}</div>` + el.innerHTML;
            }
        }

        updateProgress(percent, text) {
            const bar = document.getElementById(Config.UI.BAR_ID);
            const txt = document.getElementById(Config.UI.TXT_ID);
            if(bar) bar.style.width = `${percent}%`;
            if(txt && text) txt.innerText = text;
        }

        setButtonDisabled(disabled) {
            const btn = document.getElementById(Config.UI.BTN_START_ID);
            if(btn) btn.disabled = disabled;
        }
    }

    /**
     * Twitter API 交互模块
     */
    class TwitterApi {
        constructor(logger) {
            this.logger = logger;
        }

        getHeaders(csrf) {
            return {
                'authorization': Config.TWITTER.BEARER_TOKEN,
                'x-csrf-token': csrf
            };
        }

        // 校验/获取本地屏蔽列表头部
        async fetchMuteListHead(csrf) {
            const url = `${Config.TWITTER.API_MUTE_LIST}?include_entities=false&skip_status=true&count=100&cursor=-1`;
            const res = await fetch(url, { headers: this.getHeaders(csrf) });
            if (res.ok) {
                const json = await res.json();
                return json.users ? json.users.map(u => u.screen_name.toLowerCase()) : [];
            }
            throw new Error(`HTTP ${res.status}`);
        }

        async fetchFullMuteList(csrf, initialPageData, progressCallback) {
            const set = new Set();
            const keys = Config.CACHE_KEYS;

            // 1. 读取断点
            const savedCursor = Storage.get(keys.TEMP_CURSOR, null);
            const savedList = Storage.get(keys.TEMP_LIST, []);
            const savedTime = Storage.get(keys.TEMP_TIME, 0);

            let cursor = -1;
            let isFirstPage = true;
            const isResumeValid = (Date.now() - savedTime) < 864000000; // 240h

            if (savedCursor && savedCursor !== "0" && savedCursor !== 0 && savedList.length > 0) {
                if (isResumeValid) {
                    this.logger.log(`📂 检测到上次中断的进度 (${new Date(savedTime).toLocaleString()})`);
                    this.logger.log(`⏩ 续传模式: 跳过前 ${savedList.length} 人，继续拉取...`);
                    cursor = savedCursor;
                    savedList.forEach(u => set.add(u));
                    isFirstPage = false;
                } else {
                    this.logger.log(`🗑️ 缓存已过期 (>240h)，将重新拉取。`);
                    Storage.delete(keys.TEMP_CURSOR);
                    Storage.delete(keys.TEMP_LIST);
                    Storage.delete(keys.TEMP_TIME);
                }
            }

            while (true) {
                try {
                    let json;
                    
                    if (isFirstPage && initialPageData && cursor === -1) {
                        json = { users: initialPageData.users, next_cursor_str: initialPageData.next_cursor_str };
                        isFirstPage = false;
                        this.logger.log(`⚡ 使用预加载数据 (Page 1)`);
                    } else {
                        const url = `${Config.TWITTER.API_MUTE_LIST}?include_entities=false&skip_status=true&count=100&cursor=${cursor}`;
                        const res = await fetch(url, { headers: this.getHeaders(csrf) });
                        
                        if (res.status === 429) {
                            this.logger.log(`⛔ 触发 API 速率限制 (429)！`, true);
                            this.logger.log(`💾 进度已自动保存 (已获取 ${set.size} 人)。`, true);
                            this.logger.log(`⏳ 请等待 15 分钟后刷新页面重新运行，将自动继续。`, true);
                            throw new Error("RATE_LIMIT_EXIT");
                        }
                        
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        json = await res.json();
                    }

                    // 处理数据
                    if (json.users && Array.isArray(json.users)) {
                        json.users.forEach(u => set.add(u.screen_name.toLowerCase()));
                    }

                    cursor = json.next_cursor_str;
                    
                    // 保存断点
                    Storage.set(keys.TEMP_CURSOR, cursor);
                    Storage.set(keys.TEMP_LIST, Array.from(set));
                    Storage.set(keys.TEMP_TIME, Date.now());

                    if (progressCallback) progressCallback(set.size);

                    if (cursor === "0" || cursor === 0) {
                        Storage.delete(keys.TEMP_CURSOR);
                        Storage.delete(keys.TEMP_LIST);
                        Storage.delete(keys.TEMP_TIME);
                        break;
                    }
                    
                    await Utils.sleep(200);

                } catch (e) {
                    if (e.message === "RATE_LIMIT_EXIT") throw e;
                    this.logger.log(`⚠️ 拉取中断: ${e.message}`, true);
                    break;
                }
            }
            return set;
        }

        // 执行 Mute 操作
        async muteUser(user, csrf) {
            const params = new URLSearchParams();
            params.append('screen_name', user);
            
            return fetch(Config.TWITTER.API_MUTE_CREATE, {
                method: 'POST',
                headers: {
                    ...this.getHeaders(csrf),
                    'content-type': 'application/x-www-form-urlencoded'
                },
                body: params
            });
        }
    }

    /**
     * 外部数据源模块
     */
    class ExternalSource {
        constructor(logger) {
            this.logger = logger;
        }

        async _fetch(url) {
            return new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: "GET", url: url, timeout: 30000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "application/json, text/plain, */*",
                        "Referer": "https://basedinchina.com/"
                    },
                    onload: r => resolve(r.status === 200 ? r.responseText : null),
                    onerror: e => { this.logger.log(`❌ 网络错误: ${e.error}`, true); resolve(null); },
                    ontimeout: () => { this.logger.log(`❌ 请求超时`, true); resolve(null); }
                });
            });
        }

        // 获取全量名单
        async fetchAll() {
            this.logger.log("🕸️ 正在从 2 个数据源获取五毛名单...");
            const all = new Set();
            
            const [data1, data2] = await Promise.all([
                this._fetch(Config.REMOTE_SOURCES.FULL_LIST),
                this._fetch(Config.REMOTE_SOURCES.SECOND_LIST)
            ]);

            // Source 1
            if (data1) {
                try {
                    const json = JSON.parse(data1);
                    if (json.users) json.users.forEach(u => u.userName && all.add(u.userName));
                } catch (e) { this.logger.log(`❌ [来源1] 解析失败`, true); }
            }

            // Source 2
            if (data2) {
                try {
                    data2.trim().split('\n').forEach(line => {
                        if(!line) return;
                        try {
                            const d = JSON.parse(line);
                            if(d.username) all.add(d.username);
                        } catch(err){}
                    });
                } catch (e) { this.logger.log(`❌ [来源2] 解析失败`, true); }
            }
            return all;
        }
    }

    /**
     * 核心业务逻辑 (Main Controller)
     */
    class Core {
        constructor() {
            this.ui = new UserInterface(this);
            this.api = new TwitterApi(this.ui);
            this.source = new ExternalSource(this.ui);
            
            // 启动 UI
            setInterval(() => this.ui.init(), 1000);
            GM_registerMenuCommand("打开面板", () => this.ui.init());
        }

        async clearCache() {
            this.ui.log("🧹 正在清除所有本地缓存...");
            Storage.clearCache();
            this.ui.log("✅ 缓存已清除！页面将在 2 秒后刷新。");
            setTimeout(() => window.location.reload(), 2000);
        }

        async saveToCache(set) {
            const fullList = Array.from(set);
            const newHeadList = fullList.slice(0, 100);
            Storage.set(Config.CACHE_KEYS.LOCAL_MUTES, fullList);
            Storage.set(Config.CACHE_KEYS.LOCAL_MUTES_HEAD, JSON.stringify(newHeadList));
            this.ui.log(`💾 ${set.size} 人`);
        }

        async startProcess() {
            this.ui.setButtonDisabled(true);
            const csrf = Utils.getCsrfToken();

            if (!csrf) {
                this.ui.log("❌ 无法获取 CSRF Token，请刷新页面。", true);
                this.ui.setButtonDisabled(false);
                return;
            }

            try {
                // 1. 获取已屏蔽列表 (缓存校验)
                const localMuted = await this._getLocalMutes(csrf);
                this.ui.log(`✅ 已屏蔽名单读取完毕: 共 ${localMuted.size} 人`);

                // 2. 获取五毛列表
                const wumaoUsers = await this.source.fetchAll();
                if (wumaoUsers.size === 0) throw new Error("未获取任何数据，请检查网络或 API");
                this.ui.log(`✅ 五毛名单下载完毕: 共 ${wumaoUsers.size} 人`);

                // 3. 过滤
                this.ui.log("⚙️ 正在比对数据...");
                const todoList = [];
                let skipped = 0;
                wumaoUsers.forEach(u => {
                    if (localMuted.has(u.toLowerCase())) skipped++;
                    else todoList.push(u);
                });

                this.ui.log(`🧹 过滤完成: 跳过 ${skipped} 人 (已存在)`);
                this.ui.log(`🎯 实际待处理: ${todoList.length} 人`);

                if (todoList.length === 0) {
                    this.ui.log("🎉 你的屏蔽列表已是最新，无需操作！");
                    alert("所有目标均已在你的屏蔽列表中。");
                    this.ui.updateProgress(100, "无需操作");
                    this.ui.setButtonDisabled(false);
                    return;
                }

                Utils.shuffleArray(todoList);
                this.ui.log("🎲 已将待处理列表随机打乱");
                this.ui.log(`🚀 正在自动启动处理... 共 ${todoList.length} 个目标`);

                // 4. 执行
                await this._executeSerialMute(todoList, csrf, localMuted);

            } catch (e) {
                this.ui.log(`❌ 发生异常: ${e.message}`, true);
                console.error(e);
                this.ui.setButtonDisabled(false);
            }
        }

        async _getLocalMutes(csrf) {
            this.ui.log("🔎 正在校验已屏蔽列表缓存...");

            // 1. 获取最新屏蔽列表头部 (API)
            let liveHeadUsernames = [];
            try {
                liveHeadUsernames = await this.api.fetchMuteListHead(csrf);
            } catch (e) {
                if (e.message && e.message.includes("429")) {
                    this.ui.log(`⛔ API 速率限制 (429)！`, true);
                    this.ui.log(`⏳ 校验失败。请等待 15 分钟限制解除后刷新重试。`, true);
                    throw new Error("RATE_LIMIT_EXIT");
                }
                throw new Error("无法校验缓存: " + e.message);
            }

            // 2. 指纹校验 -> (断点续传 或 直接返回) 或 (重新缓存)
            const cachedHeadJson = Storage.get(Config.CACHE_KEYS.LOCAL_MUTES_HEAD, "[]");
            const cachedHeadSet = new Set(JSON.parse(cachedHeadJson));
            const liveHeadSet = new Set(liveHeadUsernames);

            const isCacheReliable = cachedHeadSet.size === liveHeadSet.size && [...cachedHeadSet].every(user => liveHeadSet.has(user));

            // --- 分支 A: 缓存指纹可靠 ---
            if (isCacheReliable) {
                // A1. 检查是否存在断点 (TEMP_CURSOR)
                const savedCursor = Storage.get(Config.CACHE_KEYS.TEMP_CURSOR);
                if (savedCursor && savedCursor !== "0" && savedCursor !== 0) {
                    this.ui.log("⚠️ 检测到中断任务。正在断点续传...");
                    // 内部会自动读取 Cursor 并合并 TEMP_LIST
                    const fullSet = await this.api.fetchFullMuteList(csrf, null, 
                        (count) => this.ui.updateProgress(0, `📥 续传中: ${count} 人`)
                    );
                    await this.saveToCache(fullSet);
                    return fullSet;
                } 
                
                // A2. 如果指纹匹配，且没有断点，说明本地缓存完整且有效
                const cachedList = Storage.get(Config.CACHE_KEYS.LOCAL_MUTES, null);
                if (cachedList) {
                    this.ui.log(`✅ 缓存校验通过，从本地加载 ${cachedList.length} 人。`);
                    return new Set(cachedList);
                }
            } 
            
            // --- 分支 B: 缓存指纹不可靠，说明缓存过期或无缓存 ---
            this.ui.log("⚠️ 缓存指纹不匹配或缓存已过期。正在清除所有旧缓存并重新拉取...");
            Storage.clearCache();

            // 3. 执行全量拉取 (Fresh Start)

            // 用刚才获取的 head 数据作第一页，节省一次 API 请求
            const initialPageUsers = liveHeadUsernames.map(screen_name => ({ screen_name }));
            
            const fullSet = await this.api.fetchFullMuteList(csrf, 
                { users: initialPageUsers, next_cursor_str: "PLACEHOLDER" },
                (count) => this.ui.updateProgress(0, `📥 同步中: ${count} 人`)
            );
            
            await this.saveToCache(fullSet);
            return fullSet;
        }

        async _executeSerialMute(list, csrf, localMutedSet) {
            let success = 0;
            let fail = 0;
            const orderedCacheList = Array.from(localMutedSet);
            
            for(let i=0; i<list.length; i++) {
                const user = list[i];
                const pct = ((i+1) / list.length) * 100;
                this.ui.updateProgress(pct, `${Math.floor(pct)}% (${i+1}/${list.length})`);
                
                try {
                    const res = await this.api.muteUser(user, csrf);
                    if(res.ok) {
                        success++;
                        
                        const lowerUser = user.toLowerCase();
                        
                        orderedCacheList.unshift(lowerUser);
                        localMutedSet.add(lowerUser);
                        await this.saveToCache(new Set(orderedCacheList)); // 实时保存
                        
                        if(success % 10 === 0) this.ui.log(`${i+1}/${list.length}\n成功: ${success} | 失败: ${fail}`);
                    } else {
                        fail++;
                        this.ui.log(`❌ 失败 @${user}: HTTP ${res.status}`, true);
                        if(res.status === 429) {
                            this.ui.log("⛔ 触发风控 (429)，暂停 3 分钟...", true);
                            await Utils.sleep(180000);
                        }
                    }

                } catch(err) {
                    fail++;
                    this.ui.log(`❌ 网络错误 @${user}: ${err.message}`, true);
                }

                // 随机延时
                await Utils.sleep(Utils.getRandomDelay());
            }

            this.ui.updateProgress(100, "Done");
            this.ui.log(`🏁 全部完成! 成功: ${success}, 失败: ${fail}`);
            alert(`处理完毕！\n成功: ${success}\n失败: ${fail}`);
            this.ui.setButtonDisabled(false);
        }
    }

    // --- 初始化脚本 ---
    new Core();

})();
