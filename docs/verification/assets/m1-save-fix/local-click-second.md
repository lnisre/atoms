# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: persistence.spec.ts >> 业务数据事务中止时明确失败，不把请求成功当作保存成功
- Location: tests/browser/persistence.spec.ts:133:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('应用数据已保存', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('应用数据已保存', { exact: true }) with timeout 5000ms
  - waiting for getByText('应用数据已保存', { exact: true })

```

```yaml
- banner:
  - button "Atoms 首页": atoms LAB
  - text: 无需注册 · 本浏览器保存
- main:
  - complementary:
    - paragraph: 项目工作台
    - heading "持久化待办" [level=1]
    - status: 项目已保存
    - heading "你的需求" [level=2]
    - paragraph: 持久化待办
    - heading "代码已生成" [level=2]
    - paragraph: 现在可以在预览中操作应用。生成完成不代表所有功能都已验证。
    - term: 模型
    - definition: test-fixture
    - term: 生成耗时
    - definition: 0.0 秒
    - paragraph: 自动保存到本浏览器的当前网址。项目与应用数据分别显示保存结果，请等待保存成功再离开。清除站点数据、无痕会话结束或存储被回收后可能丢失，不支持跨设备找回。
    - button "＋ 新建项目 / 已有项目"
  - region "应用预览":
    - text: 运行预览 预览已加载 · 请实际操作检查
    - status: 应用数据已读取 · 尚无已保存数据
    - iframe
- alert
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // Controlled application tests the public runtime contract, not model quality.
  4   | const html = `<!DOCTYPE html><html><head></head><body>
  5   | <div><label>任务<input aria-label="任务" disabled></label><button disabled>添加</button></div><ul></ul><p role="status"></p>
  6   | <script>
  7   | let items=[];const list=document.querySelector('ul'),input=document.querySelector('input'),button=document.querySelector('button'),status=document.querySelector('[role=status]');
  8   | function render(){list.replaceChildren();items.forEach(item=>{const row=document.createElement('li'),check=document.createElement('input'),text=document.createElement('span'),del=document.createElement('button');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label','完成 '+item.text);text.textContent=item.text;del.textContent='删除 '+item.text;check.onchange=()=>{item.done=check.checked;save()};del.onclick=()=>{items=items.filter(x=>x.id!==item.id);save()};row.append(check,text,del);list.append(row)})}
  9   | async function save(){render();try{await atoms.saveState(items);status.textContent='操作已保存'}catch(e){status.textContent=e.message}}
  10  | button.onclick=()=>{if(!input.value.trim())return;items.push({id:Date.now()+Math.random(),text:input.value,done:false});input.value='';save()};
  11  | atoms.loadState().then(state=>{items=state??[];render();input.disabled=button.disabled=false}).catch(e=>status.textContent=e.message);
  12  | </script></body></html>`;
  13  | async function generate(page: Page, name = "持久化待办") {
  14  |   await page.route("**/api/generate", (route) =>
  15  |     route.fulfill({
  16  |       json: {
  17  |         html,
  18  |         model: "test-fixture",
  19  |         durationMs: 10,
  20  |         generatedAt: new Date().toISOString(),
  21  |       },
  22  |     }),
  23  |   );
  24  |   await page.goto("/");
  25  |   await page.getByLabel("你想做什么？").fill(name);
  26  |   await page.getByRole("button", { name: "开始生成" }).click();
  27  |   await expect(page.getByText("项目已保存", { exact: true })).toBeVisible();
  28  |   await expect(
  29  |     page.frameLocator("iframe").getByLabel("任务", { exact: true }),
  30  |   ).toBeEnabled();
  31  | }
  32  | async function add(page: Page, text: string) {
  33  |   await page
  34  |     .frameLocator("iframe")
  35  |     .getByLabel("任务", { exact: true })
  36  |     .fill(text);
  37  |   await page
  38  |     .frameLocator("iframe")
  39  |     .getByRole("button", { name: "添加", exact: true })
  40  |     .click();
> 41  |   await expect(page.getByText("应用数据已保存", { exact: true })).toBeVisible();
      |                                                            ^ Error: expect(locator).toBeVisible() failed
  42  | }
  43  | 
  44  | test("添加、完成、删除后刷新和关闭重开，恢复需求与业务数据且不调用模型", async ({
  45  |   page,
  46  |   context,
  47  | }) => {
  48  |   let generations = 0;
  49  |   context.on("request", (request) => {
  50  |     if (request.url().endsWith("/api/generate")) generations++;
  51  |   });
  52  |   await generate(page);
  53  |   await add(page, "保留并完成");
  54  |   await add(page, "删除临时项");
  55  |   await page
  56  |     .frameLocator("iframe")
  57  |     .getByLabel("完成 保留并完成", { exact: true })
  58  |     .check();
  59  |   await page
  60  |     .frameLocator("iframe")
  61  |     .getByRole("button", { name: "删除 删除临时项", exact: true })
  62  |     .click();
  63  |   await expect(page.getByText("应用数据已保存", { exact: true })).toBeVisible();
  64  |   const url = page.url();
  65  |   await page.reload();
  66  |   await expect(
  67  |     page.getByRole("heading", { name: "已恢复保存的应用" }),
  68  |   ).toBeVisible();
  69  |   await expect(
  70  |     page.frameLocator("iframe").getByLabel("完成 保留并完成", { exact: true }),
  71  |   ).toBeChecked();
  72  |   await expect(
  73  |     page.frameLocator("iframe").getByText("删除临时项", { exact: true }),
  74  |   ).toHaveCount(0);
  75  |   await page.close();
  76  |   const reopened = await context.newPage();
  77  |   await reopened.goto("/");
  78  |   await reopened
  79  |     .getByRole("region", { name: "已有项目" })
  80  |     .getByRole("button", { name: /持久化待办/ })
  81  |     .click();
  82  |   await expect(reopened).toHaveURL(url);
  83  |   await expect(
  84  |     reopened
  85  |       .frameLocator("iframe")
  86  |       .getByLabel("完成 保留并完成", { exact: true }),
  87  |   ).toBeChecked();
  88  |   await expect(
  89  |     reopened.frameLocator("iframe").getByText("删除临时项", { exact: true }),
  90  |   ).toHaveCount(0);
  91  |   expect(generations).toBe(1);
  92  | });
  93  | 
  94  | test("多个项目数据隔离，外部伪造的保存消息被忽略", async ({ page }) => {
  95  |   await generate(page, "项目甲");
  96  |   await add(page, "甲的任务");
  97  |   const first = page.url();
  98  |   await generate(page, "项目乙");
  99  |   await add(page, "乙的任务");
  100 |   // Use the active channel deliberately: a valid channel alone does not grant access.
  101 |   await page.evaluate(() => {
  102 |     const doc = document.querySelector("iframe")!.srcdoc;
  103 |     const channel = JSON.parse(
  104 |       doc.match(/const \{channel,origin\}=(.*?);/)![1],
  105 |     ).channel;
  106 |     window.postMessage(
  107 |       {
  108 |         type: "atoms:state",
  109 |         channel,
  110 |         id: 500,
  111 |         method: "save",
  112 |         state: [{ text: "伪造" }],
  113 |       },
  114 |       "*",
  115 |     );
  116 |   });
  117 |   await page.reload();
  118 |   await expect(
  119 |     page.frameLocator("iframe").getByText("乙的任务", { exact: true }),
  120 |   ).toBeVisible();
  121 |   await expect(
  122 |     page.frameLocator("iframe").getByText("甲的任务", { exact: true }),
  123 |   ).toHaveCount(0);
  124 |   await page.goto(first);
  125 |   await expect(
  126 |     page.frameLocator("iframe").getByText("甲的任务", { exact: true }),
  127 |   ).toBeVisible();
  128 |   await expect(
  129 |     page.frameLocator("iframe").getByText("乙的任务", { exact: true }),
  130 |   ).toHaveCount(0);
  131 | });
  132 | 
  133 | test("业务数据事务中止时明确失败，不把请求成功当作保存成功", async ({
  134 |   page,
  135 | }) => {
  136 |   await generate(page);
  137 |   await add(page, "已经保存");
  138 |   await page.evaluate(() => {
  139 |     const put = IDBObjectStore.prototype.put;
  140 |     IDBObjectStore.prototype.put = function (...args) {
  141 |       const request = put.apply(this, args);
```