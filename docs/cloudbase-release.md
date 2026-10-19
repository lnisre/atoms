# CloudBase 临时内测发布

本入口只操作显式指定的独立容器服务，现有 Vercel 生产入口不变。默认 HTTPS 域名按开发测试用途使用：浏览器正常显示提示后点击“确定访问”。不伪造平台请求头、不复制确认 Cookie、不把内测验证当作正式自定义域名验收。

## 冻结计划

使用 Node 24。`plan` 只读 Git 中的完整 40 位提交，从应用白名单生成确定性源码 ZIP、每文件 SHA-256 和源码摘要；磁盘未提交内容不会打包。`Dockerfile` 由冻结的 `Dockerfile.vercel` 原样生成，仍是唯一完整 Node 网关、Next standalone、Python 3.11、固定 MetaGPT 配方。生成的运行身份只含提交、源码摘要和协议。

为内测服务准备不含秘密的目标 JSON：

```json
{
  "envId": "YOUR-ENV-ID",
  "region": "ap-shanghai",
  "serverName": "atoms-beta",
  "productionServerName": "atoms-production",
  "origin": "https://unconfigured.invalid",
  "cpu": 1,
  "memory": 2,
  "minInstances": 0,
  "maxInstances": 1,
  "dataMode": "isolated",
  "namespace": "atoms_beta"
}
```

`productionServerName` 是禁止被 `stage` 修改的保留服务名。资源起点不表示容量通过；调整必须重新测量。复用现有账号项目时，显式改为 `dataMode: "existing-account-data"`、实际 namespace，并增加 `sharedDataAuthorized: true`，只可在已经获得授权时使用。此项不迁移数据库、不初始化 Auth、不轮换产物密钥。

默认服务域名首次创建后才可核对。初次可用 `https://unconfigured.invalid` 作为拒绝外部业务来源的引导 origin；它不构成可用站点。服务健康并返回实际默认域名后，按下面的版本核验取得镜像；该次结果仅有 `artifactVerified=true`，而 `deploymentVerified=false`。以实际域名重新计划、`expectedVersion` 精确绑定旧版本，使用同一已核验 digest 更新运行 origin。再次核验时目标 origin 必须属于 API 读回的该服务默认/自定义域名，镜像更新的实际远端引用必须精确等于已核验 immutable 引用；缺少 digest 证据时拒绝通过。正式对用户交付前必须完成该步与真实业务验收。不能通过客户端 Host 动态配置可信 origin。

```sh
node scripts/cloudbase/release.mjs plan NEW_DIRECTORY --ref FULL_COMMIT --target TARGET_JSON
```

每个新计划使用新目录，所有结果拒绝覆盖。`plan.json` 标注提交是否已在 `origin/master`；未合入版本仅作候选内测，正式发布仍要求冻结已合入源码。

## 运行配置与提交

应用仅接收 `DEEPSEEK_API_KEY`、`CLOUDBASE_ENV_ID`、`ATOMS_PROJECT_NAMESPACE`、`ATOMS_AUTH_SECRET`、`ATOMS_ARTIFACT_SECRET`、`QA_TOOL_SIGNING_KEY`、`ATOMS_APP_ORIGIN`；工具添加固定 `ATOMS_HOSTING=cloudbase`。来源、环境和 namespace 必须精确匹配目标。运行时管理凭据、测试 transport 和未知变量全部拒绝。

可信操作进程可将这些值仅注入子进程环境，再使用 `--runtime-env yes`；不要把值放在命令行或日志。也支持已经安全保管的环境文件 `--runtime EXISTING_RUNTIME_FILE`，两种方式选一。管理凭据由独立现有 `--credentials EXISTING_CREDENTIAL_FILE` 读取，不进入应用环境、构建参数、镜像或结果。工具输出完整配置的加盐摘要，不输出单项秘密。Python 继续使用现有显式环境白名单。

```sh
node --use-env-proxy scripts/cloudbase/release.mjs stage DIRECTORY --credentials EXISTING_CREDENTIAL_FILE --runtime-env yes
node --use-env-proxy scripts/cloudbase/release.mjs status DIRECTORY --credentials EXISTING_CREDENTIAL_FILE
node --use-env-proxy scripts/cloudbase/release.mjs verify DIRECTORY --credentials EXISTING_CREDENTIAL_FILE --runtime-env yes
```

