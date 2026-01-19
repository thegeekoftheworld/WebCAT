// Radio Control Panel Component
window.RadioPanel = {
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
      controlTab: 'primary'
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
        <div class="freq-display">{{ displayFreq }}</div>
        <div class="mode-display">{{ radio.mode || 'N/A' }}</div>

        <div class="freq-buttons">
          <button class="freq-btn" @click="$emit('adjFreq', 10000000)">+10M</button>
          <button class="freq-btn" @click="$emit('adjFreq', 1000000)">+1M</button>
          <button class="freq-btn" @click="$emit('adjFreq', 100000)">+100K</button>
          <button class="freq-btn" @click="$emit('adjFreq', 10000)">+10K</button>
          <button class="freq-btn" @click="$emit('adjFreq', -10000000)">-10M</button>
          <button class="freq-btn" @click="$emit('adjFreq', -1000000)">-1M</button>
          <button class="freq-btn" @click="$emit('adjFreq', -100000)">-100K</button>
          <button class="freq-btn" @click="$emit('adjFreq', -10000)">-10K</button>
        </div>

        <!-- DEBUG: Show control count -->
        <div style="padding: 10px; margin: 10px 0; background: #1f2a3d; border-radius: 6px; font-size: 12px;">
          Controls: {{ (currentControls || []).length }} | Groups: {{ Object.keys(controlGroups).join(', ') || 'none' }}
        </div>

        <div v-if="currentControls && currentControls.length" style="margin: 20px 0;">
          <div style="display: flex; gap: 8px; margin-bottom: 12px; border-bottom: 1px solid #243045; padding-bottom: 8px;">
            <button v-for="grp in groupNames" :key="grp" 
                    @click="controlTab = grp"
                    style="padding: 6px 12px; border-radius: 6px; border: 1px solid #243045; cursor: pointer; text-transform: capitalize;"
                    :style="{background: controlTab === grp ? '#1f2a3d' : '#151b28', borderColor: controlTab === grp ? '#3a7bd5' : '#243045', color: '#e5e7f0'}">
              {{ grp }}
            </button>
          </div>

          <div v-for="grp in groupNames" :key="grp" v-show="controlTab === grp" class="control-group">
            <div v-for="ctrl in controlGroups[grp]" :key="ctrl.id" class="control-item">
              
              <div v-if="ctrl.kind === 'toggle'" class="control-toggle" style="margin-bottom: 14px;">
                <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px; background: #151b28; border: 1px solid #243045; border-radius: 6px;">
                  <input type="checkbox" :checked="controlValues[ctrl.id]" @change="e => $emit('controlChange', ctrl, e.target.checked)" style="width: 20px; height: 20px; cursor: pointer;" />
                  <span style="color: #e5e7f0; font-weight: 500;">{{ ctrl.label }}</span>
                </label>
              </div>

              <div v-else-if="ctrl.kind === 'select'" style="margin-bottom: 14px;">
                <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #9aa3b5;">{{ ctrl.label }}</label>
                <select :value="controlValues[ctrl.id]" @change="e => $emit('controlChange', ctrl, e.target.value)" 
                        style="width: 100%; padding: 10px; border: 1px solid #243045; border-radius: 6px; background: #0f1724; color: #e5e7f0;">
                  <option v-for="opt in ctrl.options" :key="opt.value" :value="opt.value" style="background: #0f1724; color: #e5e7f0;">
                    {{ opt.label }}
                  </option>
                </select>
              </div>

              <div v-else-if="ctrl.kind === 'range'" style="margin-bottom: 14px;">
                <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #9aa3b5;">
                  {{ ctrl.label }}: <span style="color: #3a7bd5;">{{ controlValues[ctrl.id] || 0 }}</span>
                </label>
                <input type="range" 
                       :min="ctrl.min || 0" 
                       :max="ctrl.max || 255" 
                       :step="ctrl.step || 1" 
                       :value="controlValues[ctrl.id] || 0" 
                       @input="e => $emit('controlChange', ctrl, parseInt(e.target.value))" 
                       style="width: 100%; cursor: pointer; height: 6px; background: #151b28; border-radius: 3px; outline: none;" />
              </div>

              <div v-else-if="ctrl.kind === 'number'" style="margin-bottom: 14px;">
                <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #9aa3b5;">{{ ctrl.label }}</label>
                <input type="number" 
                       :step="ctrl.step || 0.001" 
                       :min="ctrl.min"
                       :max="ctrl.max"
                       :value="controlValues[ctrl.id] || 0" 
                       @change="e => $emit('controlChange', ctrl, parseFloat(e.target.value))" 
                       style="width: 100%; padding: 10px; border: 1px solid #243045; border-radius: 6px; background: #0f1724; color: #e5e7f0;" />
              </div>
            </div>
          </div>
        </div>

        <button class="ptt-button" :class="{tx: radio.ptt}" @mousedown="$emit('ptt', true)" @mouseup="$emit('ptt', false)" @mouseleave="$emit('ptt', false)" @touchstart="$emit('ptt', true)" @touchend="$emit('ptt', false)">
          {{ radio.ptt ? 'TX' : 'PTT' }}
        </button>
      </div>
      <div v-else style="text-align: center; padding: 60px; color: #999;">
        <p style="font-size: 16px;">No radio connected</p>
      </div>
    </div>
  `
};
