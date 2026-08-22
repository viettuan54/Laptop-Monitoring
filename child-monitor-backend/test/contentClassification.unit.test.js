const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyAppWithGemini,
  classifyWebDomainWithGemini,
  normalizeAppContext,
  normalizeDomain,
} = require('../src/services/contentClassification.service');


test('domain normalization accepts a hostname but rejects URL data', () => {
  assert.equal(normalizeDomain(' WWW.YouTube.com. '), 'youtube.com');
  assert.throws(() => normalizeDomain('https://youtube.com/watch?v=1'), /URL components/);
  assert.throws(() => normalizeDomain('youtube.com/path'), /URL components/);
});

test('Gemini fallback receives only the normalized domain and validates taxonomy', async () => {
  let request;
  const aiClient = {
    models: {
      generateContent: async (value) => {
        request = value;
        return { text: JSON.stringify({ label: 'entertainment' }) };
      },
    },
  };

  const result = await classifyWebDomainWithGemini('www.youtube.com', {
    aiClient,
    modelId: 'gemini-test',
  });

  assert.deepEqual(result, {
    domain: 'youtube.com',
    category: 'entertainment',
    source: 'gemini',
  });
  const prompt = request.contents[0].parts[0].text;
  assert.match(prompt, /Domain: youtube\.com/);
  assert.doesNotMatch(prompt, /watch\?|page title|browser history/i);
});

test('Gemini fallback rejects labels outside the website taxonomy', async () => {
  const aiClient = {
    models: {
      generateContent: async () => ({ text: JSON.stringify({ label: 'browsers' }) }),
    },
  };
  await assert.rejects(
    classifyWebDomainWithGemini('example.com', { aiClient }),
    /outside the web taxonomy/
  );
});

test('app context accepts only executable identity metadata, never paths or control data', () => {
  assert.deepEqual(normalizeAppContext({
    app_name: ' STUDY.EXE ',
    product_name: ' Study / Classroom ',
    file_description: 'Learning utility',
  }), {
    app_name: 'study.exe',
    product_name: 'Study Classroom',
    file_description: 'Learning utility',
  });
  assert.throws(
    () => normalizeAppContext({ app_name: 'C:\\Apps\\study.exe' }),
    /file name/
  );
  assert.throws(
    () => normalizeAppContext({ app_name: 'study.exe', product_name: 'bad\nname' }),
    /invalid characters/
  );
  assert.throws(
    () => normalizeAppContext({ app_name: 'study.exe', product_name: 'C:\\Apps\\Study' }),
    /must not contain a path/
  );
});

test('Gemini app fallback receives only bounded executable metadata and validates taxonomy', async () => {
  let request;
  const aiClient = {
    models: {
      generateContent: async (value) => {
        request = value;
        return { text: JSON.stringify({ label: 'learning' }) };
      },
    },
  };

  const result = await classifyAppWithGemini({
    app_name: 'STUDY.EXE',
    product_name: 'Study Classroom',
    file_description: 'Learning utility',
  }, { aiClient, modelId: 'gemini-test' });

  assert.equal(result.app_name, 'study.exe');
  assert.equal(result.category, 'learning');
  assert.equal(result.source, 'gemini');
  const prompt = request.contents[0].parts[0].text;
  assert.match(prompt, /Executable: study\.exe/);
  assert.match(prompt, /Product name: Study Classroom/);
  assert.doesNotMatch(prompt, /window title|document|URL/i);
});

test('Gemini app fallback rejects labels outside the app taxonomy', async () => {
  const aiClient = {
    models: {
      generateContent: async () => ({ text: JSON.stringify({ label: 'social' }) }),
    },
  };
  await assert.rejects(
    classifyAppWithGemini({ app_name: 'chat.exe' }, { aiClient }),
    /outside the app taxonomy/
  );
});
