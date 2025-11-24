// ==UserScript==
// @name         Twitter/X Glass Great Wall
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  爬取 + 过滤已屏蔽 + 串行执行 (显示错误码)
// @author       OpenSource
// @match        https://x.com/*
// @match        https://twitter.com/*
// @connect      basedinchina.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置参数 ---
    const BASE_URL = "https://basedinchina.com/api/users";
    
    // 爬虫并发数
    const CRAWL_CONCURRENCY = 20;

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
                <button id="gw-btn" style="flex:1;background:#e0245e;color:white;border:none;padding:8px;cursor:pointer;font-weight:bold;border-radius:4px;">🚀 启动稳定处理</button>
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

            // 2. 爬取远程列表
            log(`🕸️ 正在爬取 BasedInChina (并发: ${CRAWL_CONCURRENCY})...`);
            const remoteUsers = await crawlAllPages();
            log(`✅ 远程爬取完毕: 共 ${remoteUsers.size} 人`);

            // 3. 过滤
            log("⚙️ 正在比对数据...");
            const todoList = [];
            let skipped = 0;
            
            remoteUsers.forEach(u => {
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
        let retryCount = 0;
        
        while(true) {
            try {
                const url = `https://x.com/i/api/1.1/mutes/users/list.json?include_entities=false&skip_status=true&cursor=${cursor}`;
                const res = await fetch(url, {
                    headers: {
                        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                        'x-csrf-token': csrf
                    }
                });

                // 针对读取列表时的 429 单独处理
                if (res.status === 429) {
                    log(`⚠️ 读取本地列表触发风控 (429)，等待 5 秒后重试...`, true);
                    await new Promise(r => setTimeout(r, 5000));
                    retryCount++;
                    if (retryCount >= 3) {
                        log("⚠️ 重试次数过多，跳过读取。开始获取云端列表数据。", true);
                        break;
                    }
                    continue;
                }
                
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                // 请求成功，重置重试计数
                retryCount = 0;

                const json = await res.json();
                json.users.forEach(u => set.add(u.screen_name.toLowerCase()));
                
                cursor = json.next_cursor_str;
                
                // 更新 UI
                updateProgress(0, `已读取: ${set.size}`);
                
                // cursor 为 0 代表结束
                if(cursor === "0" || cursor === 0) break;
                
                // 稍微延时防止请求过快
                await new Promise(r => setTimeout(r, 200));
            } catch(e) {
                log(`⚠️ 读取中断: ${e.message}，将跳过剩余本地检查`, true);
                break;
            }
        }
        return set;
    }

    // 爬取 basedinchina
    async function crawlAllPages() {
        const all = new Set();
        let page = 1;
        // 利用 API 的 pageSize 参数，设为 50 (最大值) 以提高效率
        const pageSize = 50;
        let totalPages = 9999; // 初始假定值，第一次请求后更新

        while(page <= totalPages) {
            const tasks = [];
            
            // 构造并发任务
            for(let i=0; i<CRAWL_CONCURRENCY; i++) {
                const p = page + i;
                if (p > totalPages) break;

                // 构造 API URL
                const url = `${BASE_URL}?page=${p}&pageSize=${pageSize}`;
                tasks.push(fetchExternal(url));
            }

            if (tasks.length === 0) break;

            // 打印日志
            log(`📥 请求 API 页面: ${page} - ${page + tasks.length - 1} ...`);

            const results = await Promise.all(tasks);
            
            results.forEach(jsonStr => {
                if(!jsonStr) return;
                try {
                    const data = JSON.parse(jsonStr);
                    
                    // 第一次请求时，更新总页数
                    if (data.pageCount) {
                        totalPages = data.pageCount;
                    }

                    // 提取 userName (对应推特 ID)
                    if (Array.isArray(data.users)) {
                        data.users.forEach(user => {
                            if(user.userName) {
                                all.add(user.userName.toLowerCase());
                            }
                        });
                    }
                } catch(e) {
                    console.error("JSON 解析失败", e);
                }
            });
            
            updateProgress(0, `已发现: ${all.size} (页数: ${Math.min(page + CRAWL_CONCURRENCY - 1, totalPages)}/${totalPages})`);
            
            page += CRAWL_CONCURRENCY;
            
            // 小延时防止请求过快
            await new Promise(r => setTimeout(r, 300));
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
                    // 每10个打印一条日志，避免刷屏
                    if(success % 10 === 0) log(`已处理: ${i+1}/${list.length} | 成功: ${success} | 失败: ${fail}`);
                } else {
                    fail++;
                    log(`❌ 失败 @${user}: HTTP ${res.status}`, true);
                    
                    // 如果遇到 429 (Too Many Requests)，必须暂停
                    if(res.status === 429) {
                        log("⛔ 触发风控 (429)，脚本强制暂停 5 秒...", true);
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
                timeout: 10000,
                headers: {
                    // 伪装成浏览器，防止被拦截
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                    "Referer": "https://basedinchina.com/"
                },
                onload: r => {
                    if (r.status === 200) {
                        // 成功拿到数据
                        resolve(r.responseText);
                    } else {
                        // 打印具体的失败原因
                        log(`❌ 无法访问 ${url}: HTTP ${r.status}`, true);
                        resolve(null);
                    }
                },
                onerror: (e) => {
                    log(`❌ 网络错误 ${url}: ${e.error}`, true);
                    resolve(null);
                },
                ontimeout: () => {
                    log(`❌ 请求超时 ${url}`, true);
                    resolve(null);
                }
            });
        });
    }

    setInterval(() => createUI(), 1000);
    GM_registerMenuCommand("打开面板", createUI);

})();
