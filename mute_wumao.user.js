// ==UserScript==
// @name         Twitter/X Glass Great Wall
// @namespace    https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute
// @version      1.1.1
// @description  获取五毛名单 + 过滤已屏蔽 + 串行拉黑 (显示错误码)
// @author       OpenSource
// @match        https://x.com/*
// @match        https://twitter.com/*
// @connect      basedinchina.com
// @connect      archive.org
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @license      MIT
// @run-at       document-idle
// @homepageURL  https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute
// @supportURL   https://github.com/anonym-g/X-Accounts-Based-in-China-Auto-Mute/issues
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置参数 ---
    // API 端点，会自动 302 到 archive.org
    const FULL_LIST_URL = "https://basedinchina.com/api/users/all";

    // Mute 设置
    // 最小间隔 (毫秒)
    const MIN_DELAY = 100;
    // 最大间隔 (毫秒)
    const MAX_DELAY = 1000;

    // --- UI 界面 ---
    function createUI() {
        if (document.getElementById("gw-panel")) return;
        const panel = document.createElement('div');
        panel.id = "gw-panel";
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
                <span id="gw-pct-txt" style="color:#aaa">Ready</span>
            </div>
            <div id="gw-logs" style="height:160px;overflow-y:auto;color:#ccc;margin-bottom:8px;font-size:11px;background:#111;padding:6px;border:1px solid #333;white-space:pre-wrap;">等待指令...</div>
            <div style="background:#333;height:6px;margin-bottom:8px;border-radius:3px;overflow:hidden">
                <div id="gw-bar" style="width:0%;background:#e0245e;height:100%;transition:width 0.2s"></div>
            </div>
            <div style="display:flex;gap:5px">
                <button id="gw-btn" style="flex:1;background:#e0245e;color:white;border:none;padding:8px;cursor:pointer;font-weight:bold;border-radius:4px;">🚀 启动全量处理</button>
            </div>
        `;
        document.body.appendChild(panel);
        document.getElementById("gw-btn").onclick = startProcess;
    }

    function log(text, isError = false) {
        const el = document.getElementById("gw-logs");
        if(el) {
            const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
            const color = isError ? "#ff5555" : "#cccccc";
            el.innerHTML = `<div style="color:${color}"><span style="color:#666">[${time}]</span> ${text}</div>` + el.innerHTML;
        }
    }

    function updateProgress(percent, text) {
        const bar = document.getElementById("gw-bar");
        const txt = document.getElementById("gw-pct-txt");
        if(bar) bar.style.width = `${percent}%`;
        if(txt && text) txt.innerText = text;
    }

    // --- 核心流程 ---

    async function startProcess() {
        const btn = document.getElementById("gw-btn");
        if(btn) btn.disabled = true;

        const csrf = getCsrfToken();
        if(!csrf) {
            log("❌ 无法获取 CSRF Token，请刷新页面。", true);
            btn.disabled = false;
            return;
        }

        try {
            // 1. 获取本地已屏蔽列表
            log("🔎 正在读取你已屏蔽的名单...");
            const localMuted = await fetchLocalMutes(csrf);
            log(`✅ 本地名单读取完毕: 共 ${localMuted.size} 人`);

            // 2. 获取远程全量列表
            log(`🕸️ 正在下载 BasedInChina 全量名单...`);
            log(`ℹ️ 数据较大，正在从 Archive 载入，请稍候...`);
            const remoteUsers = await fetchRemoteList();
            
            if (remoteUsers.size === 0) {
                throw new Error("未获取到任何远程数据，请检查网络或 API");
            }
            log(`✅ 远程名单下载完毕: 共 ${remoteUsers.size} 人`);

            // 3. 过滤
            log("⚙️ 正在比对数据...");
            const todoList = [];
            let skipped = 0;
            
            remoteUsers.forEach(u => {
                // 转换为小写进行比对
                if(localMuted.has(u.toLowerCase())) {
                    skipped++;
                } else {
                    todoList.push(u);
                }
            });

            log(`🧹 过滤完成: 跳过 ${skipped} 人 (已存在)`);
            log(`🎯 实际待处理: ${todoList.length} 人`);

            if (todoList.length === 0) {
                log("🎉 你的屏蔽列表已是最新，无需操作！");
                alert("所有目标均已在你的屏蔽列表中。");
                updateProgress(100, "无需操作");
                btn.disabled = false;
                return;
            }

            // 随机打乱列表
            shuffleArray(todoList);
            log("🎲 已将待处理列表随机打乱");

            // 4. 自动执行
            log(`🚀 正在自动启动处理... 共 ${todoList.length} 个目标`);

            // 5. 串行执行 Mute
            await executeSerialMute(todoList, csrf);

        } catch (e) {
            log(`❌ 发生异常: ${e.message}`, true);
            console.error(e);
            btn.disabled = false;
        }
    }

    // --- 功能模块 ---

    // 获取推特后台的屏蔽列表 (自动翻页直到结束)
    async function fetchLocalMutes(csrf) {
        const set = new Set();
        let cursor = -1;
        
        while(true) {
            try {
                // count=100 (API允许的最大值)，大幅减少请求次数
                const url = `https://x.com/i/api/1.1/mutes/users/list.json?include_entities=false&skip_status=true&count=100&cursor=${cursor}`;
                const res = await fetch(url, {
                    headers: {
                        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                        'x-csrf-token': csrf
                    }
                });

                // 遇到 429, Break
                if (res.status === 429) {
                    log(`⚠️ 本地列表读取触及 API 上限 (429)，停止读取。当前已获: ${set.size} (将基于此列表继续)`, true);
                    break;
                }
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                const json = await res.json();
                
                if (json.users && Array.isArray(json.users)) {
                    json.users.forEach(u => set.add(u.screen_name.toLowerCase()));
                }
                
                cursor = json.next_cursor_str;
                
                // 更新 UI
                updateProgress(0, `⚡本地读取: ${set.size}`);
                
                // cursor 为 0 代表结束
                if(cursor === "0" || cursor === 0) break;
            } catch(e) {
                log(`⚠️ 读取本地列表部分中断: ${e.message}，将跳过剩余检查`, true);
                break;
            }
        }
        return set;
    }

    // 获取全量名单 (单一请求，自动处理 302)
    async function fetchRemoteList() {
        const all = new Set();
        
        const jsonStr = await fetchExternal(FULL_LIST_URL);
        
        if (!jsonStr) return all;

        try {
            const data = JSON.parse(jsonStr);
            
            if (data.users && Array.isArray(data.users)) {
                data.users.forEach(user => {
                    if (user.userName) {
                        all.add(user.userName);
                    }
                });
            } else {
                log("⚠️ 远程数据格式或有误，未找到 users 数组", true);
                console.log("Received Data:", data);
            }
        } catch (e) {
            log(`❌ JSON 解析失败: ${e.message}`, true);
        }

        return all;
    }

    // 串行 Mute
    async function executeSerialMute(list, csrf) {
        let success = 0;
        let fail = 0;
        const btn = document.getElementById("gw-btn");

        for(let i=0; i<list.length; i++) {
            const user = list[i];
            const pct = ((i+1) / list.length) * 100;
            updateProgress(pct, `${Math.floor(pct)}% (${i+1}/${list.length})`);
            
            try {
                const params = new URLSearchParams();
                params.append('screen_name', user);

                const res = await fetch("https://x.com/i/api/1.1/mutes/users/create.json", {
                    method: 'POST',
                    headers: {
                        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                        'x-csrf-token': csrf,
                        'content-type': 'application/x-www-form-urlencoded'
                    },
                    body: params
                });

                if(res.ok) {
                    success++;
                    if(success % 10 === 0) log(`处理进度: ${i+1}/${list.length} | 成功: ${success} | 失败: ${fail}`);
                } else {
                    fail++;
                    log(`❌ 失败 @${user}: HTTP ${res.status}`, true);
                    
                    // 如果遇到 429 (Too Many Requests)，短暂暂停
                    if(res.status === 429) {
                        log("⛔ 触发风控 (429)，暂停 5 秒...", true);
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }

            } catch(err) {
                fail++;
                log(`❌ 网络错误 @${user}: ${err.message}`, true);
            }

            // 随机延时
            const delay = Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY + 1) + MIN_DELAY);
            await new Promise(r => setTimeout(r, delay));
        }

        updateProgress(100, "Done");
        log(`🏁 全部完成! 成功: ${success}, 失败: ${fail}`);
        alert(`处理完毕！\n成功: ${success}\n失败: ${fail}`);
        if(btn) btn.disabled = false;
    }

    // --- 基础工具 ---
    
    // Fisher-Yates Shuffle 算法
    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function getCsrfToken() {
        const match = document.cookie.match(/(^|;\s*)ct0=([^;]*)/);
        return match ? match[2] : null;
    }

    function fetchExternal(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET", 
                url: url, 
                timeout: 30000, // 下载大文件需要更长时间
                headers: {
                    // 伪装成浏览器，防止被拦截
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "application/json, text/plain, */*",
                    "Referer": "https://basedinchina.com/"
                },
                onload: r => {
                    if (r.status === 200) {
                        // 成功拿到数据
                        resolve(r.responseText);
                    } else {
                        log(`❌ 无法访问 ${url}: HTTP ${r.status} ${r.statusText}`, true);
                        // 如果是 302 但 GM 没自动跳转（罕见配置），可能需要检查 r.responseHeaders
                        resolve(null);
                    }
                },
                onerror: (e) => {
                    log(`❌ 网络错误: ${e.error}`, true);
                    resolve(null);
                },
                ontimeout: () => {
                    log(`❌ 请求超时`, true);
                    resolve(null);
                }
            });
        });
    }

    setInterval(() => createUI(), 1000);
    GM_registerMenuCommand("打开面板", createUI);

})();