`stage` 核对个人版、超限关闭、单实例资源上限和目标服务。创建前先落脱敏 attempt；已有服务必须指定 `expectedVersion`，并确认无其他发布正在执行。提交成功只代表 submitted，不代表就绪。上传签名 URL 只存在内存且限制为官方上传主机。任何超时后先执行 `status` 查询同服务/任务/版本/构建，禁止删除 attempt 后盲目重复创建；状态未知时保留现场调查。

`verify` 同时验证服务身份、唯一 100% 版本、资源/精确运行配置、源构建 ID 对应的镜像推送 manifest digest，以及网关 `/healthz` 返回的冻结源码身份和 Next 就绪。Docker 层 hash、服务 normal 或首页 200 单独均不足。平台默认域名如无法直接取得 JSON，先完成浏览器正常确认，再保存该浏览器实际健康响应并传 `--health OBSERVATION_JSON`；观察必须是 `{ "origin": "实际服务origin", "observedAt": "实际ISO时间", "body": { "实际健康响应": "..." } }`，有效期十分钟。结果将明确标注为需要独立复核的浏览器观察，不能自行编造响应。若构建日志没有唯一的最终 push manifest digest，核验拒绝继续，需要先确认 registry digest，不能拿基础镜像或任意层的 sha256 代替。

完整 Python 镜像的构建日志可能超过一页；工具按官方 `Delivered` 条数推进 `Offset`，直到 `More=false`，上限 100 页、16 MiB。证据只记录页偏移、条数、内容摘要和 request ID，不落原始构建日志。分页缺失、停滞或出现多个 push digest 均拒绝核验。

### 构建成功而首版本创建超时

平台可能已经把完整镜像推入 registry，管理任务却在 `CreateVersion` 超时，且从未出现在线版本。不要重发创建或把构建成功写成健康通过。先保存原 attempt、提交 task、状态和版本记录；仅当同一 owned package task 明确 `failed / timeout`、没有在线版本，且其精确版本对应唯一 build ID 和 push digest 时，可执行：

```sh
node --use-env-proxy scripts/cloudbase/release.mjs build-artifact ORIGINAL_DIRECTORY --credentials EXISTING_CREDENTIAL_FILE
```

这生成独立 `build-artifact.json`：`sourceBuildVerified=true`，`artifactVerified=false`、`deploymentVerified=false`，不包含应用健康结论。它绑定原上传 package、archive/source digest、task、版本、build ID 和 immutable image。修复发布工具本身不改变已冻结应用输入时可复用该构建；需要修改容器或应用则必须重新冻结、重建。

新恢复目标使用原失败版本作为 `expectedVersion`，以 `--image-verification ORIGINAL_DIRECTORY/build-artifact.json` 创建新计划。提交前再次读回同一失败 task、版本、build ID、镜像 tag 与“无在线版本”；任一状态改变都拒绝。恢复只通过 `UpdateCloudRunServer` 部署已证明的同一 immutable image，保留原失败目录，不复用 attempt 或盲目重建。恢复后仍须完整 `verify` 验证真实运行镜像、配置和健康；digest 被平台改写且缺少可核验映射时不能放宽通过。

## 同一镜像更新与回退

第二次计划使用 `--image-verification PRIOR_DIRECTORY/verification.json`，只接受同一冻结源码的已核验 digest；无需再构建。新目标包含实际 origin 和 `expectedVersion`。服务配置仍独立注入；镜像中不包含秘密。命令不隐式改 DNS、Vercel 或生产服务。

```sh
node scripts/cloudbase/release.mjs plan SECOND_DIRECTORY --ref FULL_COMMIT --target UPDATED_TARGET_JSON --image-verification PRIOR_VERIFICATION_JSON
node --use-env-proxy scripts/cloudbase/release.mjs stage SECOND_DIRECTORY --credentials EXISTING_CREDENTIAL_FILE --runtime-env yes
node --use-env-proxy scripts/cloudbase/release.mjs status SECOND_DIRECTORY --credentials EXISTING_CREDENTIAL_FILE
node --use-env-proxy scripts/cloudbase/release.mjs verify SECOND_DIRECTORY --credentials EXISTING_CREDENTIAL_FILE --runtime-env yes
node scripts/cloudbase/release.mjs promote SECOND_DIRECTORY
node --use-env-proxy scripts/cloudbase/release.mjs rollback SECOND_DIRECTORY --credentials EXISTING_CREDENTIAL_FILE --current-version EXACT_CURRENT --rollback-version RECORDED_PRIOR
```

