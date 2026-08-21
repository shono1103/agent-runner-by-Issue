export const PANEL_CSS = `
:host {
  all: initial;
}
* {
  box-sizing: border-box;
}
.panel {
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #0d1117;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: 300px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  cursor: pointer;
  user-select: none;
}
.header .title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header .actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #6e7681;
  flex-shrink: 0;
}
.dot.ok {
  background: #3fb950;
}
.dot.error {
  background: #f85149;
}
.iconbtn {
  background: transparent;
  border: none;
  color: #8b949e;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
  border-radius: 4px;
}
.iconbtn:hover {
  background: #21262d;
  color: #e6edf3;
}
.body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.body.collapsed {
  display: none;
}
.section-label {
  color: #8b949e;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
button.action {
  flex: 1 1 auto;
  background: #21262d;
  color: #e6edf3;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
}
button.action:hover:not(:disabled) {
  background: #30363d;
}
button.action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.primary {
  background: #238636;
  border-color: #2ea043;
}
button.primary:hover:not(:disabled) {
  background: #2ea043;
}
button.danger {
  background: #6e2020;
  border-color: #a13030;
}
button.danger:hover:not(:disabled) {
  background: #8a2a2a;
}
.status {
  font-size: 11px;
  color: #8b949e;
  min-height: 14px;
  word-break: break-word;
}
.log {
  max-height: 140px;
  overflow-y: auto;
  background: #010409;
  border: 1px solid #21262d;
  border-radius: 6px;
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  color: #8b949e;
  white-space: pre-wrap;
}
.log:empty {
  display: none;
}
label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: #8b949e;
}
input[type="text"],
input[type="password"] {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  padding: 5px 7px;
  font-size: 12px;
}
a {
  color: #58a6ff;
}
`;
