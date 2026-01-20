// Radio Control Panel Component
window.RadioPanel = {
  components: {
    WaterfallPanel: window.WaterfallPanel
  },
  props: {
    radio: { type: Object, default: () => ({}) },
    config: { type: Object, default: () => ({}) },
    displayFreq: { type: String, default: '' },
    currentControls: { type: Array, default: () => [] },
    controlValues: { type: Object, default: () => ({}) }
  },
  emits: ['connect', 'disconnect', 'adjFreq', 'manualRead', 'controlChange', 'ptt'],
  data() {
    return {
      controlTab: 'primary',
      showAllControls: false,
      showWaterfall: true
    };
  },
  mounted() {
    // Auto-select first available group if primary doesn't exist
    if (this.groupNames.length && !this.controlGroups['primary']) {
      this.controlTab = this.groupNames[0];
    }
  },
  computed: {
    controlGroups() {
      const groups = {};
      (this.currentControls || []).forEach(ctrl => {
        const g = ctrl.group || 'other';
        if (!groups[g]) groups[g] = [];
        groups[g].push(ctrl);
      });
      return groups;
    },
    groupNames() {
      return Object.keys(this.controlGroups).sort((a, b) => {
        const order = ['primary', 'audio', 'transmit', 'filter', 'offset', 'advanced'];
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });
    }
  },
  template: `
    <div>
      <div v-if="radio.connected" class="radio-display">
        <!-- Main Frequency Display -->
        <div class="freq-display">{{ displayFreq }}</div>
        <div class="freq-sub">
          <div class="freq-sub-item">
            <span>Mode</span>
            <div class="freq-sub-value">{{ radio.mode || '—' }}</div>
          </div>
          <div class="freq-sub-item">
            <span>Status</span>
            <div class="freq-sub-value">{{ radio.ptt ? '🔴 TX' : '⚫ RX' }}</div>
          </div>
        </div>

        <!-- Frequency Adjustment Buttons -->
        <div class="freq-buttons">
          <button class="freq-btn" @click="$emit('adjFreq', 1000000)">+1M</button>
          <button class="freq-btn" @click="$emit('adjFreq', 100000)">+100K</button>
          <button class="freq-btn" @click="$emit('adjFreq', 10000)">+10K</button>
          <button class="freq-btn" @click="$emit('adjFreq', 1000)">+1K</button>
          <button class="freq-btn" @click="$emit('adjFreq', -1000000)">-1M</button>
          <button class="freq-btn" @click="$emit('adjFreq', -100000)">-100K</button>
          <button class="freq-btn" @click="$emit('adjFreq', -10000)">-10K</button>
          <button class="freq-btn" @click="$emit('adjFreq', -1000)">-1K</button>
        </div>

        <!-- PTT Button (Large & Prominent) -->
        <button class="ptt-button" :class="{tx: radio.ptt}" @mousedown="$emit('ptt', true)" @mouseup="$emit('ptt', false)" @mouseleave="$emit('ptt', false)" @touchstart="$emit('ptt', true)" @touchend="$emit('ptt', false)">
          {{ radio.ptt ? '🔴 TRANSMITTING' : '⚫ Push to Talk' }}
        </button>

        <!-- Radio Controls Section -->
        <div v-if="currentControls && currentControls.length" class="controls-section">
          <div class="section-header">
            <div class="section-title">Radio Controls</div>
            <button class="toggle-advanced" @click="showAllControls = !showAllControls">
              {{ showAllControls ? 'Hide' : 'More' }}
            </button>
          </div>

          <div v-if="showAllControls" class="control-tabs">
            <button v-for="grp in groupNames" 
                    :key="grp" 
                    class="control-tab"
                    :class="{active: controlTab === grp}"
                    @click="controlTab = grp">
              {{ grp }}
            </button>
          </div>

          <div v-if="showAllControls" class="control-grid">
            <div v-for="ctrl in controlGroups[controlTab]" :key="ctrl.id">
              <!-- Button Grid Control (no dropdown!) -->
              <div v-if="ctrl.kind === 'button-grid'" style="margin-bottom: 14px;">
                <label style="display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: #8b95aa;">{{ ctrl.label }}</label>
                <div style="display: grid; gap: 6px; grid-template-columns: repeat({{ ctrl.cols || 3 }}, 1fr);">
                  <button v-for="btn in ctrl.buttons" 
                          :key="btn.value"
                          @click="$emit('controlChange', ctrl, btn.value)"
                          :style="{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid ' + (controlValues[ctrl.id] === btn.value ? '#3a9eff' : '#1a3a6b'),
                            background: controlValues[ctrl.id] === btn.value ? 'rgba(58, 158, 255, 0.2)' : '#0a0e1a',
                            color: controlValues[ctrl.id] === btn.value ? '#3a9eff' : '#8b95aa',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '500',
                            transition: 'all 0.15s'
                          }"
                          @mouseover="$event.target.style.borderColor='#2a6aaa'"
                          @mouseout="$event.target.style.borderColor = (controlValues[ctrl.id] === btn.value ? '#3a9eff' : '#1a3a6b')">
                    {{ btn.label }}
                  </button>
                </div>
              </div>

              <!-- Toggle Control -->
              <div v-else-if="ctrl.kind === 'toggle'" class="control-toggle">
                <label>
                  <input type="checkbox" :checked="controlValues[ctrl.id]" @change="e => $emit('controlChange', ctrl, e.target.checked)" />
                  <span>{{ ctrl.label }}</span>
                </label>
              </div>

              <!-- Range Control -->
              <div v-else-if="ctrl.kind === 'range'" class="control-range">
                <label>{{ ctrl.label }}</label>
                <input type="range" 
                       :min="ctrl.min || 0" 
                       :max="ctrl.max || 255" 
                       :step="ctrl.step || 1" 
                       :value="controlValues[ctrl.id] || 0" 
                       @input="e => $emit('controlChange', ctrl, parseInt(e.target.value))" />
                <div class="control-range-value">{{ controlValues[ctrl.id] || 0 }}</div>
              </div>

              <!-- Number Control -->
              <div v-else-if="ctrl.kind === 'number'" class="control-number">
                <label>{{ ctrl.label }}</label>
                <input type="number" 
                       :step="ctrl.step || 0.001" 
                       :min="ctrl.min"
                       :max="ctrl.max"
                       :value="controlValues[ctrl.id] || 0" 
                       @change="e => $emit('controlChange', ctrl, parseFloat(e.target.value))" />
              </div>
            </div>
          </div>
        </div>

        <!-- Waterfall Section (Collapsible) -->
        <div style="margin-top: 20px; border-top: 1px solid #1a2847; padding-top: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; padding: 8px; background: #0a0e1a; border-radius: 4px;" @click="showWaterfall = !showWaterfall">
            <h3 style="margin: 0; font-size: 13px;">📊 Spectrum Waterfall</h3>
            <span style="color: #5a7a8b; font-size: 12px;">{{ showWaterfall ? '▼' : '▶' }}</span>
          </div>
          <div v-if="showWaterfall" style="margin-top: 12px;">
            <waterfall-panel :radio="radio"></waterfall-panel>
          </div>
        </div>
      </div>
      <div v-else style="text-align: center; padding: 80px 20px; color: #8b95aa;">
        <div style="font-size: 48px; margin-bottom: 16px;">📻</div>
        <p style="font-size: 16px; margin: 0;">No radio connected</p>
        <p style="font-size: 13px; margin: 8px 0 0 0; color: #5a7a8b;">Use settings to connect to your radio</p>
      </div>
    </div>
  `
};
