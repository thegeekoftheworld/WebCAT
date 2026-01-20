// QSO Logging Component
window.QSOForm = {
  props: ['qso', 'qsos', 'stats', 'isDupe', 'radio'],
  emits: ['checkDupe', 'logQSO'],
  template: `
    <div>
      <!-- Stats Row -->
      <div class="stats">
        <div class="stat">
          <div class="value">{{ stats.total }}</div>
          <div class="label">Total QSOs</div>
        </div>
        <div class="stat">
          <div class="value">{{ stats.today }}</div>
          <div class="label">Today</div>
        </div>
        <div class="stat">
          <div class="value">{{ stats.bands }}</div>
          <div class="label">Bands Worked</div>
        </div>
      </div>

      <!-- New Contact Form -->
      <h3 style="margin-bottom: 12px;">📝 New Contact</h3>
      <div class="qso-form">
        <div class="form-group" style="grid-column: span 2; @media (max-width: 800px) { grid-column: span 1; }">
          <label>Callsign <span style="color: #ff6b6b;">*</span></label>
          <input v-model="qso.call" @input="$emit('checkDupe')" placeholder="W1AW" style="text-transform: uppercase; font-size: 16px; font-weight: 600;" />
          <span v-if="isDupe" class="dupe-warning">⚠️ DUPE!</span>
        </div>
        <div class="form-group">
          <label>Frequency</label>
          <input type="number" v-model.number="qso.freq" :value="radio.freq || qso.freq" placeholder="Hz" />
        </div>
        <div class="form-group">
          <label>Mode</label>
          <input v-model="qso.mode" :value="radio.mode || qso.mode" placeholder="SSB/CW/FT8" style="text-transform: uppercase;" />
        </div>
        <div class="form-group">
          <label>RST Sent</label>
          <input v-model="qso.rst_sent" placeholder="599" style="text-align: center; font-weight: 600; font-size: 14px;" />
        </div>
        <div class="form-group">
          <label>RST Rcvd</label>
          <input v-model="qso.rst_rcvd" placeholder="599" style="text-align: center; font-weight: 600; font-size: 14px;" />
        </div>
        <div class="form-group">
          <label>Operator</label>
          <input v-model="qso.operator" placeholder="K1ABC" style="text-transform: uppercase;" />
        </div>
      </div>

      <button class="btn btn-primary" style="width: 100%; padding: 14px; font-size: 15px; font-weight: 600; margin-bottom: 24px;" @click="$emit('logQSO')">📝 Log Contact</button>

      <!-- Recent QSOs -->
      <h3 style="margin-bottom: 12px;">📋 Recent QSOs</h3>
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Call</th>
              <th>Freq</th>
              <th>Mode</th>
              <th>RST</th>
              <th>Op</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in qsos" :key="q.id">
              <td style="font-size: 12px;">{{ formatTime(q.timestamp) }}</td>
              <td><strong style="font-size: 14px;">{{ q.call }}</strong></td>
              <td style="font-size: 12px;">{{ formatFreq(q.freq) }}</td>
              <td style="font-size: 12px; text-transform: uppercase;">{{ q.mode }}</td>
              <td style="font-size: 12px;">{{ q.rst_sent }}/{{ q.rst_rcvd }}</td>
              <td style="font-size: 12px;">{{ q.operator }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  methods: {
    formatTime(ts) {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    },
    formatFreq(f) {
      return (f / 1000000).toFixed(3) + ' MHz';
    }
  }
};
