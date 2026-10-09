import type { SourceVersion } from '../../src/components/source-browser';

export const sourceReadingVersion: SourceVersion = {
  id: 'synthetic-reading-t2',
  entryPath: 'index.html',
  files: [
    { path: 'index.html', text: '<!doctype html>\r\n<style>body { color: red; }</style>\r\n<h1 title="A&B">find.me &lt; & 中文</h1>\r\n<script>document.body.dataset.sourceExecuted="yes";</script>\r\n\t<!-- find.me -->\r\n' },
    { path: 'one/index.ts', text: 'export const value = "find.me";\n' + Array.from({ length: 90 }, (_, i) => `// line ${i + 2}`).join('\n') + '\n' + ' '.repeat(240) + 'const last = "FIND.ME";\n' },
    { path: 'two/index.ts', text: 'export const value = "no matching text";' },
    { path: 'empty.txt', text: '' },
    { path: 'notes.unknown', text: '<img src="/must-not-load" onerror="alert(1)">\n😀 İ 中文 find.me [.*] <script>throw 1</script>\n' },
  ],
};
