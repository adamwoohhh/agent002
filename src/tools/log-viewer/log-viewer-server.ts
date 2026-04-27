import { access } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import {
  listLogFiles,
  parseLogFile,
  resolveLogFilePath,
  type LogFileListItem,
  type ParsedLogFile,
} from "./log-viewer-data.js";

export type LogViewerServerOptions = {
  logDirectory: string;
};

export function createLogViewerServer(options: LogViewerServerOptions) {
  return http.createServer((request, response) => {
    void handleLogViewerRequest(request, response, options);
  });
}

export async function handleLogViewerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: LogViewerServerOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (method !== "GET") {
    sendJson(response, 405, { error: "Method Not Allowed" });
    return;
  }

  if (requestUrl.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderAppHtml());
    return;
  }

  if (requestUrl.pathname === "/api/log-files") {
    try {
      const files = await listLogFiles(options.logDirectory);
      sendJson(response, 200, { files });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "无法读取日志目录",
      });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/log-files/")) {
    const requestedFileName = decodeURIComponent(requestUrl.pathname.replace("/api/log-files/", ""));
    const resolvedFilePath = resolveLogFilePath(options.logDirectory, requestedFileName);

    if (!resolvedFilePath) {
      sendJson(response, 400, { error: "非法文件名" });
      return;
    }

    try {
      await access(resolvedFilePath);
    } catch {
      sendJson(response, 404, { error: "日志文件不存在" });
      return;
    }

    try {
      const parsed = await parseLogFile(resolvedFilePath);
      sendJson(response, 200, serializeLogDetail(requestedFileName, resolvedFilePath, parsed));
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "无法解析日志文件",
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not Found" });
}

