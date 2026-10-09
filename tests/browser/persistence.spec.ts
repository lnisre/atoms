import { fulfillGeneration } from "./team-fixture";
import { expect, test, type Page } from "@playwright/test";

// Controlled application tests the public runtime contract, not model quality.
const html = `<!DOCTYPE html><html><head></head><body>
<div><label>任务<input aria-label="任务" disabled></label><button disabled>添加</button></div><ul></ul><p role="status"></p>
<script>
let items=[];const list=document.querySelector('ul'),input=document.querySelector('input'),button=document.querySelector('button'),status=document.querySelector('[role=status]');
function render(){list.replaceChildren();items.forEach(item=>{const row=document.createElement('li'),check=document.createElement('input'),text=document.createElement('span'),del=document.createElement('button');check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label','完成 '+item.text);text.textContent=item.text;del.textContent='删除 '+item.text;check.onchange=()=>{item.done=check.checked;save()};del.onclick=()=>{items=items.filter(x=>x.id!==item.id);save()};row.append(check,text,del);list.append(row)})}
async function save(){render();try{await atoms.saveState(items);status.textContent='操作已保存'}catch(e){status.textContent=e.message}}
button.onclick=()=>{if(!input.value.trim())return;items.push({id:Date.now()+Math.random(),text:input.value,done:false});input.value='';save()};
atoms.loadState().then(state=>{items=state??[];render();input.disabled=button.disabled=false}).catch(e=>status.textContent=e.message);
</script></body></html>`;
async function generate(page: Page, name = "持久化待办") {
  await page.route("**/api/generate", (route) =>
    fulfillGeneration(route, {
      json: {
        html,
        model: "test-fixture",
        durationMs: 10,
        generatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill(name);
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(page.getByText("项目已保存", { exact: true })).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByLabel("任务", { exact: true }),
  ).toBeEnabled();
}
async function add(page: Page, text: string) {
  await page
    .frameLocator("iframe")
    .getByLabel("任务", { exact: true })
    .fill(text);
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "添加", exact: true })
    // Keyboard activation avoids the recorded headless Chrome first-frame hit-test race.
    .press("Enter");
  await expect(page.getByText("应用数据已保存", { exact: true })).toBeVisible();
}

test("添加、完成、删除后刷新和关闭重开，恢复需求与业务数据且不调用模型", async ({
  page,
  context,
}) => {
  let generations = 0;
  context.on("request", (request) => {
    if (request.url().endsWith("/api/generate")) generations++;
  });
  await generate(page);
  await add(page, "保留并完成");
  await add(page, "删除临时项");
  await page
    .frameLocator("iframe")
    .getByLabel("完成 保留并完成", { exact: true })
    // The first pointer can hit the opaque iframe host in headless Chrome.
    .press("Space");
  await expect(page.frameLocator("iframe").getByLabel("完成 保留并完成", { exact: true })).toBeChecked();
  await expect(page.frameLocator("iframe").locator("body")).not.toHaveAttribute("inert", "");
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "删除 删除临时项", exact: true })
    // Match the other activations: avoid the documented opaque-frame pointer race.
    .press("Enter");
  await expect(page.frameLocator("iframe").getByText("删除临时项", { exact: true })).toHaveCount(0);
  await expect(page.getByText("应用数据已保存", { exact: true })).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "已恢复保存的应用" }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByLabel("完成 保留并完成", { exact: true }),
  ).toBeChecked();
  await expect(
    page.frameLocator("iframe").getByText("删除临时项", { exact: true }),
  ).toHaveCount(0);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened
    .getByRole("region", { name: "已有项目" })
    .getByRole("button", { name: /持久化待办/ })
    .click();
  await expect(reopened).toHaveURL(url);
  await expect(
    reopened
      .frameLocator("iframe")
      .getByLabel("完成 保留并完成", { exact: true }),
  ).toBeChecked();
  await expect(
    reopened.frameLocator("iframe").getByText("删除临时项", { exact: true }),
  ).toHaveCount(0);
  expect(generations).toBe(1);
});

test("多个项目数据隔离，外部伪造的保存消息被忽略", async ({ page }) => {
  await generate(page, "项目甲");
  await add(page, "甲的任务");
  const first = page.url();
  await generate(page, "项目乙");
  await add(page, "乙的任务");
  // Use the active channel deliberately: a valid channel alone does not grant access.
  await page.evaluate(() => {
    const doc = document.querySelector("iframe")!.srcdoc;
    const channel = JSON.parse(
      doc.match(/const \{channel,origin\}=(.*?);/)![1],
    ).channel;
    window.postMessage(
      {
        type: "atoms:state",
        channel,
        id: 500,
        method: "save",
        state: [{ text: "伪造" }],
      },
      "*",
    );
  });
  await page.reload();
  await expect(
    page.frameLocator("iframe").getByText("乙的任务", { exact: true }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByText("甲的任务", { exact: true }),
  ).toHaveCount(0);
  await page.goto(first);
  await expect(
    page.frameLocator("iframe").getByText("甲的任务", { exact: true }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByText("乙的任务", { exact: true }),
  ).toHaveCount(0);
});

test("业务数据事务中止时明确失败，不把请求成功当作保存成功", async ({
  page,
}) => {
  await generate(page);
  await add(page, "已经保存");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
  });
  await page
    .frameLocator("iframe")
    .getByLabel("任务", { exact: true })
    .fill("不能保存");
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "添加", exact: true })
    .press("Enter");
  await expect(page.getByRole("region", { name: "应用预览" }).getByRole("alert")).toContainText(
    "应用数据保存或读取失败",
  );
  await expect(page.getByText("应用数据已保存", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.frameLocator("iframe").locator("body")).not.toHaveAttribute(
    "inert",
    "",
  );
  await page.frameLocator("iframe").getByLabel("任务", { exact: true }).fill("失败后仍可编辑");
  await page.reload();
  await expect(
    page.frameLocator("iframe").getByText("已经保存", { exact: true }),
  ).toBeVisible();
  await expect(
    page.frameLocator("iframe").getByText("不能保存", { exact: true }),
  ).toHaveCount(0);
});

test("项目写入失败仍展示结果和错误，不宣称项目已保存", async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.route("**/api/generate", (route) =>
    fulfillGeneration(route, {
      json: { html, model: "test-fixture", durationMs: 1, generatedAt: "test" },
    }),
  );
  await page.goto("/");
  await page.getByLabel("你想做什么？").fill("项目保存失败验证");
  await page.getByRole("button", { name: "开始生成" }).click();
  await expect(
    page
      .getByRole("region", { name: "项目成果", exact: true })
      .getByRole("alert")
      .filter({ hasText: "项目保存失败" }),
  ).toBeVisible();
  await expect(page.getByText("项目已保存", { exact: true })).toHaveCount(0);
  await expect(page.locator("iframe")).toBeVisible();
});

test("读取失败禁止覆盖原数据，恢复存储后仍能重开", async ({
  page,
  context,
}) => {
  await generate(page);
  await add(page, "不可覆盖");
  await page.addInitScript(() => {
    IDBObjectStore.prototype.get = function () {
      throw new DOMException("blocked", "UnknownError");
    };
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "应用预览" }).getByRole("alert")).toContainText(
    "应用数据保存或读取失败",
  );
  await expect(
    page.frameLocator("iframe").getByLabel("任务", { exact: true }),
  ).toBeDisabled();
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(
    reopened.frameLocator("iframe").getByText("不可覆盖", { exact: true }),
  ).toBeVisible();
});
