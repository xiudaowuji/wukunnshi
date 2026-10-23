# 排行榜后端（Cloudflare Worker + D1）

一个文件、一张表、两个接口，免费额度对一个小游戏绰绰有余（D1 每天 500 万行读取 / 10 万行写入，Workers 每天 10 万次请求）。

```
GET  /top?limit=20   -> { ok, count, rows: [{ rank, name, score, ts }] }
POST /score          -> { ok, rank, best, improved, rows: [...] }
     body: { "name": "吴琨", "score": 1234 }
GET  /health         -> { ok: true }
```

规则：同名只保留最高分，低分不覆盖；同分时先达到的人排前面。名字去空白、截到 12 个字符；分数必须是 0~100000 的整数；每个 IP 每分钟最多 6 次、每天 150 次提交。

## 首次部署

```bash
cd server
npx wrangler login                       # 浏览器里授权一次
npx wrangler d1 create wukunnshi-lb      # 把输出的 database_id 填进 wrangler.toml
npx wrangler d1 execute wukunnshi-lb --remote --file=schema.sql
npx wrangler deploy                      # 记下输出的 https://xxx.workers.dev
```

然后把地址打进页面：

```bash
cd ..
python build/build.py index.html --lb-api=https://wukunnshi-leaderboard.你的子域.workers.dev
```

`workers.dev` 的域名偶尔在国内不稳定，介意的话可以在 Cloudflare 里绑一个自己的域名。

## 当前部署（2026-10-23）

| 项 | 值 |
|---|---|
| Worker | `wukunnshi-leaderboard` → `https://wukunnshi-leaderboard.xiudaowuji.workers.dev` |
| D1 | `wukunnshi-lb`，`c7eaa66c-7d86-4351-a92b-7fbb71756e58`，APAC |
| workers.dev 子域 | `xiudaowuji` |
| 页面接入 | **未接入**：线上仍是「本机演示」模式 |

> ⚠️ **国内网络打不开 workers.dev**。实测 `api.cloudflare.com` 与 `xxx.workers.dev` 解析到同一个
> Cloudflare 边缘 IP 时，前者 TLS 握手正常、后者直接 ECONNRESET —— 是按 SNI 域名阻断的。
> 所以这个 Worker 目前只对海外网络（或挂了代理的设备）可用。
>
> 要让国内玩家也能上榜，绑一个自定义域名即可（SNI 变成自己的域名，绕开对 `workers.dev` 的阻断）：
>
> ```bash
> # 域名先托管到 Cloudflare（NS 指过去），然后：
> wrangler deploy --domain lb.example.com     # 或在 dashboard 里 Workers → 设置 → 域和路由
> python build/build.py index.html --lb-api=https://lb.example.com
> ```

## 本地调试

```bash
# 只跑后端测试（node:sqlite 冒充 D1，不用联网、不用登录）
node server/test_worker.mjs

# 起一个真的 Worker（同样用 node:sqlite），前端加 ?lbapi= 指过来即可
node server/dev_server.mjs 8787
```

前端调试最快的方式是给页面加参数，不用重新打包：

```
index.html?sub=6666&lbapi=http://127.0.0.1:8787   # 直接打开「记录排行」表单
index.html?rank&lbapi=http://127.0.0.1:8787       # 直接打开排行榜
```

## 安全说明

- 分数由客户端计算，服务端只做**范围 + 频率**校验，拦不住改代码直接提交 99999。
- 用户名没有认证，谁都能用别人的名字提交（反正只保留最高分）。
- IP 只存 SHA-256 前 12 字节，7 天自动清理。
- 接口是 `Access-Control-Allow-Origin: *`，因为它本来就是公开只读数据；写入侧靠限流兜底。

## 表结构

见 [schema.sql](schema.sql)：`scores`（name 主键 + score + 时间戳）和 `submit_log`（限流用）。
