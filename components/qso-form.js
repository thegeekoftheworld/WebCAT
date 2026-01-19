// QSO Logging Component
window.QSOForm = {
  props: ['qso', 'qsos', 'stats', 'isDupe', 'radio'],
  emits: ['checkDupe', 'logQSO'],
  template: `
    <div>
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
          <div class="label">Bands</div>
        </div>
      </div>

      <h3 style="margin-bottom: 15px;">New Contact</h3>
      <div class="qso-form">
        <div class="form-group">
          <label>Callsign</label>
          <input v-model="qso.call" @input="$emit('checkDupe')" placeholder="W1AW" style="text-transform: uppercase;" />
          <span v-if="isDupe" class="dupe-warning">DUPE!</span>
        </div>
        <div class="form-group">
          <label>Freq (Hz)</label>
          <input type="number" v-model.number="qso.freq" :value="radio.freq || qso.freq" />
        </div>
        <div class="form-group">
          <label>Mode</label>
          <input v-model="qso.mode" :value="radio.mode || qso.mode" placeholder="SSB" />
        </div>
        <div class="form-group">
          <label>RST Sent</label>
          <input v-model="qso.rst_sent" placeholder="59" />
        </div>
        <div class="form-group">
          <label>RST Rcvd</label>
          <input v-model="qso.rst_rcvd" placeholder="59" />
        </div>
        <div class="form-group">
          <label>Operator</label>
          <input v-model="qso.operator" placeholder="K1ABC" />
        </div>
      </div>
      <button class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 16px;" @click="$emit('logQSO')">📝 Log Contact</button>

      <h3 style="margin: 30px 0 15px;">Recent QSOs</h3>
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
            <td>{{ formatTime(q.timestamp) }}</td>
            <td><strong>{{ q.call }}</strong></td>
            <td>{{ formatFreq(q.freq) }}</td>
            <td>{{ q.mode }}</td>
            <td>{{ q.rst_sent }}/{{ q.rst_rcvd }}</td>
            <td>{{ q.operator }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `,
  methods: {
    formatTime(ts) {
      return new Date(ts).toLocaleTimeString();
    },
    formatFreq(f) {
      return (f / 1000000).toFixed(3) + ' MHz';
    }
  }
};
