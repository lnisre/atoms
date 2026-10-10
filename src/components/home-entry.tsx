import { useRef, type ReactNode } from "react";
import { MAX_REQUIREMENT_LENGTH } from "@/lib/generation";
import type { SavedProject } from "@/lib/project-store";
import styles from "./home-entry.module.css";

export type HomeView = "home" | "projects";
type IconName = "home" | "compass" | "projects" | "plus" | "arrow" | "chevron" | "panel" | "gift" | "diamond" | "settings" | "bell" | "mic" | "plug" | "grid" | "search" | "star";
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
  compass: <><circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/></>,
  projects: <><rect x="4" y="7" width="16" height="14" rx="3"/><path d="M7 3h10M4 11h16"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M12 19V5m-6 6 6-6 6 6"/>,
  chevron: <path d="m8 10 4 4 4-4"/>, panel: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></>,
  gift: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M3 7h18v4H3zM12 7v14M12 7C3 8 5 1 8 3Zm0 0c9 1 7-6 4-4Z"/></>,
  diamond: <><path d="m8 3-6 7 10 11 10-11-6-7ZM2 10h20M8 3l4 18 4-18"/></>,
  settings: <><path d="m8 3-5 9 5 9h8l5-9-5-9Z"/><circle cx="12" cy="12" r="3"/></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 8 3 8 3 9H3c0-1 3-1 3-9M10 21h4"/></>,
  mic: <><path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4"/></>,
  plug: <><path d="m7 3 5 5m0-6 5 5M5 8l3-3 11 11-3 3a6 6 0 0 1-8 0L5 16a6 6 0 0 1 0-8Zm0 11-3 3"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  search: <><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
  star: <path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>,
};
function Icon({ name }: { name: IconName }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Mark() {
  return <svg width="24" height="26" viewBox="0 0 28 30" fill="currentColor" aria-hidden="true"><path d="M16 2C8 0 0 10 3 18c6 3 14-5 13-16ZM19 5c-2 5 0 11 6 12 3-5 0-10-6-12ZM16 19c-5 1-7 4-5 8 7 3 12-1 12-6-2-2-4-3-7-2ZM3 23c0 4 3 6 6 5l-1-5Z"/></svg>;
}
function Unavailable({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) {
  return <button type="button" disabled title={`${label}：当前未提供`} aria-label={`${label}（当前未提供）`} className={className}>{children}</button>;
}
// Independent decorative vector mascots, not account avatars or claims of multiple agents.
function Avatars() {
  const colors = ["#ebac60", "#edca67", "#a49e8a", "#e998b7", "#8792c5", "#80b4e8", "#90c99d", "#b99ada"];
  return <div className={styles.avatars} aria-label="装饰头像插画">
    {colors.map((color, i) => <svg key={color} viewBox="0 0 48 52" aria-hidden="true">
      <defs><radialGradient id={`avatar-${i}`} cx="35%" cy="25%" r="80%"><stop stopColor="white" stopOpacity=".8"/><stop offset=".5" stopColor={color}/><stop offset="1" stopColor={color} stopOpacity=".7"/></radialGradient></defs>
      <ellipse cx="24" cy="27" rx="22" ry="24" fill={`url(#avatar-${i})`}/>
      <ellipse cx="24" cy="30" rx="16" ry="17" fill="#fff8ed" opacity=".85"/>
      <path d={i % 2 ? "M8 22Q8 5 26 9Q38 7 40 25L29 15 23 22 17 17Z" : "M8 22Q10 5 25 9Q38 9 40 22L27 15 14 23Z"} fill={i === 5 ? "#4683c4" : i === 7 ? "#7354a3" : "#746455"}/>
      <ellipse cx="18" cy="29" rx="2" ry="2.5" fill="#383332"/><ellipse cx="30" cy="29" rx="2" ry="2.5" fill="#383332"/>
      <path d="M22 37q3 2 5-1" fill="none" stroke="#ac7569" strokeWidth="1.5" strokeLinecap="round"/>
      {i === 0 && <path d="M11 26h12v6H11Zm14 0h12v6H25ZM23 28h2" fill="#57463d"/>}
      {i === 4 && <path d="M12 37q12 9 23-1v9H14Z" fill="#515660"/>}
      {i === 5 && <g fill="none" stroke="#44699a"><circle cx="17" cy="29" r="5"/><circle cx="31" cy="29" r="5"/><path d="M22 28h4"/></g>}
    </svg>)}
  </div>;
}

type Props = {
  accountSlot?: ReactNode;
  onOpenExample?: () => void;
  view: HomeView;
  onViewChange: (view: HomeView) => void;
  requirement: string;
  onRequirementChange: (value: string) => void;
  projects: SavedProject[];
  loadingProjects: boolean;
  listError: string;
  exampleError: string;
  onRetryProjects: () => void;
  examples: { name: string; text: string }[];
  onOpenProject: (project: SavedProject) => void;
  onGenerate: () => void;
};
export function HomeEntry({ accountSlot, onOpenExample, view, onViewChange, requirement, onRequirementChange, projects, loadingProjects, listError, exampleError, onRetryProjects, examples, onOpenProject, onGenerate }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const main = useRef<HTMLElement>(null);
  function changeView(next: HomeView) {
    onViewChange(next);
    main.current?.scrollTo(0, 0);
  }
  return <div className={styles.shell}>
    <aside className={styles.sidebar} aria-label="侧栏">
      <div className={styles.brandRow}><button className={styles.brand} onClick={() => changeView("home")} aria-label="Atoms 首页"><Mark/><strong>Atoms</strong><span>Demo</span></button><Unavailable label="收起侧栏" className={styles.iconButton}><Icon name="panel"/></Unavailable></div>
      <Unavailable label="切换工作区" className={styles.workspace}><span className={styles.workspaceAvatar}>A</span><span>个人工作区</span><Icon name="chevron"/></Unavailable>
      <nav className={styles.navigation} aria-label="主导航">
        <button aria-current={view === "home" ? "page" : undefined} onClick={() => changeView("home")}><Icon name="home"/>首页</button>
        <Unavailable label="资源"><Icon name="compass"/>资源<small>未提供</small></Unavailable>
        <button aria-current={view === "projects" ? "page" : undefined} onClick={() => changeView("projects")}><Icon name="projects"/>我的项目</button>
      </nav>
      <section className={styles.recent} aria-label="最近项目"><h2>最近</h2>
        {projects.slice(0, 5).map(project => <button key={project.id} title={project.title} onClick={() => onOpenProject(project)}>{project.title}</button>)}
        {!loadingProjects && !listError && projects.length === 0 && <p>还没有已保存的项目</p>}
      </section>
      <div className={styles.sidebarBottom}>
        <Unavailable label="升级到 Pro" className={styles.offer}><Icon name="diamond"/><span>升级到 Pro<small>当前未提供</small></span><span>›</span></Unavailable>
        <Unavailable label="获取免费积分" className={styles.offer}><Icon name="gift"/><span>获取免费积分<small>当前未提供</small></span><span>›</span></Unavailable>
        <div className={styles.account}>{accountSlot}</div>
      </div>
    </aside>
    <main className={styles.main} ref={main}>
      <div className={styles.banner}>从一个想法开始，构建你的轻量应用。<span>账号私有项目</span></div>
      <div className={styles.topActions}><Unavailable label="积分余额" className={styles.balance}><Icon name="diamond"/>积分 · 未提供</Unavailable></div>
      <div hidden={view !== "home"}>
        <section className={styles.hero} aria-label="创建应用">
          <div className={styles.notice}>Atoms Demo <span>·</span> 先看示例，登录后创建自己的项目</div>
          <Avatars/>
          <h1>你好，你想创造什么？</h1>
          <div className={styles.composerGroup}>
            <form className={styles.composer} onSubmit={event => { event.preventDefault(); if (requirement.trim() && !loadingProjects) onGenerate(); }}>
              <label htmlFor="requirement" className={styles.srOnly}>你想做什么？</label>
              <textarea ref={input} id="requirement" value={requirement} onChange={event => onRequirementChange(event.target.value)} maxLength={MAX_REQUIREMENT_LENGTH} placeholder="描述你想创建的应用，让想法开始成形…" required/>
              <div className={styles.composerFooter}>
                <Unavailable label="添加附件" className={styles.roundButton}><Icon name="plus"/></Unavailable>
                <span className={styles.inputHint}>轻量前端应用{requirement.length > 0 && <span> · {requirement.length}/{MAX_REQUIREMENT_LENGTH}</span>}</span>
                <Unavailable label="切换构建模式" className={styles.mode}>构建<Icon name="chevron"/></Unavailable>
                <Unavailable label="语音输入" className={styles.roundButton}><Icon name="mic"/></Unavailable>
                <button className={styles.send} type="submit" aria-label="开始生成" title="开始生成" disabled={!requirement.trim() || loadingProjects}><Icon name="arrow"/></button>
              </div>
            </form>
            <Unavailable label="连接外部工具" className={styles.connector}><Icon name="plug"/><span>将你的工具连接到 Atoms</span><small>当前未提供</small><span aria-hidden="true">＋</span></Unavailable>
          </div>
          <div className={styles.examples}><span>试试这些想法</span>{examples.map(example => <button key={example.name} type="button" onClick={() => { onRequirementChange(example.text); input.current?.focus(); }}>{example.name}<span aria-hidden="true">↗</span></button>)}</div>
          <div className={styles.homeNotes}><p>灰色控件当前未提供。头像仅为装饰，不代表多智能体执行。</p><details><summary>保存与恢复范围</summary><p>示例只读。登录后通过明确操作创建自己的项目；旧浏览器项目不会自动导入或删除。</p></details></div>
        </section>
      </div>
      {onOpenExample && <section className={styles.projects} aria-label="只读示例"><h2>看看示例</h2><p>查看小费计算器的界面与制作说明。编辑前需登录并保存个人副本。</p><button className="secondary-button" onClick={onOpenExample}>查看只读示例</button></section>}
      <section className={`${styles.projects} ${view === "home" ? styles.homeProjects : styles.allProjects}`} aria-label="已有项目" id="projects">
        {view === "projects" ? <><h1>我的项目</h1><div className={styles.projectToolbar}><span className={styles.selectedTab}>全部 <small>{projects.length}</small></span><Unavailable label="已收藏">已收藏</Unavailable><span className={styles.toolbarSpacer}/><Unavailable label="搜索项目" className={styles.search}><Icon name="search"/>搜索项目 · 未提供</Unavailable><Unavailable label="切换项目视图" className={styles.iconButton}><Icon name="grid"/></Unavailable></div></> : <div className={styles.projectToolbar}><Unavailable label="发现">发现</Unavailable><h2>我的项目</h2><Unavailable label="模板">模板</Unavailable><span className={styles.toolbarSpacer}/><button onClick={() => changeView("projects")}>查看全部 <span aria-hidden="true">›</span></button></div>}
        {loadingProjects && <p className={styles.empty} role="status">正在读取已有项目…</p>}
        {(listError || exampleError) && <div className={styles.error} role="alert"><p>{listError || exampleError}</p><button type="button" disabled={loadingProjects} onClick={onRetryProjects}>重试读取与准备</button></div>}
        {!loadingProjects && !listError && projects.length === 0 && <div className={styles.empty}><Icon name="projects"/><h2>还没有已保存的项目</h2><p>这里显示当前账号的云端项目。</p>{view === "projects" && <button onClick={() => changeView("home")}>创建第一个应用 <span aria-hidden="true">↗</span></button>}</div>}
        <div className={styles.projectGrid}>{(view === "home" ? projects.slice(0, 3) : projects).map(project => <button key={project.id} className={styles.projectCard} onClick={() => onOpenProject(project)} title={`打开项目：${project.title}`}>
          <span className={styles.cover}><Icon name="projects"/><span>项目封面占位</span><small>尚未提供应用截图</small></span>
          <span className={styles.projectMeta}><strong>{project.title}</strong>{project.exampleSource && <small>示例项目</small>}<time dateTime={project.updatedAt}>更新于 {new Date(project.updatedAt).toLocaleString("zh-CN")}</time><span className={styles.openHint}>打开项目 ↗</span></span>
        </button>)}</div>
        {view === "projects" && projects.length > 0 && <p className={styles.listNote}>仅显示当前账号的项目 · 封面为占位，不运行应用生成截图</p>}
      </section>
    </main>
  </div>;
}
