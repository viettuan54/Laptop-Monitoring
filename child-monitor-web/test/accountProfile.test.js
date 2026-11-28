const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, functionSource } = require('./dashboardSource');

for (const role of ['parent', 'admin']) {
  test(`${role} account menu renders the registered name safely instead of an ID`, () => {
    const app = { innerHTML: '' };
    const context = vm.createContext({
      state: { role, page: 'account', userId: 10, userName: 'Minh <Anh>' }, app, icons: {}, pageTitles: {},
      document: { body: { classList: { toggle() {} } } },
      brandMarkup: () => '', updateAlertIndicator() {}, alertCountLabel: String,
    });
    for (const fn of ['escapeHtml', 'navItem', 'mobileNavItem', 'renderShell']) {
      vm.runInContext(functionSource(source, fn), context);
    }
    context.renderShell();
    assert.match(app.innerHTML, /<small>Minh &lt;Anh&gt;<\/small>/);
    assert.doesNotMatch(app.innerHTML, /Mã người dùng|Mã #10/);
  });

  test(`${role} account displays the latest registered name instead of the user ID`, async () => {
    const requests = [];
    let name = 'Nguyễn Minh Anh';
    const content = { innerHTML: '' };
    const context = vm.createContext({
      state: { role, userId: 10, pushTokens: [] }, pageHead: () => '',
      api: async (url, options) => {
        requests.push({ url, options });
        return url === '/auth/me' ? { user_id: 10, name, role } : { data: [] };
      },
    });
    for (const fn of ['escapeHtml', 'pushPlatformOptions', 'renderAccount']) {
      vm.runInContext(functionSource(source, fn), context);
    }
    await context.renderAccount(content);
    assert.match(content.innerHTML, /Họ tên: Nguyễn Minh Anh/);
    assert.doesNotMatch(content.innerHTML, /Mã người dùng/);
    assert.equal(requests[0].url, '/auth/me');
    assert.equal(requests[0].options, undefined, 'profile uses the authenticated API defaults');
    name = '<img src=x onerror=alert(1)>';
    await context.renderAccount(content);
    assert.match(content.innerHTML, /Họ tên: &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(content.innerHTML, /<img src=x/);
    assert.doesNotMatch(content.innerHTML, /Nguyễn Minh Anh/);
  });
}