`promote` 仅生成正式发布准备清单，拒绝执行生产修改。`rollback` 默认仅给出精确请求；确认是该内测服务已记录的前版本、当前版本未变且已完成维护/停止操作后，加 `--execute yes` 提交官方 `SubmitServerRollback`。回退提交仍需 `status` 核验。应用回退不回滚数据库、不自动重放请求或付费任务。首个版本没有记录的前版本，工具不会伪造可回退目标。内测服务的第二版本发布/回退与正式切流的排空流程必须分别演练。

## 内测维护与停止

需要暂停生成或做回退演练时，在新目标 JSON 中设置 `maintenance: true`、精确的 `expectedVersion`，以同一已核验镜像创建新计划并发布。工具只从目标生成 `ATOMS_MAINTENANCE=1`，不接受任意新增运行环境项。维护版本仍提供页面、登录、项目读取与保存；生成 HTTP 入口返回有明确提示、`no-store` 和 `Retry-After` 的 503，原生 WSS 拒绝升级。已经打开的页面也经过同一网关，因此不能继续启动新付费任务。`/healthz` 同时报告 `maintenance`，保持 Next 真实就绪与拒绝新任务两种状态分开。

进入维护版本本身是一次平台发布，可能停止已有连接；它不是无损排空。在通知少量内测者暂停提交后，让在途任务按原预算结束；无法等待时明确告知停止并保留当前页面的下载出口，再发布维护版本。网关收到 SIGTERM 会终止所属 Python 进程组。不要用活动连接数推断所有保存都已成功，不要刷新有未保存成果的页面，不自动重新执行模型任务。平台是否保留旧连接、何时发退出信号必须由真实演练记录，不能由本地测试推断。

执行回退还会检查远端当前运行配置确实为维护状态、版本没有变化、管理任务已结束，并仅允许当前发布 attempt 记录的前版本。建议先从已验收版本部署同镜像维护版本，再回退到它记录的已验收前版本；不要把首次引导 origin 版本作为可供用户恢复使用的版本。回退后重新核对 origin、运行配置、健康和真实项目保存，保留数据库最新成功提交。恢复服务也通过一个显式 `maintenance: false` 的新版本完成，不能只改本地记录。

若需要彻底停用内测资源，先停止邀请并让用户保存/下载；随后由负责人在 CloudBase 控制台核对本次独立服务、停止或删除，并只读确认结果。当前发布 CLI 故意不提供批量删除或账户级停用动作。`minInstances: 0` 只允许闲置缩零，不能阻止下一次访问唤醒实例，不代表停止服务或保证零费用。

## 健康与证据边界

只有网关公开 3000 端口。Next 内部端口绑定 loopback。`/healthz` 不调用 Auth、PG 或模型，返回 Next 存活、协议、提交、源码摘要、活动 WebSocket **连接数**和停止状态；连接数不是 Next 内部任务数。网关/Next 异常使健康失效，结构日志不含 Cookie、票据、业务数据或密钥。SIGTERM 立即停止连接，以独立进程组终止 Next 和 Python，2 秒后强制清理；它不承诺平台无损排空或任务接续。

项目持久化仍在 PG，容器临时盘只用于执行。发布核验结果明确保留 verify-atoms 产品验收、600 秒平台证据、真实邮箱、真实模型及正式切流的待验状态。全部代码完成后统一使用 verify-atoms，并将真实平台、受控本地、离线供应商和未覆盖项分别记录。默认域名临时内测不能替代后续正式域名、容量、至少 48 小时观察及生产回退验收。

API 合同依据：腾讯官方 [tcbr SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/tcbr/v20220217/tcbr_models.ts) 与 `@cloudbase/manager-node@5.9.1` 的 CloudRun 实现（核对日期 2026-10-19）。