function serializeLogDetail(fileName: string, filePath: string, parsed: ParsedLogFile) {
  return {
    name: fileName,
    path: filePath,
    summary: parsed.summary,
    events: parsed.events,
    eventTree: parsed.eventTree,
    parseErrors: parsed.parseErrors,
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function renderAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AGX Log Viewer</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe6;
        --panel: rgba(255, 251, 245, 0.92);
        --panel-strong: #fffdf8;
        --line: #dfd2bf;
        --text: #24180f;
        --muted: #756252;
        --accent: #c55d2d;
        --accent-soft: #f6d8c7;
        --selected: #f0dfc6;
        --shadow: 0 18px 40px rgba(69, 42, 17, 0.12);
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      }

      * { box-sizing: border-box; }
      html, body {
        height: 100%;
        overflow: hidden;
      }

      body {
        margin: 0;
        min-height: 100%;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(197, 93, 45, 0.18), transparent 28%),
          radial-gradient(circle at bottom right, rgba(123, 153, 108, 0.14), transparent 32%),
          linear-gradient(180deg, #f9f4eb 0%, var(--bg) 100%);
      }

      .app {
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 16px;
        height: 100vh;
        padding: 18px;
        overflow: hidden;
      }

      .hero, .filters, .layout > section {
        background: var(--panel);
        border: 1px solid rgba(255,255,255,0.7);
        border-radius: 18px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(10px);
      }

      .hero {
        padding: 18px 20px;
        overflow: hidden;
      }
      .hero h1 { margin: 0 0 8px; font-size: 28px; }
      .hero p { margin: 0; color: var(--muted); }

      .toolbar {
        display: flex;
        gap: 12px;
        align-items: stretch;
        justify-content: space-between;
        margin-top: 14px;
        flex-wrap: wrap;
        min-height: 0;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        flex: 1 1 560px;
        min-width: 0;
        max-height: 210px;
        overflow: auto;
        padding-right: 4px;
      }

      .summary-card {
        background: var(--panel-strong);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        min-height: 88px;
        max-height: 156px;
      }

      .summary-card .label {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .summary-card .value {
        display: block;
        font-size: 15px;
        line-height: 1.35;
        word-break: break-word;
        overflow: auto;
        padding-right: 2px;
      }

      .filters {
        padding: 14px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 10px;
      }

      input, select, button {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel-strong);
        color: var(--text);
        padding: 10px 12px;
        font: inherit;
      }

      button {
        cursor: pointer;
        background: linear-gradient(180deg, #d06c38, var(--accent));
        color: white;
        border: none;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(240px, 0.9fr) minmax(380px, 1.6fr) minmax(320px, 1.2fr);
        gap: 16px;
        min-height: 0;
        overflow: hidden;
      }

      .layout > section {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }

      .panel-header {
        padding: 14px 16px;
        border-bottom: 1px solid var(--line);
      }

      .panel-header h2 {
        margin: 0;
        font-size: 17px;
      }

      .panel-header p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
      }

      .scroll {
        overflow: auto;
        padding: 10px;
        min-height: 0;
      }

      .file-item, .event-row, .conversation-turn {
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
      }

      .event-tree {
        display: grid;
        gap: 8px;
      }

      .event-children {
        display: grid;
        gap: 8px;
        margin-top: 8px;
        position: relative;
      }

      .event-children::before {
        content: "";
        position: absolute;
        top: -8px;
        bottom: 4px;
        left: 18px;
        width: 2px;
        background: rgba(117, 98, 82, 0.18);
      }

      .file-item:hover, .event-row:hover, .conversation-turn:hover { background: rgba(255,255,255,0.55); }
      .file-item.selected, .event-row.selected, .conversation-turn.selected {
        background: var(--selected);
        border-color: #d3ae7a;
      }

      .event-row {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: start;
        background: rgba(255, 253, 248, 0.78);
        border-color: rgba(223, 210, 191, 0.72);
        border-left-width: 5px;
      }

      .event-row.depth-0 {
        background: #fffaf0;
        border-color: #d8b071;
        font-weight: 600;
      }

      .event-row.depth-1 {
        background: #fffdf8;
      }

      .event-row.depth-2,
      .event-row.depth-3,
      .event-row.depth-4,
      .event-row.depth-5 {
        background: rgba(255, 255, 255, 0.62);
        font-size: 13px;
      }

      .event-row.type-run_started,
      .event-row.type-run_completed {
        border-left-color: #7b996c;
      }

      .event-row.type-session_event {
        border-left-color: #b68145;
      }

      .event-row.type-graph_event {
        border-left-color: #5786a6;
      }

      .event-row.type-model_call {
        border-left-color: #8d6ab8;
      }

      .event-row.type-runtime_task_completed {
        border-left-color: #bd6b62;
      }

      .event-row.status-open {
        border-style: dashed;
      }

      .event-row.status-completed {
        box-shadow: inset 0 0 0 1px rgba(123, 153, 108, 0.08);
      }

      .event-main {
        min-width: 0;
      }

      .event-title {
        display: flex;
        gap: 8px;
        align-items: center;
        min-width: 0;
      }

      .event-title strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .collapse-toggle {
        width: 26px;
        height: 26px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--line);
        background: var(--panel-strong);
        color: var(--muted);
        flex: 0 0 auto;
        line-height: 1;
      }

      .collapse-toggle:hover {
        background: #f3e4d0;
        color: var(--text);
      }

      .collapse-toggle.placeholder {
        visibility: hidden;
      }

      .file-meta, .event-meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 8px;
        color: var(--muted);
        font-size: 12px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #8f3e18;
        font-size: 12px;
      }

      .event-grid {
        display: grid;
        gap: 8px;
      }

      .mini-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }

      .mini-actions button {
        width: auto;
        padding: 6px 10px;
        border-radius: 8px;
        background: var(--panel-strong);
        color: var(--text);
        border: 1px solid var(--line);
      }

      .conversation-list {
        display: grid;
        gap: 10px;
      }

      .conversation-turn {
        background: rgba(255, 253, 248, 0.82);
        border-color: var(--line);
      }

      .conversation-turn h3 {
        margin: 0 0 10px;
        font-size: 14px;
      }

      .message {
        display: grid;
        gap: 4px;
        margin-top: 8px;
      }

      .message .role {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .message .content {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", "SF Mono", Consolas, monospace;
        font-size: 12px;
        line-height: 1.55;
      }

      .empty {
        color: var(--muted);
        text-align: center;
        padding: 32px 18px;
      }

      .error-list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .error-item {
        border-radius: 12px;
        background: #fff4ee;
        border: 1px solid #efc7b3;
        padding: 10px;
      }

      @media (max-width: 1080px) {
        html, body {
          height: auto;
          overflow: auto;
        }

        .app {
          height: auto;
          min-height: 100vh;
          overflow: visible;
        }

        .layout {
          grid-template-columns: 1fr;
          overflow: visible;
        }

        .summary {
          max-height: none;
          overflow: visible;
          padding-right: 0;
        }

        .summary-card {
          max-height: none;
        }

        .summary-card .value {
          overflow: visible;
          padding-right: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <section class="hero">
        <h1>AGX Log Viewer</h1>
        <p>浏览本地 JSONL 运行日志，按文件、事件类型和关键字快速定位问题。</p>
        <div class="toolbar">
          <div class="summary" id="summary"></div>
          <div style="min-width: 160px;">
            <button id="refreshButton" type="button">刷新文件列表</button>
          </div>
        </div>
      </section>

      <section class="filters">
        <input id="keywordInput" placeholder="搜索事件 JSON 关键字" />
        <select id="typeSelect">
          <option value="">全部事件类型</option>
        </select>
        <select id="modeSelect">
          <option value="">全部 graph mode</option>
        </select>
        <select id="viewSelect">
          <option value="events">全部事件</option>
          <option value="conversation">仅对话输入/输出</option>
        </select>
      </section>

      <div class="layout">
        <section>
          <div class="panel-header">
            <h2>日志文件</h2>
            <p id="fileCountLabel">加载中...</p>
          </div>
          <div class="scroll" id="fileList"></div>
        </section>

        <section>
          <div class="panel-header">
            <h2>事件时间线</h2>
            <p id="eventCountLabel">请选择一个日志文件</p>
          </div>
          <div class="scroll event-grid" id="eventList"></div>
        </section>

        <section>
          <div class="panel-header">
            <h2>事件详情</h2>
            <p id="detailLabel">点击中间一条事件查看完整 JSON</p>
          </div>
          <div class="scroll" id="detailPanel">
            <div class="empty">还没有选中的事件。</div>
          </div>
        </section>
      </div>
    </div>

    <script>
      const state = {
        files: [],
        currentFile: null,
        currentDetail: null,
        selectedEventIndex: -1,
        collapsedKeys: new Set(),
        view: "events",
        filters: { keyword: "", type: "", mode: "" },
      };

      const fileList = document.getElementById("fileList");
      const fileCountLabel = document.getElementById("fileCountLabel");
      const eventList = document.getElementById("eventList");
      const eventCountLabel = document.getElementById("eventCountLabel");
      const detailPanel = document.getElementById("detailPanel");
      const detailLabel = document.getElementById("detailLabel");
      const summary = document.getElementById("summary");
      const keywordInput = document.getElementById("keywordInput");
      const typeSelect = document.getElementById("typeSelect");
      const modeSelect = document.getElementById("modeSelect");
      const viewSelect = document.getElementById("viewSelect");
      const refreshButton = document.getElementById("refreshButton");

      refreshButton.addEventListener("click", () => loadFiles());
      keywordInput.addEventListener("input", () => {
        state.filters.keyword = keywordInput.value.trim().toLowerCase();
        renderEvents();
      });
      typeSelect.addEventListener("change", () => {
        state.filters.type = typeSelect.value;
        renderEvents();
      });
      modeSelect.addEventListener("change", () => {
        state.filters.mode = modeSelect.value;
        renderEvents();
      });
      viewSelect.addEventListener("change", () => {
        state.view = viewSelect.value;
        state.selectedEventIndex = -1;
        renderEvents();
      });

      loadFiles();

      async function loadFiles() {
        fileCountLabel.textContent = "加载中...";
        try {
          const response = await fetch("/api/log-files");
          const data = await response.json();
          state.files = data.files ?? [];
          renderFiles();
          if (state.files.length > 0) {
            const selected = state.currentFile?.name ?? state.files[0].name;
            await loadFile(selected);
          } else {
            state.currentDetail = null;
            renderSummary();
            renderEvents();
          }
        } catch (error) {
          fileList.innerHTML = '<div class="empty">文件列表加载失败。</div>';
          fileCountLabel.textContent = String(error);
        }
      }

      async function loadFile(name) {
        state.currentFile = state.files.find((file) => file.name === name) ?? null;
        state.selectedEventIndex = -1;
        state.collapsedKeys = new Set();
        detailLabel.textContent = "点击中间一条事件查看完整 JSON";
        detailPanel.innerHTML = '<div class="empty">还没有选中的事件。</div>';
        renderFiles();
        eventCountLabel.textContent = "加载日志中...";

        try {
          const response = await fetch('/api/log-files/' + encodeURIComponent(name));
          state.currentDetail = await response.json();
          renderSummary();
          syncFilterOptions();
          renderEvents();
        } catch (error) {
          eventList.innerHTML = '<div class="empty">日志详情加载失败。</div>';
          eventCountLabel.textContent = String(error);
        }
      }

      function renderFiles() {
        fileCountLabel.textContent = '共 ' + state.files.length + ' 个日志文件';
        if (state.files.length === 0) {
          fileList.innerHTML = '<div class="empty">logs 目录里还没有 JSONL 文件。</div>';
          return;
        }

        fileList.innerHTML = state.files.map((file) => {
          const selected = file.name === state.currentFile?.name ? 'selected' : '';
          return '<div class="file-item ' + selected + '" data-name="' + escapeHtml(file.name) + '">' +
            '<strong>' + escapeHtml(file.name) + '</strong>' +
            '<div class="file-meta">' +
              '<span class="badge">' + escapeHtml(file.kind) + '</span>' +
              '<span>' + file.eventCount + ' events</span>' +
              '<span>' + new Date(file.updatedAt).toLocaleString() + '</span>' +
            '</div>' +
          '</div>';
        }).join('');

        for (const element of fileList.querySelectorAll('.file-item')) {
          element.addEventListener('click', () => loadFile(element.dataset.name));
        }
      }

      function renderSummary() {
        const detail = state.currentDetail;
        if (!detail) {
          summary.innerHTML = '';
          return;
        }

        const cards = [
          ['Run ID', detail.summary.runId ?? '未知'],
          ['文件类型', detail.summary.kind],
          ['总事件数', String(detail.summary.totalEvents)],
          ['开始时间', formatMaybeDate(detail.summary.startedAt)],
          ['结束时间', formatMaybeDate(detail.summary.completedAt)],
          ['事件计数', detail.summary.eventTypeCounts.map((item) => item.type + ':' + item.count).join(', ') || '无'],
        ];

        summary.innerHTML = cards.map(([label, value]) =>
          '<div class="summary-card"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value) + '</span></div>'
        ).join('');
      }

      function syncFilterOptions() {
        const events = state.currentDetail?.events ?? [];
        const types = [...new Set(events.map((event) => event.type).filter(Boolean))].sort();
        const modes = [...new Set(events.map((event) => event.mode).filter(Boolean))].sort();

        typeSelect.innerHTML = '<option value="">全部事件类型</option>' + types.map((type) =>
          '<option value="' + escapeHtml(type) + '">' + escapeHtml(type) + '</option>'
        ).join('');

        modeSelect.innerHTML = '<option value="">全部 graph mode</option>' + modes.map((mode) =>
          '<option value="' + escapeHtml(mode) + '">' + escapeHtml(mode) + '</option>'
        ).join('');

        typeSelect.value = types.includes(state.filters.type) ? state.filters.type : '';
        modeSelect.value = modes.includes(state.filters.mode) ? state.filters.mode : '';
      }

      function renderEvents() {
        const detail = state.currentDetail;
        if (!detail) {
          eventList.innerHTML = '<div class="empty">请选择一个日志文件。</div>';
          eventCountLabel.textContent = '请选择一个日志文件';
          return;
        }

        if (state.view === 'conversation') {
          renderConversationTurns(detail);
          return;
        }

        const filteredTree = filterEventTree(detail.eventTree ?? buildEventTree(detail.events), matchesEventFilters);
        const visibleNodes = flattenVisibleEventTree(filteredTree);

        eventCountLabel.textContent = '显示 ' + visibleNodes.length + ' / ' + detail.events.length + ' 条事件';

        if (visibleNodes.length === 0) {
          eventList.innerHTML = '<div class="empty">没有匹配当前过滤条件的事件。</div>';
        } else {
          eventList.innerHTML = '<div class="event-tree">' + renderEventTree(filteredTree, 0) + '</div>';
        }

        const actionHtml = visibleNodes.length > 0
          ? '<div class="mini-actions"><button id="expandAllButton" type="button">全部展开</button><button id="collapseAllButton" type="button">折叠父事件</button></div>'
          : '';
        eventList.innerHTML = actionHtml + eventList.innerHTML;

        if ((detail.parseErrors ?? []).length > 0) {
          eventList.innerHTML += '<div class="error-list">' + detail.parseErrors.map((error) =>
            '<div class="error-item"><strong>解析错误</strong><div>第 ' + error.lineNumber + ' 行：' + escapeHtml(error.message) + '</div></div>'
          ).join('') + '</div>';
        }

        const expandAllButton = document.getElementById('expandAllButton');
        if (expandAllButton) {
          expandAllButton.addEventListener('click', () => {
            state.collapsedKeys.clear();
            renderEvents();
          });
        }
        const collapseAllButton = document.getElementById('collapseAllButton');
        if (collapseAllButton) {
          collapseAllButton.addEventListener('click', () => {
            for (const node of flattenEventTree(filteredTree)) {
              if ((node.children ?? []).length > 0) {
                state.collapsedKeys.add(getNodeKey(node));
              }
            }
            renderEvents();
          });
        }

        for (const element of eventList.querySelectorAll('.event-row')) {
          element.addEventListener('click', () => {
            state.selectedEventIndex = Number(element.dataset.index);
            renderEvents();
            renderDetail();
          });
        }
        for (const element of eventList.querySelectorAll('.collapse-toggle:not(.placeholder)')) {
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            const key = element.dataset.key;
            if (!key) {
              return;
            }
            if (state.collapsedKeys.has(key)) {
              state.collapsedKeys.delete(key);
            } else {
              state.collapsedKeys.add(key);
            }
            renderEvents();
          });
        }

        renderDetail();
      }

      function renderConversationTurns(detail) {
        const turns = extractConversationTurns(detail.events);
        const filteredTurns = turns.filter((turn) => {
          if (!state.filters.keyword) {
            return true;
          }
          return (turn.input + '\\n' + turn.output).toLowerCase().includes(state.filters.keyword);
        });

        eventCountLabel.textContent = '显示 ' + filteredTurns.length + ' / ' + turns.length + ' 轮对话';
        if (filteredTurns.length === 0) {
          eventList.innerHTML = '<div class="empty">没有匹配当前过滤条件的对话轮次。</div>';
          renderDetail();
          return;
        }

        eventList.innerHTML = '<div class="conversation-list">' + filteredTurns.map((turn) => {
          const selected = turn.index === state.selectedEventIndex ? 'selected' : '';
          return '<div class="conversation-turn ' + selected + '" data-index="' + turn.index + '">' +
            '<h3>#' + escapeHtml(String(turn.sequence ?? '-')) + ' ' + escapeHtml(formatMaybeDate(turn.timestamp)) + '</h3>' +
            '<div class="message"><span class="role">用户输入</span><p class="content">' + escapeHtml(turn.input) + '</p></div>' +
            '<div class="message"><span class="role">模型输出</span><p class="content">' + escapeHtml(turn.output) + '</p></div>' +
          '</div>';
        }).join('') + '</div>';

        for (const element of eventList.querySelectorAll('.conversation-turn')) {
          element.addEventListener('click', () => {
            state.selectedEventIndex = Number(element.dataset.index);
            renderEvents();
            renderDetail();
          });
        }

        renderDetail();
      }

      function extractConversationTurns(events) {
        return events
          .map((event, index) => {
            const input = getConversationInput(event);
            const output = getConversationOutput(event);
            if (!input || !output) {
              return null;
            }
            return {
              index,
              sequence: event.sequence,
              timestamp: event.timestamp,
              input,
              output,
            };
          })
          .filter(Boolean);
      }

      function getConversationInput(event) {
        if (event.phase !== 'session_turn') {
          return null;
        }
        if (typeof event.input === 'object' && event.input !== null && typeof event.input.input === 'string') {
          return event.input.input;
        }
        if (typeof event.input === 'string') {
          return event.input;
        }
        return null;
      }

      function getConversationOutput(event) {
        if (event.phase !== 'session_turn') {
          return null;
        }
        if (typeof event.output === 'object' && event.output !== null && typeof event.output.finalAnswer === 'string') {
          return event.output.finalAnswer;
        }
        if (typeof event.output === 'string') {
          return event.output;
        }
        return null;
      }

      function matchesEventFilters(event) {
        if (state.filters.type && event.type !== state.filters.type) {
          return false;
        }
        if (state.filters.mode && event.mode !== state.filters.mode) {
          return false;
        }
        if (state.filters.keyword) {
          return JSON.stringify(event).toLowerCase().includes(state.filters.keyword);
        }
        return true;
      }

      function filterEventTree(nodes, predicate) {
        return nodes.flatMap((node) => {
          const filteredChildren = filterEventTree(node.children ?? [], predicate);
          const matches = predicate(node.event);
          if (!matches && filteredChildren.length === 0) {
            return [];
          }
          return [{
            ...node,
            children: filteredChildren,
          }];
        });
      }

      function flattenEventTree(nodes) {
        return nodes.flatMap((node) => [node, ...flattenEventTree(node.children ?? [])]);
      }

      function flattenVisibleEventTree(nodes) {
        return nodes.flatMap((node) => {
          if (state.collapsedKeys.has(getNodeKey(node))) {
            return [node];
          }
          return [node, ...flattenVisibleEventTree(node.children ?? [])];
        });
      }

      function renderEventTree(nodes, depth) {
        return nodes.map((node) => {
          const event = node.event;
          const selected = node.index === state.selectedEventIndex ? 'selected' : '';
          const sequence = event.sequence ?? '-';
          const timestamp = formatMaybeDate(event.timestamp);
          const indent = 12 + depth * 20;
          const title = event.name
            ? event.name + (event.spanType ? ' [' + event.spanType + ']' : '')
            : (event.type ?? 'unknown');
          const nodeKey = getNodeKey(node);
          const collapsed = state.collapsedKeys.has(nodeKey);
          const hasChildren = node.children && node.children.length > 0;
          const typeClass = sanitizeClassName(event.type ?? 'unknown');
          const statusClass = sanitizeClassName(event.status ?? 'unknown');
          const childrenHtml = hasChildren && !collapsed
            ? '<div class="event-children">' + renderEventTree(node.children, depth + 1) + '</div>'
            : '';
          const childBadge = hasChildren
            ? '<span class="badge">' + node.children.length + ' children</span>'
            : '';
          const toggle = hasChildren
            ? '<button class="collapse-toggle" type="button" data-key="' + escapeHtml(nodeKey) + '" title="' + (collapsed ? '展开子事件' : '折叠子事件') + '">' + (collapsed ? '+' : '-') + '</button>'
            : '<span class="collapse-toggle placeholder"></span>';

          return '<div>' +
            '<div class="event-row ' + selected + ' depth-' + Math.min(depth, 5) + ' type-' + typeClass + ' status-' + statusClass + '" data-index="' + node.index + '" style="margin-left:' + indent + 'px">' +
              toggle +
              '<div class="event-main">' +
                '<div class="event-title"><strong>#' + escapeHtml(String(sequence)) + ' ' + escapeHtml(title) + '</strong></div>' +
                '<div class="event-meta">' +
                  '<span>' + escapeHtml(timestamp) + '</span>' +
                  (event.type ? '<span class="badge">' + escapeHtml(event.type) + '</span>' : '') +
                  (event.mode ? '<span class="badge">' + escapeHtml(event.mode) + '</span>' : '') +
                  (event.status ? '<span class="badge">' + escapeHtml(event.status) + '</span>' : '') +
                  (event.eventId ? '<span class="badge">id</span>' : '') +
                  childBadge +
                '</div>' +
              '</div>' +
            '</div>' +
            childrenHtml +
          '</div>';
        }).join('');
      }

      function getNodeKey(node) {
        return typeof node.event.eventId === 'string' && node.event.eventId
          ? 'event:' + node.event.eventId
          : 'index:' + node.index;
      }

      function sanitizeClassName(value) {
        return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      }

      function buildEventTree(events) {
        const nodes = events.map((event, index) => ({
          event,
          index,
          children: [],
        }));
        const byEventId = new Map();

        for (const node of nodes) {
          if (typeof node.event.eventId === 'string' && node.event.eventId) {
            byEventId.set(node.event.eventId, node);
          }
        }

        const roots = [];
        for (const node of nodes) {
          const parentEventId = typeof node.event.parentEventId === 'string' && node.event.parentEventId
            ? node.event.parentEventId
            : null;
          if (!parentEventId) {
            roots.push(node);
            continue;
          }

          const parent = byEventId.get(parentEventId);
          if (!parent || parent === node) {
            roots.push(node);
            continue;
          }

          parent.children.push(node);
        }

        return roots;
      }

      function renderDetail() {
        const detail = state.currentDetail;
        const event = detail?.events?.[state.selectedEventIndex];
        if (!event) {
          detailPanel.innerHTML = '<div class="empty">还没有选中的事件。</div>';
          return;
        }

        const title = event.name
          ? event.name + (event.spanType ? ' [' + event.spanType + ']' : '')
          : (event.type ?? 'unknown');
        detailLabel.textContent = title + ' #' + (event.sequence ?? '-');
        if (state.view === 'conversation') {
          const input = getConversationInput(event);
          const output = getConversationOutput(event);
          if (input && output) {
            detailPanel.innerHTML =
              '<div class="message"><span class="role">用户输入</span><p class="content">' + escapeHtml(input) + '</p></div>' +
              '<div class="message"><span class="role">模型输出</span><p class="content">' + escapeHtml(output) + '</p></div>';
            return;
          }
        }
        detailPanel.innerHTML = '<pre>' + escapeHtml(JSON.stringify(event, null, 2)) + '</pre>';
      }

      function formatMaybeDate(value) {
        if (!value) {
          return '未知';
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          return String(value);
        }
        return date.toLocaleString();
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }
    </script>
  </body>
</html>`;
}
