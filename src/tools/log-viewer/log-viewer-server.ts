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

      .file-item, .event-row {
        border: 1px solid transparent;
        border-radius: 14px;
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
      }

      .file-item:hover, .event-row:hover { background: rgba(255,255,255,0.55); }
      .file-item.selected, .event-row.selected {
        background: var(--selected);
        border-color: #d3ae7a;
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

        const filteredTree = filterEventTree(detail.eventTree ?? buildEventTree(detail.events), matchesEventFilters);
        const visibleNodes = flattenEventTree(filteredTree);

        eventCountLabel.textContent = '显示 ' + visibleNodes.length + ' / ' + detail.events.length + ' 条事件';

        if (visibleNodes.length === 0) {
          eventList.innerHTML = '<div class="empty">没有匹配当前过滤条件的事件。</div>';
        } else {
          eventList.innerHTML = '<div class="event-tree">' + renderEventTree(filteredTree, 0) + '</div>';
        }

        if ((detail.parseErrors ?? []).length > 0) {
          eventList.innerHTML += '<div class="error-list">' + detail.parseErrors.map((error) =>
            '<div class="error-item"><strong>解析错误</strong><div>第 ' + error.lineNumber + ' 行：' + escapeHtml(error.message) + '</div></div>'
          ).join('') + '</div>';
        }

        for (const element of eventList.querySelectorAll('.event-row')) {
          element.addEventListener('click', () => {
            state.selectedEventIndex = Number(element.dataset.index);
            renderEvents();
            renderDetail();
          });
        }

        renderDetail();
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
          const childrenHtml = (node.children && node.children.length > 0)
            ? '<div class="event-children">' + renderEventTree(node.children, depth + 1) + '</div>'
            : '';

          return '<div>' +
            '<div class="event-row ' + selected + '" data-index="' + node.index + '" style="margin-left:' + indent + 'px">' +
              '<strong>#' + escapeHtml(String(sequence)) + ' ' + escapeHtml(title) + '</strong>' +
              '<div class="event-meta">' +
                '<span>' + escapeHtml(timestamp) + '</span>' +
                (event.type ? '<span class="badge">' + escapeHtml(event.type) + '</span>' : '') +
                (event.mode ? '<span class="badge">' + escapeHtml(event.mode) + '</span>' : '') +
                (event.status ? '<span class="badge">' + escapeHtml(event.status) + '</span>' : '') +
                (event.eventId ? '<span class="badge">id</span>' : '') +
              '</div>' +
            '</div>' +
            childrenHtml +
          '</div>';
        }).join('');
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
