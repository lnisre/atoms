import type { SourceVersion } from '../../src/components/source-browser';

// Explicit synthetic input to the viewer; never a production project or response.
export const syntheticSourceVersion: SourceVersion = {
  id: 'synthetic-files-t1',
  entryPath: 'index.html',
  files: [
    { path: 'index.html', text: '<h1>合成入口</h1>\n<script>document.body.dataset.sourceExecuted="yes"</script>\n<img src="/never-fetch-from-source" onerror="alert(1)">' },
    { path: 'src/main.ts', text: Array.from({ length: 180 }, (_, i) => `// 合成长源码 ${i + 1}`).join('\n') },
    { path: 'src/components/header/index.ts', text: 'export const label = "页头同名文件";' },
    { path: 'src/components/footer/index.ts', text: 'export const label = "页脚同名文件";' },
    { path: 'docs/这是用于验证项目内完整路径的很长目录/深层说明与空文件/empty.txt', text: '' },
    { path: 'styles/main.css', text: 'body { color: #202020; }' },
    { path: 'data/example.json', text: '{"synthetic": true}' },
    { path: 'README.md', text: '# 合成多文件样例\n只验证查看器，不代表平台支持多文件生成。' },
  ],
};
