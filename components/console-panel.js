// Console/Log Viewer Component
window.ConsolePanel = {
  props: ['logs'],
  emits: ['clear'],
  template: `
    <div>
      <div style="display: flex; gap: 8px; margin-bottom: 12px; align-items: center;">
        <span style="color: #8b95aa; font-size: 13px;">{{ logs.length }} messages</span>
        <button class="btn btn-secondary" style="margin-left: auto;" @click="$emit('clear')">Clear Console</button>
      </div>
      <div class="console">
        <div v-if="logs.length === 0" style="color: #5a7a8b; text-align: center; padding: 20px; font-size: 13px;">
          No log messages yet...
        </div>
        <div v-for="(log, i) in logs.slice(-200)" :key="i" class="console-line">
          <span class="console-time">[{{ log.time }}]</span>
          <span>{{ log.msg }}</span>
        </div>
      </div>
    </div>
  `
};
