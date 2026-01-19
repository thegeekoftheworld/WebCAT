// Lightweight browser MQTT shim to connect to local broker over WebSocket
// Exposes window.MQTTBus with publish/subscribe helpers.
(function(){
  const Bus = { client: null, connected: false, subscriptions: new Map() };

  function init(){
    if (!window.mqtt) {
      console.warn('MQTT shim: mqtt.js not present; skipping connect');
      return;
    }
    const loc = window.location;
    const host = loc.hostname || 'localhost';
    const port = loc.port || '8080';
    const url = `ws://${host}:${port}/mqtt`;

    const clientId = `webcat-${Math.random().toString(16).slice(2)}`;
    const opts = { clientId, keepalive: 30, reconnectPeriod: 2000 }; 
    const client = window.mqtt.connect(url, opts);
    Bus.client = client;

    client.on('connect', () => {
      Bus.connected = true;
      console.log('[MQTT] connected', url);
      // Resubscribe
      for (const topic of Bus.subscriptions.keys()) client.subscribe(topic);
      // Announce presence
      Bus.publish('webcat/presence', { clientId, ts: Date.now() });
    });

    client.on('reconnect', () => console.log('[MQTT] reconnecting...'));
    client.on('close', () => { Bus.connected = false; console.log('[MQTT] closed'); });
    client.on('error', (e) => console.warn('[MQTT] error', e?.message||e));

    client.on('message', (topic, payload) => {
      let data = payload;
      try { data = JSON.parse(String(payload)); } catch {}
      // Local handlers
      const handlers = Bus.subscriptions.get(topic);
      if (handlers) handlers.forEach(fn => { try { fn(data, topic); } catch {} });
      // Global DOM event
      window.dispatchEvent(new CustomEvent('mqtt:message', { detail: { topic, data } }));
    });
  }

  Bus.publish = function(topic, obj){
    try {
      if (!Bus.client || !Bus.connected) return;
      const payload = (typeof obj === 'string' || obj instanceof ArrayBuffer) ? obj : JSON.stringify(obj);
      Bus.client.publish(topic, payload);
    } catch (e) {
      console.warn('MQTT publish failed', e);
    }
  };

  Bus.subscribe = function(topic, handler){
    if (!Bus.subscriptions.has(topic)) Bus.subscriptions.set(topic, new Set());
    Bus.subscriptions.get(topic).add(handler);
    if (Bus.client && Bus.connected) Bus.client.subscribe(topic);
    return () => {
      const set = Bus.subscriptions.get(topic);
      if (set) set.delete(handler);
    };
  };

  window.MQTTBus = Bus;
  // Kick off after DOM loaded to allow mqtt.js CDN to load first
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
