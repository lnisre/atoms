import { createRoot } from 'react-dom/client';
import { ResultViewer } from '../../src/components/result-viewer';
import { sourceReadingVersion } from './source-reading-files';
import '../../src/app/design-tokens.css';
import './source-browser-harness.css';

createRoot(document.getElementById('root')!).render(<>
  <h1>T2 合成文件阅读检查 · 不代表生产多文件生成或运行</h1>
  <main>
    <aside><label>测试对话输入<textarea aria-label="测试对话输入" /></label></aside>
    <ResultViewer version={sourceReadingVersion} status="合成样例">
      <iframe title="合成预览" srcDoc={'<label>应用输入<input aria-label="应用输入"></label><output id="instance"></output><script>document.querySelector("output").textContent=crypto.randomUUID()</script>'} />
    </ResultViewer>
  </main>
</>);
