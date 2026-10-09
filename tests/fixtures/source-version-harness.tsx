import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResultViewer } from '../../src/components/result-viewer';
import type { SourceVersion } from '../../src/components/source-browser';
import { syntheticSourceVersion } from './source-browser-files';
import '../../src/app/design-tokens.css';
import './source-browser-harness.css';

const longText = (label: string, length: number) => Array.from({ length }, (_, i) => `${label} ${i + 1} ${'合成源码 '.repeat(45)}`).join('\n');
const initial: SourceVersion = {
  ...syntheticSourceVersion,
  files: syntheticSourceVersion.files.map(file => file.path === 'index.html' || file.path === 'src/main.ts' ? { ...file, text: longText(file.path, 180) } : file),
};
const updated: SourceVersion = {
  ...initial,
  id: 'synthetic-updated',
  files: [...initial.files.map(file => file.path === 'src/main.ts' ? { ...file, text: longText('新候选内容', 180) } : file), { path: 'new/added.txt', text: '新版本新增的合成文件' }],
};
const shortened: SourceVersion = {
  ...updated,
  id: 'synthetic-shortened',
  files: updated.files.map(file => file.path === 'src/main.ts' ? { ...file, text: '缩短后的新源码' } : file),
};
const removed: SourceVersion = {
  id: 'synthetic-removed',
  entryPath: 'app/start.html',
  files: [...updated.files.filter(file => !file.path.startsWith('src/')), { path: 'app/start.html', text: '<h1>新入口 · 合成输入</h1>' }],
};

function Harness() {
  const [version, setVersion] = useState(initial);
  return <>
    <h1>合成版本更新 · 仅验证公开查看器输入，不代表多文件生成或运行</h1>
    <main>
      <aside>
        <label>测试对话输入<textarea aria-label="测试对话输入" /></label>
        <button onClick={() => setVersion(updated)}>合成更新</button>
        <button onClick={() => setVersion(shortened)}>合成缩短</button>
        <button onClick={() => setVersion(removed)}>合成移除</button>
        <button onClick={() => setVersion(initial)}>合成恢复</button>
      </aside>
      <ResultViewer version={version} status="合成版本 · 未采用">
        <p>合成预览版本：{version.id}</p>
      </ResultViewer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
