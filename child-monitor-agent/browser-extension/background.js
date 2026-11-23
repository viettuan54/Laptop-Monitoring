importScripts('policy.js');
const controller = new SafeNestPolicy.PolicyController(chrome);
let port = null;
let serial = Promise.resolve();
function status(connected) {
  chrome.action.setBadgeText({text: connected ? '' : '!'});
  chrome.action.setBadgeBackgroundColor({color: '#a33324'});
  chrome.action.setTitle({title: connected
    ? 'LaptopChildren — chính sách đã áp dụng'
    : 'LaptopChildren — chưa kết nối Agent; giữ chính sách gần nhất'});
}
function apply(policy) {
  serial = serial.then(() => controller.apply(policy)).then(() => status(true)).catch(error => {
    console.error('SafeNest policy update failed:', error.message);
    status(false);
  });
}
function connect() {
  if (port) return;
  try {
    port = chrome.runtime.connectNative('vn.safenest.web_policy');
    port.onMessage.addListener(message => {
      if (message.web_policy) apply(message.web_policy);
      else status(false);
    });
    port.onDisconnect.addListener(() => {
      // Reading lastError prevents an unhandled runtime error on disconnect.
      console.warn('SafeNest bridge disconnected:', chrome.runtime.lastError?.message || 'closed');
      port = null;
      status(false);
      setTimeout(connect, 2000);
    });
    port.postMessage({action: 'watch'});
  } catch { port = null; status(false); }
}
chrome.tabs.onUpdated.addListener(id => {
  serial = serial.then(() => controller.enforceTab(id)).catch(() => status(false));
});
chrome.webNavigation.onCommitted.addListener(event => {
  if (event.frameId === 0) {
    serial = serial.then(() => controller.enforceTab(event.tabId)).catch(() => status(false));
  }
});
chrome.alarms.onAlarm.addListener(connect);
chrome.alarms.create('reconnect', {periodInMinutes: 1});
// Restore persistent rules/tab handling before accepting newer live snapshots.
serial = chrome.storage.local.get('webPolicy').then(async data => {
  if (data.webPolicy) await controller.apply(data.webPolicy);
}).catch(() => status(false));
serial.then(connect);
