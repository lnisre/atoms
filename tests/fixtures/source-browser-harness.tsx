import { createRoot } from 'react-dom/client';
import { ResultViewer } from '../../src/components/result-viewer';
import { syntheticSourceVersion } from './source-browser-files';
import '../../src/app/design-tokens.css';
import './source-browser-harness.css';

createRoot(document.getElementById('root')!).render(<>
  <h1>合成多文件查看器验收 · 不代表真实多文件生成或运行</h1>
  <main>
    <aside><label>测试对话输入<textarea aria-label="测试对话输入" /></label></aside>
    <ResultViewer version={syntheticSourceVersion} status="合成样例">
      <p>隔离的查看器承载页。使用生产组件的公开文件集合输入。</p>
    </ResultViewer>
  </main>
</>);
