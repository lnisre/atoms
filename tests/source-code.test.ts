import assert from 'node:assert/strict';
import test from 'node:test';
import { findSourceMatches, highlightSource } from '../src/lib/source-code';

test('源码显示保留原始字符、换行与末尾空行，未知语言和空文本可读', () => {
  for (const path of ['index.html', 'main.css', 'main.js', 'main.ts', 'view.tsx', 'data.json', 'README.md', 'script.py', 'run.sh', 'config.yml', 'unknown.file']) {
    for (const text of ['', '\n', '\r\n', '<script>"&lt;😀中文"</script>\r\n\tconst x = 1;\n\n', 'a'.repeat(10_000)]) {
      const lines = highlightSource(path, text);
      assert.equal(lines.map(line => line.tokens.map(token => token.text).join('') + line.ending).join(''), text, path);
      for (const token of lines.flatMap(line => line.tokens)) assert.equal(text.slice(token.start, token.start + token.text.length), token.text);
      assert.equal(lines.length, text.split(/\r\n|\r|\n/).length);
    }
  }
});

test('当前文件搜索按文本、不区分大小写，Unicode 与正则特殊符号的范围正确', () => {
  assert.deepEqual(findSourceMatches('A.a a.A', 'a.a'), [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.deepEqual(findSourceMatches('😀 İ 中 [.*] 中', '[.*]'), [{ start: 7, end: 11 }]);
  assert.deepEqual(findSourceMatches('😀 İ 中 [.*] 中', '中'), [{ start: 5, end: 6 }, { start: 12, end: 13 }]);
  assert.deepEqual(findSourceMatches('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(findSourceMatches('anything', ''), []);
  assert.deepEqual(findSourceMatches('', 'anything'), []);
});
