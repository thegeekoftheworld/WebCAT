/* WebCAT Waterfall/Spectrum Display Component */
const WaterfallPanel = {
  template: `
    <div class="waterfall-container">
      <div class="waterfall-header">
        <h3>Spectrum Waterfall</h3>
        <div class="waterfall-controls">
          <label>
            <input type="checkbox" v-model="autoScroll" /> Auto Scroll
          </label>
          <label>
            <input type="checkbox" v-model="paused" /> Pause
          </label>
          <button @click="clearWaterfall" class="btn-small">Clear</button>
          <label>
            Update: <input type="range" v-model.number="updateInterval" min="100" max="2000" step="100" />
            {{ updateInterval }}ms
          </label>
        </div>
      </div>
      
      <canvas 
        ref="waterfallCanvas" 
        class="waterfall-canvas"
        :width="canvasWidth"
        :height="canvasHeight"
      ></canvas>
      
      <div class="waterfall-scale">
        <div class="scale-labels">
          <span>0 dB</span>
          <span>-50 dB</span>
          <span>-100 dB</span>
        </div>
      </div>
    </div>
  `,
  
  props: ['radio'],
  
  data() {
    return {
      waterfallHistory: [],  // Array of [data1, data2, ...] rows
      autoScroll: true,
      paused: false,
      updateInterval: 500,
      canvasWidth: 800,
      canvasHeight: 300,
      pollTimer: null,
      maxHistory: 300,  // Max rows to keep in memory
      colorMap: this.createColorMap()
    };
  },
  
  computed: {
    isConnected() {
      return this.radio && this.radio.driver;
    }
  },
  
  methods: {
    createColorMap() {
      // Gradient from dark blue (weak) to bright yellow (strong)
      // Maps 0-255 (raw ADC values) to RGB colors
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      
      const gradient = ctx.createLinearGradient(0, 0, 256, 0);
      gradient.addColorStop(0, '#000033');      // Very dark blue (noise)
      gradient.addColorStop(0.1, '#0000FF');    // Blue
      gradient.addColorStop(0.3, '#00FF00');    // Green
      gradient.addColorStop(0.6, '#FFFF00');    // Yellow
      gradient.addColorStop(0.9, '#FF6600');    // Orange
      gradient.addColorStop(1, '#FF0000');      // Red (strong signal)
      
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 1);
      
      const imageData = ctx.getImageData(0, 0, 256, 1);
      return imageData.data;  // Flat array of RGBA values
    },
    
    async pollWaterfall() {
      if (!this.isConnected || this.paused) return;
      
      try {
        const cmd = this.radio.driver.cmdReadWaterfall();
        await this.radio.sendCommand(cmd);
      } catch (e) {
        console.error('Waterfall poll error:', e);
      }
    },
    
    onWaterfallData(rawData) {
      if (this.paused) return;
      
      // Convert raw bytes to array of values 0-100 (dB scale)
      // IC-7300 returns raw ADC values, normalize to 0-100
      const normalized = Array.from(rawData).map(v => {
        // 0-255 raw → 0-100 dB scale (inverse: high ADC = weak signal)
        return Math.round((v / 255) * 100);
      });
      
      this.waterfallHistory.push(normalized);
      
      // Trim old data if exceeds max history
      if (this.waterfallHistory.length > this.maxHistory) {
        this.waterfallHistory.shift();
      }
      
      this.$nextTick(() => this.drawWaterfall());
    },
    
    drawWaterfall() {
      const canvas = this.$refs.waterfallCanvas;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const { width, height } = canvas;
      
      // Clear canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      
      if (this.waterfallHistory.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for waterfall data...', width / 2, height / 2);
        return;
      }
      
      // Draw waterfall rows
      const rowHeight = height / this.waterfallHistory.length;
      const colWidth = width / 101;  // IC-7300 returns 101 frequency points
      
      for (let rowIdx = 0; rowIdx < this.waterfallHistory.length; rowIdx++) {
        const row = this.waterfallHistory[rowIdx];
        const y = rowIdx * rowHeight;
        
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const val = row[colIdx];  // 0-100 dB
          const x = colIdx * colWidth;
          
          // Map dB value to color
          // 0 dB (weak) = dark, 100 dB (strong) = bright
          const colorIdx = Math.min(255, Math.round((val / 100) * 255)) * 4;
          const r = this.colorMap[colorIdx];
          const g = this.colorMap[colorIdx + 1];
          const b = this.colorMap[colorIdx + 2];
          
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x, y, colWidth, rowHeight);
        }
      }
      
      // Draw frequency labels (center, left, right)
      ctx.fillStyle = '#AAA';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Center', width / 2, height - 5);
      ctx.textAlign = 'left';
      ctx.fillText('-3kHz', 5, height - 5);
      ctx.textAlign = 'right';
      ctx.fillText('+3kHz', width - 5, height - 5);
    },
    
    clearWaterfall() {
      this.waterfallHistory = [];
      this.$nextTick(() => this.drawWaterfall());
    }
  },
  
  mounted() {
    if (this.radio) {
      // Listen for waterfall data events from radio
      this.radio.addEventListener('waterfall', (e) => {
        this.onWaterfallData(e.detail);
      });
    }
    
    // Start polling for waterfall data
    this.pollTimer = setInterval(() => {
      this.pollWaterfall();
    }, this.updateInterval);
    
    // Draw initial canvas
    this.$nextTick(() => this.drawWaterfall());
  },
  
  beforeUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.radio) {
      this.radio.removeEventListener('waterfall');
    }
  },
  
  watch: {
    updateInterval() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => {
        this.pollWaterfall();
      }, this.updateInterval);
    }
  }
};
