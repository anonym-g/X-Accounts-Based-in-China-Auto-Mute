// ==UserScript==
// @name         Twitter/X Glass Great Wall
// @namespace    https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute
// @version      1.2.1
// @description  获取五毛名单 + 过滤已屏蔽 + 串行拉黑 (显示错误码)
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

    // --- 1. 全局配置与常量 (Constants) ---
    const CONSTANTS = {
        // API 相关
        TWITTER: {
            BEARER_TOKEN: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            API_MUTE_LIST: 'https://x.com/i/api/1.1/mutes/users/list.json',
            API_MUTE_CREATE: 'https://x.com/i/api/1.1/mutes/users/create.json',
        },
        // 外部名单源
        REMOTE_SOURCES: {
            FULL_LIST: "https://basedinchina.com/api/users/all",
            SECOND_LIST: "https://raw.githubusercontent.com/pluto0x0/X_based_china/main/china.jsonl"
        },
        // 缓存键值 (Cache Keys)
        CACHE: {
            LOCAL_MUTES: "gw_local_mutes_list",      // 完整列表
            LOCAL_MUTES_HEAD: "gw_local_mutes_head", // 头部指纹
        },
        // Mute 设置 (毫秒)
        DELAY: {
            MIN: 100,
            MAX: 1000
        },
        UI: {
            PANEL_ID: "gw-panel",
            LOG_ID: "gw-logs",
            BAR_ID: "gw-bar",
            TXT_ID: "gw-pct-txt",
            BTN_START_ID: "gw-btn",
            BTN_CLEAR_ID: "gw-btn-clear"
        }
    };

    // --- 2. 基础工具模块 (Utils) ---
    const Utils = {
        // Fisher-Yates Shuffle 算法
        shuffleArray: (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        },

        // 获取 CSRF Token
        getCsrfToken: () => {
            const match = document.cookie.match(/(^|;\s*)ct0=([^;]*)/);
            return match ? match[2] : null;
        },

        // 异步等待
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),

        // 生成随机延时
        getRandomDelay: () => {
            return Math.floor(Math.random() * (CONSTANTS.DELAY.MAX - CONSTANTS.DELAY.MIN + 1) + CONSTANTS.DELAY.MIN);
        }
    };

    // --- 3. UI 界面管理模块 (UIManager) ---
    const UIManager = {
        // 创建或显示面板
        createPanel: () => {
            if (document.getElementById(CONSTANTS.UI.PANEL_ID)) return;
            
            const panel = document.createElement('div');
            panel.id = CONSTANTS.UI.PANEL_ID;
            
            Object.assign(panel.style, {
                position: "fixed", bottom: "20px", left: "20px", zIndex: "99999",
                background: "rgba(0, 0, 0, 0.95)", color: "#fff", padding: "15px", borderRadius: "8px",
                width: "350px", fontSize: "12px", border: "1px solid #444", fontFamily: "monospace",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
            });

            // 动态获取脚本头部的版本号
            const version = GM_info.script.version;
            
            panel.innerHTML = `
                <div style="border-bottom:1px solid #444;margin-bottom:8px;padding-bottom:5px;display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:bold;color:#e0245e;">GlassWall v${version}</span>
                    <span id="${CONSTANTS.UI.TXT_ID}" style="color:#aaa">Ready</span>
                </div>
                <div id="${CONSTANTS.UI.LOG_ID}" style="height:160px;overflow-y:auto;color:#ccc;margin-bottom:8px;font-size:11px;background:#111;padding:6px;border:1px solid #333;white-space:pre-wrap;">等待指令...</div>
                <div style="background:#333;height:6px;margin-bottom:8px;border-radius:3px;overflow:hidden">
                    <div id="${CONSTANTS.UI.BAR_ID}" style="width:0%;background:#e0245e;height:100%;transition:width 0.2s"></div>
                </div>
                <div style="display:flex;gap:5px">
                    <button id="${CONSTANTS.UI.BTN_START_ID}" style="flex:1;background:#e0245e;color:white;border:none;padding:8px;cursor:pointer;font-weight:bold;border-radius:4px;">🚀 启动全量处理</button>
                    <button id="${CONSTANTS.UI.BTN_CLEAR_ID}" style="flex:0.6;background:#555;color:white;border:none;padding:8px;cursor:pointer;border-radius:4px;">🧹 清除缓存</button>
                </div>
            `;
            document.body.appendChild(panel);
            
            // 绑定事件
            document.getElementById(CONSTANTS.UI.BTN_START_ID).onclick = App.startProcess;
            document.getElementById(CONSTANTS.UI.BTN_CLEAR_ID).onclick = CacheManager.clearAndReload;
        },

        // 日志输出
        log: (text, isError = false) => {
            const el = document.getElementById(CONSTANTS.UI.LOG_ID);
            if(el) {
                const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
                const color = isError ? "#ff5555" : "#cccccc";
                el.innerHTML = `<div style="color:${color}"><span style="color:#666">[${time}]</span> ${text}</div>` + el.innerHTML;
            }
        },

        // 进度条更新
        updateProgress: (percent, text) => {
            const bar = document.getElementById(CONSTANTS.UI.BAR_ID);
            const txt = document.getElementById(CONSTANTS.UI.TXT_ID);
            if(bar) bar.style.width = `${percent}%`;
            if(txt && text) txt.innerText = text;
        },
        
        // 按钮状态控制
        setButtonDisabled: (disabled) => {
            const btn = document.getElementById(CONSTANTS.UI.BTN_START_ID);
            if(btn) btn.disabled = disabled;
        }
    };

    // --- 4. 缓存管理模块 (CacheManager) ---
    const CacheManager = {
        async clearAndReload() {
            UIManager.log("🧹 正在清除所有本地缓存...");
            await GM.deleteValue(CONSTANTS.CACHE.LOCAL_MUTES);
            await GM.deleteValue(CONSTANTS.CACHE.LOCAL_MUTES_HEAD);
            UIManager.log("✅ 缓存已清除！页面将在 2 秒后刷新。");
            setTimeout(() => window.location.reload(), 2000);
        }
    };

    // --- 5. Twitter API 客户端 (TwitterClient) ---
    const TwitterClient = {
        getHeaders: (csrf) => ({
            'authorization': CONSTANTS.TWITTER.BEARER_TOKEN,
            'x-csrf-token': csrf
        }),

        // 校验/获取本地屏蔽列表头部
        async fetchMuteListHead(csrf) {
            const url = `${CONSTANTS.TWITTER.API_MUTE_LIST}?include_entities=false&skip_status=true&count=100&cursor=-1`;
            const res = await fetch(url, { headers: TwitterClient.getHeaders(csrf) });
            if (res.ok) {
                const json = await res.json();
                return json.users ? json.users.map(u => u.screen_name.toLowerCase()) : [];
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        },

        // 全量拉取本地屏蔽列表 (支持分页)
        async fetchFullMuteList(csrf, initialPageData) {
            const set = new Set();
            let cursor = -1;
            let isFirstPage = true;

            while (true) {
                try {
                    let json;
                    // 如果有第一页的预加载数据，直接使用
                    if (isFirstPage && initialPageData) {
                        const url = `${CONSTANTS.TWITTER.API_MUTE_LIST}?include_entities=false&skip_status=true&count=100&cursor=${cursor}`;
                        const res = await fetch(url, { headers: TwitterClient.getHeaders(csrf) });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        json = await res.json();
                        
                        // 额外添加 initialPageData (来自头部校验的数据)
                        initialPageData.users.forEach(u => set.add(u.screen_name.toLowerCase()));
                        isFirstPage = false;
                    } else {
                        const url = `${CONSTANTS.TWITTER.API_MUTE_LIST}?include_entities=false&skip_status=true&count=100&cursor=${cursor}`;
                        const res = await fetch(url, { headers: TwitterClient.getHeaders(csrf) });
                        if (res.status === 429) { 
                            UIManager.log(`⚠️ API 速率限制 (429)，读取中断。`, true); 
                            break; 
                        }
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        json = await res.json();
                    }

                    if (json.users && Array.isArray(json.users)) {
                        json.users.forEach(u => set.add(u.screen_name.toLowerCase()));
                    }

                    cursor = json.next_cursor_str;
                    UIManager.updateProgress(0, `⚡全量拉取: ${set.size}`);
                    if (cursor === "0" || cursor === 0) break;
                } catch (e) {
                    UIManager.log(`⚠️ 全量拉取中断: ${e.message}。将基于当前已获取数据继续。`, true);
                    break;
                }
            }
            return set;
        },

        // 执行 Mute 操作
        async muteUser(user, csrf) {
            const params = new URLSearchParams();
            params.append('screen_name', user);

            const res = await fetch(CONSTANTS.TWITTER.API_MUTE_CREATE, {
                method: 'POST',
                headers: {
                    ...TwitterClient.getHeaders(csrf),
                    'content-type': 'application/x-www-form-urlencoded'
                },
                body: params
            });
            return res;
        }
    };

    // --- 6. 远程数据源模块 (RemoteSource) ---
    const RemoteSource = {
        fetchExternal(url) {
            return new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: url,
                    timeout: 30000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "application/json, text/plain, */*",
                        "Referer": "https://basedinchina.com/"
                    },
                    onload: r => {
                        if (r.status === 200) resolve(r.responseText);
                        else {
                            UIManager.log(`❌ 无法访问 ${url}: HTTP ${r.status} ${r.statusText}`, true);
                            resolve(null);
                        }
                    },
                    onerror: (e) => {
                        UIManager.log(`❌ 网络错误: ${e.error}`, true);
                        resolve(null);
                    },
                    ontimeout: () => {
                        UIManager.log(`❌ 请求超时`, true);
                        resolve(null);
                    }
                });
            });
        },

        // 获取全量名单
        async fetchAll() {
            UIManager.log("🕸️ 正在从 2 个数据源获取五毛名单...");
            const all = new Set();
            
            const [source1Data, source2Data] = await Promise.all([
                RemoteSource.fetchExternal(CONSTANTS.REMOTE_SOURCES.FULL_LIST),
                RemoteSource.fetchExternal(CONSTANTS.REMOTE_SOURCES.SECOND_LIST)
            ]);

            // 解析 Source 1
            if (source1Data) {
                try {
                    const data = JSON.parse(source1Data);
                    if (data.users && Array.isArray(data.users)) {
                        data.users.forEach(user => user.userName && all.add(user.userName));
                    }
                } catch (e) { UIManager.log(`❌ [来源1] 解析失败: ${e.message}`, true); }
            }
            
            // 解析 Source 2
            if (source2Data) {
                try {
                    const lines = source2Data.trim().split('\n');
                    lines.forEach(line => {
                        if (!line) return;
                        try {
                            const data = JSON.parse(line);
                            if (data.username) all.add(data.username);
                        } catch (lineError) {}
                    });
                } catch (e) { UIManager.log(`❌ [来源2] 解析失败: ${e.message}`, true); }
            }
            return all;
        }
    };

    // --- 7. 业务逻辑 (App) ---
    const App = {
        // 获取推特已屏蔽列表 (流程：缓存校验 -> 使用缓存/全量拉取)
        async fetchLocalMutes(csrf) {
            UIManager.log("🔎 正在校验本地已屏蔽列表的缓存...");

            // 1. 获取最新屏蔽列表头部
            let liveHeadUsernames = [];
            try {
                liveHeadUsernames = await TwitterClient.fetchMuteListHead(csrf);
            } catch (e) {
                UIManager.log(`⚠️ 无法校验缓存: ${e.message}。将强制全量拉取。`, true);
                // 全量拉取并保存
                const fullSet = await TwitterClient.fetchFullMuteList(csrf, null);
                await App.saveToCache(fullSet);
                return fullSet;
            }

            // 2. 与缓存指纹比对
            const cachedHeadJson = await GM.getValue(CONSTANTS.CACHE.LOCAL_MUTES_HEAD, "[]");
            const isCacheValid = JSON.stringify(liveHeadUsernames) === cachedHeadJson;

            if (isCacheValid) {
                const cachedList = await GM.getValue(CONSTANTS.CACHE.LOCAL_MUTES, null);
                if (cachedList) {
                    UIManager.log(`✅ 缓存校验通过，从本地加载 ${cachedList.length} 人。`);
                    return new Set(cachedList);
                }
            }

            // 3. 缓存过期或不存在，执行全量拉取
            UIManager.log("⚠️ 缓存过期或不存在。正在全量拉取...");
            const initialPageUsers = liveHeadUsernames.map(screen_name => ({ screen_name }));
            
            const fullSet = await TwitterClient.fetchFullMuteList(csrf, { users: initialPageUsers, next_cursor_str: "PLACEHOLDER" });
            await App.saveToCache(fullSet);
            
            return fullSet;
        },

        // 辅助：保存本地缓存
        async saveToCache(set) {
            const fullList = Array.from(set);
            const newHeadList = fullList.slice(0, 100);
            await GM.setValue(CONSTANTS.CACHE.LOCAL_MUTES, fullList);
            await GM.setValue(CONSTANTS.CACHE.LOCAL_MUTES_HEAD, JSON.stringify(newHeadList));
            UIManager.log(`💾 已更新缓存 (${set.size} 人)`);
        },

        // 获取五毛列表
        async getWumaoUsers() {
            // 下载
            const all = await RemoteSource.fetchAll();
            
            // 校验
            if (all.size > 0) {
                return all;
            } else {
                throw new Error("未能从网络获取任何用户，请检查网络连接或源站状态。");
            }
        },

        // 串行执行逻辑
        async executeSerialMute(list, csrf, localMutedSet) {
            let success = 0;
            let fail = 0;
            const orderedCacheList = Array.from(localMutedSet);
            
            for(let i=0; i<list.length; i++) {
                const user = list[i];
                const pct = ((i+1) / list.length) * 100;
                UIManager.updateProgress(pct, `${Math.floor(pct)}% (${i+1}/${list.length})`);
                
                try {
                    const res = await TwitterClient.muteUser(user, csrf);

                    if(res.ok) {
                        success++;
                        
                        const lowerUser = user.toLowerCase();
                        
                        orderedCacheList.unshift(lowerUser); 
                        localMutedSet.add(lowerUser); // 同步更新 Set

                        await App.saveToCache(new Set(orderedCacheList));

                        if(success % 10 === 0) UIManager.log(`处理进度: ${i+1}/${list.length} | 成功: ${success} | 失败: ${fail}`);
                    } else {
                        fail++;
                        UIManager.log(`❌ 失败 @${user}: HTTP ${res.status}`, true);
                        
                        // 如果遇到 429 (Too Many Requests)，短暂暂停
                        if(res.status === 429) {
                            UIManager.log("⛔ 触发风控 (429)，暂停 5 秒...", true);
                            await Utils.sleep(5000);
                        }
                    }

                } catch(err) {
                    fail++;
                    UIManager.log(`❌ 网络错误 @${user}: ${err.message}`, true);
                }

                // 随机延时
                await Utils.sleep(Utils.getRandomDelay());
            }

            UIManager.updateProgress(100, "Done");
            UIManager.log(`🏁 全部完成! 成功: ${success}, 失败: ${fail}`);
            alert(`处理完毕！\n成功: ${success}\n失败: ${fail}`);
            UIManager.setButtonDisabled(false);
        },

        // 主入口
        async startProcess() {
            UIManager.setButtonDisabled(true);

            const csrf = Utils.getCsrfToken();
            if(!csrf) {
                UIManager.log("❌ 无法获取 CSRF Token，请刷新页面。", true);
                UIManager.setButtonDisabled(false);
                return;
            }

            try {
                // 1. 获取本地已屏蔽列表
                const localMuted = await App.fetchLocalMutes(csrf);
                UIManager.log(`✅ 本地名单读取完毕: 共 ${localMuted.size} 人`);

                // 2. 获取五毛列表
                const wumaoUsers = await App.getWumaoUsers();
                
                if (wumaoUsers.size === 0) {
                    throw new Error("未获取任何数据，请检查网络或 API");
                }
                UIManager.log(`✅ 五毛名单下载完毕: 共 ${wumaoUsers.size} 人`);

                // 3. 过滤
                UIManager.log("⚙️ 正在比对数据...");
                const todoList = [];
                let skipped = 0;
                
                wumaoUsers.forEach(u => {
                    // 转换为小写进行比对
                    if(localMuted.has(u.toLowerCase())) {
                        skipped++;
                    } else {
                        todoList.push(u);
                    }
                });

                UIManager.log(`🧹 过滤完成: 跳过 ${skipped} 人 (已存在)`);
                UIManager.log(`🎯 实际待处理: ${todoList.length} 人`);

                if (todoList.length === 0) {
                    UIManager.log("🎉 你的屏蔽列表已是最新，无需操作！");
                    alert("所有目标均已在你的屏蔽列表中。");
                    UIManager.updateProgress(100, "无需操作");
                    UIManager.setButtonDisabled(false);
                    return;
                }

                // 随机打乱列表
                Utils.shuffleArray(todoList);
                UIManager.log("🎲 已将待处理列表随机打乱");

                // 4. 自动执行
                UIManager.log(`🚀 正在自动启动处理... 共 ${todoList.length} 个目标`);

                // 5. 串行执行 Mute，并传入 localMuted 集合用于实时更新
                await App.executeSerialMute(todoList, csrf, localMuted);

            } catch (e) {
                UIManager.log(`❌ 发生异常: ${e.message}`, true);
                console.error(e);
                UIManager.setButtonDisabled(false);
            }
        }
    };

    // --- 8. 启动脚本 ---
    setInterval(() => UIManager.createPanel(), 1000);
    GM_registerMenuCommand("打开面板", UIManager.createPanel);

})();
