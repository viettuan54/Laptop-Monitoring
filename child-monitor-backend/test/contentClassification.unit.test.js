const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyWebDomainWithGemini,
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
