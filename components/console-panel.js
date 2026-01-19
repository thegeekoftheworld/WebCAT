// Console/Log Viewer Component
window.ConsolePanel = {
  props: ['logs'],
  emits: ['clear'],
  template: `
    <div>
      <button class="btn btn-secondary" style="margin-bottom: 10px;" @click="$emit('clear')">Clear</button>
      <div class="console">
        <div v-for="(log, i) in logs.slice(-100)" :key="i" class="console-line">
          <span class="console-time">{{ log.time }}</span>
          <span>{{ log.msg }}</span>
        </div>
      </div>
    </div>
  `
};
